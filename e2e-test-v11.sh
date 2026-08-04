#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Public delivery fare estimate =="
curl -s -X POST $BASE/deliveries/estimate -H "Content-Type: application/json" -d '{
  "category": "parcel", "pickupLat": 6.6018, "pickupLng": 3.3515, "dropoffLat": 6.4281, "dropoffLng": 3.4219, "weightKg": 5
}'
echo

echo
echo "== B. Set up a driver =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234708${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Logistics\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-LOGISTICS-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "motorcycle", "make": "Honda", "model": "CB125", "year": 2022, "plateNumber": "LAG-LOG-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo
echo "== C. Customer (any role) requests a WALLET-paid food delivery =="
CUSTOMER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234708${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Delivery\", \"lastName\": \"Customer\", \"role\": \"passenger\"
}")
CUSTOMER_TOKEN=$(echo "$CUSTOMER" | jget accessToken)
CUSTOMER_ID=$(echo "$CUSTOMER" | jget user.id)
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$CUSTOMER_ID';\"" > /dev/null

ORDER=$(curl -s -X POST $BASE/deliveries -H "Content-Type: application/json" -H "Authorization: Bearer $CUSTOMER_TOKEN" -d '{
  "category": "food",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Mama Put Restaurant, Ikeja", "pickupContactName": "Restaurant Staff", "pickupContactPhone": "+2348011110000",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "12 Marina, VI", "dropoffContactName": "Delivery Customer", "dropoffContactPhone": "+2348022220000",
  "itemDescription": "Jollof rice and chicken, 2 packs", "paymentMethod": "wallet"
}')
echo "$ORDER"
ORDER_ID=$(echo "$ORDER" | jget id)
TOTAL_FARE=$(echo "$ORDER" | jget totalFare)
echo "order: $ORDER_ID, fare: $TOTAL_FARE"

echo
echo "== D. Full lifecycle: accept -> pickup-arrived -> picked-up -> in-transit -> delivered =="
curl -s -X PATCH $BASE/deliveries/$ORDER_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('status:',JSON.parse(d).status))"
curl -s -X PATCH $BASE/deliveries/$ORDER_ID/pickup-arrived -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('status:',JSON.parse(d).status))"
curl -s -X PATCH $BASE/deliveries/$ORDER_ID/picked-up -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('status:',JSON.parse(d).status))"
curl -s -X PATCH $BASE/deliveries/$ORDER_ID/in-transit -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('status:',JSON.parse(d).status))"
curl -s -X PATCH $BASE/deliveries/$ORDER_ID/delivered -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:',o.status,'earningsSettled:',o.earningsSettled,'driverEarnings:',o.driverEarnings)})"

echo
echo "customer wallet after delivery (should be debited totalFare):"
curl -s $BASE/wallet -H "Authorization: Bearer $CUSTOMER_TOKEN"
echo
echo "driver wallet after delivery (should be credited driverEarnings):"
curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== E. COD delivery: customer pays driver cash, driver owes commission =="
COD_ORDER=$(curl -s -X POST $BASE/deliveries -H "Content-Type: application/json" -H "Authorization: Bearer $CUSTOMER_TOKEN" -d '{
  "category": "grocery",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "SuperMart, Ikeja", "pickupContactName": "Store Staff", "pickupContactPhone": "+2348011110001",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "12 Marina, VI", "dropoffContactName": "Delivery Customer", "dropoffContactPhone": "+2348022220000",
  "itemDescription": "Groceries", "paymentMethod": "cash", "isCod": true, "codAmount": 8000
}')
COD_ORDER_ID=$(echo "$COD_ORDER" | jget id)
COD_FARE=$(echo "$COD_ORDER" | jget totalFare)
echo "COD order: $COD_ORDER_ID, delivery fare: $COD_FARE"

curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/deliveries/$COD_ORDER_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/deliveries/$COD_ORDER_ID/picked-up -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo "driver wallet BEFORE COD delivery completes:"
curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN"
echo
curl -s -X PATCH $BASE/deliveries/$COD_ORDER_ID/delivered -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('commissionAmount:',o.commissionAmount)})"
echo "driver wallet AFTER COD delivery (should be debited the commission owed):"
curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== F. Reject invalid COD (isCod=true with paymentMethod != cash) =="
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/deliveries -H "Content-Type: application/json" -H "Authorization: Bearer $CUSTOMER_TOKEN" -d '{
  "category": "parcel",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A", "pickupContactName": "A", "pickupContactPhone": "+2348011110002",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B", "dropoffContactName": "B", "dropoffContactPhone": "+2348022220001",
  "itemDescription": "test", "paymentMethod": "wallet", "isCod": true
}'

echo
echo "== G. Customer order history, driver order history =="
curl -s $BASE/deliveries/mine -H "Authorization: Bearer $CUSTOMER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('customer orders:',JSON.parse(d).length))"
curl -s $BASE/deliveries/driver/mine -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('driver orders:',JSON.parse(d).length))"

echo
echo "== H. Cancellation: request a new order and cancel it =="
NEW_ORDER=$(curl -s -X POST $BASE/deliveries -H "Content-Type: application/json" -H "Authorization: Bearer $CUSTOMER_TOKEN" -d '{
  "category": "pharmacy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Pharmacy", "pickupContactName": "A", "pickupContactPhone": "+2348011110003",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Home", "dropoffContactName": "B", "dropoffContactPhone": "+2348022220002",
  "itemDescription": "Medication", "paymentMethod": "cash"
}')
NEW_ORDER_ID=$(echo "$NEW_ORDER" | jget id)
curl -s -X PATCH $BASE/deliveries/$NEW_ORDER_ID/cancel -H "Content-Type: application/json" -H "Authorization: Bearer $CUSTOMER_TOKEN" -d '{"reason": "no longer needed"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('status:',JSON.parse(d).status))"

echo
echo "DONE."
