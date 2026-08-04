#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)

echo "== A. List feature flags (should show 5 auto-seeded, all enabled) =="
curl -s $BASE/admin/feature-flags -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log(a.map(f=>f.key+':'+f.isEnabled).join(', '))})"

echo
echo "== B. Logistics works while the flag is enabled =="
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/deliveries/estimate -H "Content-Type: application/json" -d '{
  "category": "parcel", "pickupLat": 6.6018, "pickupLng": 3.3515, "dropoffLat": 6.4281, "dropoffLng": 3.4219
}'

echo
echo "== C. Disable the logistics flag =="
curl -s -X PUT $BASE/admin/feature-flags/logistics -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "isEnabled": false
}'
echo

echo
echo "== D. Logistics now returns 503 while disabled =="
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/deliveries/estimate -H "Content-Type: application/json" -d '{
  "category": "parcel", "pickupLat": 6.6018, "pickupLng": 3.3515, "dropoffLat": 6.4281, "dropoffLng": 3.4219
}'

echo
echo "== E. Re-enable it, confirm it works again =="
curl -s -X PUT $BASE/admin/feature-flags/logistics -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "isEnabled": true
}' > /dev/null
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/deliveries/estimate -H "Content-Type: application/json" -d '{
  "category": "parcel", "pickupLat": 6.6018, "pickupLng": 3.3515, "dropoffLat": 6.4281, "dropoffLng": 3.4219
}'

echo
echo "== F. Non-admin cannot toggle flags (403) =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234710${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Flags\", \"lastName\": \"Tester\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
curl -s -w "\nHTTP:%{http_code}\n" -X PUT $BASE/admin/feature-flags/logistics -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{"isEnabled": false}'

echo
echo "== G. System settings: override cancellation fee to a custom value =="
curl -s -X PUT $BASE/admin/settings/pricing.cancellationFee -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "value": "1500", "description": "Custom cancellation fee for testing"
}'
echo

echo
echo "== H. Set up driver+passenger, request+accept a ride, cancel it, verify the CUSTOM fee (1500, not the default 500) is charged =="
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-SETTINGS-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Honda", "model": "City", "year": 2021, "plateNumber": "LAG-SET-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234710${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Settings\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)
PASSENGER_ID=$(echo "$PASSENGER" | jget user.id)
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$PASSENGER_ID';\"" > /dev/null

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/cancel -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{"reason":"testing custom fee"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('cancellationFee charged:', o.cancellationFee)})"

echo
echo "== I. Wallet top-up: normal top-up works =="
curl -s -X POST $BASE/wallet/topup -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{"amount": 1000}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('balance after topup:', o.balance)})"

echo
echo "== J. Set a LOW wallet max balance, confirm a top-up exceeding it fails =="
curl -s -X PUT $BASE/admin/settings/wallet.maxBalance -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "value": "2000", "description": "Low limit for testing"
}' > /dev/null
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/wallet/topup -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{"amount": 5000}'

echo
echo "== K. Crucially: ride EARNINGS can still push the driver's wallet past that low limit (limit only applies to top-ups) =="
RIDE2=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE2_ID=$(echo "$RIDE2" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE2_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE2_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE2_ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE2_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN" -w "\nHTTP:%{http_code}\n" | tail -1
echo "driver wallet AFTER earning (should be well over the 2000 'limit' — proving it's top-up-only):"
curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== L. AI dispatch flag: disable it, confirm dispatch still works (falls back to plain order, doesn't error) =="
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 6.6020, "lng": 3.3517
}' > /dev/null
curl -s -X PUT $BASE/admin/feature-flags/ai_dispatch -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"isEnabled": false}' > /dev/null
RIDE3=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE3_ID=$(echo "$RIDE3" | jget id)
echo "offer created for driver even with ai_dispatch OFF (should still find an offer via plain ranking):"
curl -s $BASE/rides/$RIDE3_ID/my-offer -H "Authorization: Bearer $DRIVER_TOKEN"
echo
curl -s -X PUT $BASE/admin/feature-flags/ai_dispatch -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"isEnabled": true}' > /dev/null

echo
echo "DONE."
