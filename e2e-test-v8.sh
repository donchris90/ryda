#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Maps geocode without API key configured (should fail cleanly, not crash) =="
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/maps/geocode -H "Content-Type: application/json" -d '{"address": "Ikeja, Lagos"}'

echo
echo "== B. Fare estimate WITHOUT airport flag =="
NORMAL=$(curl -s -X POST $BASE/rides/estimate -H "Content-Type: application/json" -d '{
  "category": "economy", "pickupLat": 6.6018, "pickupLng": 3.3515, "dropoffLat": 6.4281, "dropoffLng": 3.4219
}')
echo "$NORMAL"

echo
echo "== C. Fare estimate WITH airport flag (should add airport fee on top) =="
AIRPORT=$(curl -s -X POST $BASE/rides/estimate -H "Content-Type: application/json" -d '{
  "category": "economy", "pickupLat": 6.6018, "pickupLng": 3.3515, "dropoffLat": 6.4281, "dropoffLng": 3.4219, "isAirportTrip": true
}')
echo "$AIRPORT"
NORMAL_TOTAL=$(echo "$NORMAL" | jget totalFare)
AIRPORT_TOTAL=$(echo "$AIRPORT" | jget totalFare)
echo "normal total: $NORMAL_TOTAL, airport total: $AIRPORT_TOTAL (difference should be ~1000)"

echo
echo "== D. Set up driver + passenger for waiting-fee and cancellation-fee tests =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234705${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Pricing\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-PRICE-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)

ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Vitz", "year": 2019, "plateNumber": "LAG-PRICE-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234705${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Pricing\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)
PASSENGER_ID=$(echo "$PASSENGER" | jget user.id)
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$PASSENGER_ID';\"" > /dev/null

echo
echo "== E. Waiting fee: request+accept+arrive, backdate arrivedAt 10 min in the past, then start (should bill ~5 min at the per-minute rate) =="
RIDE1=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE1_ID=$(echo "$RIDE1" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE1_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE1_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
su postgres -c "psql -d ryda -c \"UPDATE rides SET \\\"arrivedAt\\\" = NOW() - INTERVAL '10 minutes' WHERE id='$RIDE1_ID';\"" > /dev/null
STARTED=$(curl -s -X PATCH $BASE/rides/$RIDE1_ID/start -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$STARTED" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('waitingFee:', o.waitingFee, 'totalFare:', o.totalFare)})"
# Complete it so the driver goes back online for the next test.
curl -s -X PATCH $BASE/rides/$RIDE1_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo
echo "== F. Cancellation fee: accept a NEW ride then passenger cancels after acceptance =="
RIDE2=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE2_ID=$(echo "$RIDE2" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE2_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo "passenger wallet BEFORE cancellation:"
curl -s $BASE/wallet -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

CANCELLED=$(curl -s -X PATCH $BASE/rides/$RIDE2_ID/cancel -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{"reason": "changed my mind"}')
echo "$CANCELLED" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('cancellationFee:', o.cancellationFee)})"

echo "passenger wallet AFTER cancellation (should be debited the cancellation fee):"
curl -s $BASE/wallet -H "Authorization: Bearer $PASSENGER_TOKEN"
echo
echo "driver wallet AFTER cancellation (should be credited the cancellation fee as compensation):"
curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== G. Driver documents: upload license, admin lists pending, approves =="
DOC=$(curl -s -X POST $BASE/drivers/documents -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "type": "drivers_license", "documentUrl": "https://example.com/docs/license123.jpg", "expiryDate": "2028-01-01"
}')
echo "$DOC"
DOC_ID=$(echo "$DOC" | jget id)

curl -s $BASE/drivers/documents/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo
curl -s $BASE/drivers/admin/documents/pending -H "Authorization: Bearer $ADMIN_TOKEN"
echo
curl -s -X PATCH $BASE/drivers/admin/documents/$DOC_ID/approve -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== H. Upload a second document (insurance) and REJECT it =="
DOC2=$(curl -s -X POST $BASE/drivers/documents -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "type": "insurance", "documentUrl": "https://example.com/docs/insurance-blurry.jpg"
}')
DOC2_ID=$(echo "$DOC2" | jget id)
curl -s -X PATCH $BASE/drivers/admin/documents/$DOC2_ID/reject -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "rejectionReason": "Image too blurry to read expiry date"
}'
echo

echo
echo "== I. Driver's document list should now show one approved, one rejected =="
curl -s $BASE/drivers/documents/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "DONE."
