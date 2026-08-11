#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Baseline surge check (whatever drivers/rides already exist from prior tests in this DB) =="
curl -s "$BASE/ai/surge?city=Lagos"
echo

echo
echo "== B. Set up driver + passenger, request a ride to generate demand =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234709${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"AI\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-AI-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Yaris", "year": 2020, "plateNumber": "LAG-AI-01"
}' > /dev/null
# Deliberately NOT going online yet, to create a demand > supply imbalance.

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234709${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"AI\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet"
}')
echo "ride created (status should be searching, no drivers online yet):"
echo "$RIDE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:',o.status,'surgeMultiplier:',o.surgeMultiplier,'totalFare:',o.totalFare)})"

echo
echo "== C. Surge after this test's ride is added to open demand =="
curl -s "$BASE/ai/surge?city=Lagos"
echo

echo
echo "== D. Driver goes online -> supply increases, ratio drops =="
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s "$BASE/ai/surge?city=Lagos"
echo

echo
echo "== E. ETA estimate (public) =="
curl -s "$BASE/ai/eta?driverLat=6.6020&driverLng=3.3517&pickupLat=6.6018&pickupLng=3.3515"
echo

echo
echo "== F. Demand forecast (admin only) =="
curl -s "$BASE/ai/demand-forecast?city=Lagos" -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const arr=JSON.parse(d);console.log('hours with data:', arr.filter(h=>h.averageRides>0).length, 'total hours returned:', arr.length)})"

echo
echo "non-admin cannot see demand forecast (403):"
curl -s -w "\nHTTP:%{http_code}\n" "$BASE/ai/demand-forecast" -H "Authorization: Bearer $DRIVER_TOKEN"

echo
echo "== G. Driver recommendations =="
curl -s "$BASE/ai/recommendations/driver?city=Lagos" -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== H. Passenger recommendations (add a favourite first) =="
curl -s -X POST $BASE/passengers/me/favourites -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "label": "Gym", "lat": 6.61, "lng": 3.35, "address": "Fitness Center, Ikeja"
}' > /dev/null
curl -s $BASE/ai/recommendations/passenger -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

echo
echo "== I. Complete the ride, then check driver earnings forecast =="
RIDE_ID=$(echo "$RIDE" | jget id)
PASSENGER_ID=$(echo "$PASSENGER" | jget user.id)
curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$PASSENGER_ID';\"" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

curl -s $BASE/ai/earnings-forecast -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== J. Fraud risk score for a clean user (should be 0, low) =="
curl -s $BASE/ai/fraud-risk/$PASSENGER_ID -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "DONE."
