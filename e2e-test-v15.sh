#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Health sub-checks =="
echo "db (should be up):"
curl -s -w " [HTTP:%{http_code}]\n" $BASE/health/db
echo "redis (should be down — honestly not used in this deployment):"
curl -s -w " [HTTP:%{http_code}]\n" $BASE/health/redis
echo "queue (should be up — the scheduler has been running since boot):"
curl -s -w " [HTTP:%{http_code}]\n" $BASE/health/queue
echo "maps (should be down — no GOOGLE_MAPS_API_KEY set):"
curl -s -w " [HTTP:%{http_code}]\n" $BASE/health/maps
echo "payments (should be down — no PAYSTACK_SECRET_KEY set):"
curl -s -w " [HTTP:%{http_code}]\n" $BASE/health/payments
echo "all combined (should be 503 since maps/payments/redis are down):"
curl -s -w " [HTTP:%{http_code}]\n" $BASE/health/all

echo
echo "== B. Set up driver + passenger + a third unrelated user for the websocket test =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234711${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Track\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-TRACK-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Corolla", "year": 2020, "plateNumber": "LAG-TRACK-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 6.6018, "lng": 3.3515
}' > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234711${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Track\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)

OTHER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234711${SUFFIX:4:6}3\", \"password\": \"Passw0rd!\", \"firstName\": \"Unrelated\", \"lastName\": \"User\", \"role\": \"passenger\"
}")
OTHER_TOKEN=$(echo "$OTHER" | jget accessToken)

echo
echo "== C. Request + accept a ride so it's in an ACTIVE status (tracking only broadcasts for active rides) =="
RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
echo "ride $RIDE_ID accepted"

echo
echo "== D. WebSocket test (real socket.io client) =="
node test-websocket.js "$PASSENGER_TOKEN" "$DRIVER_TOKEN" "$RIDE_ID" "$OTHER_TOKEN"

echo
echo "== E. Route history for this ride (should include the location update(s) from the websocket test) =="
curl -s $BASE/tracking/rides/$RIDE_ID/route -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

echo
echo "== F. Driver's own history endpoint =="
curl -s "$BASE/tracking/drivers/me/history" -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('entries:', a.length)})"

echo
echo "DONE."
