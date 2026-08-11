#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Admin login, create an airport (Murtala Muhammed Intl, Lagos) =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
AIRPORT=$(curl -s -X POST $BASE/airports -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "name": "Murtala Muhammed International Airport", "iataCode": "LOS", "city": "Lagos",
  "lat": 6.5774, "lng": 3.3212, "geofenceRadiusKm": 3
}')
echo "$AIRPORT"
AIRPORT_ID=$(echo "$AIRPORT" | jget id)

echo
echo "== B. Public airport list and geofence detection (point inside vs outside) =="
curl -s $BASE/airports
echo
echo "point AT the airport:"
curl -s "$BASE/airports/detect?lat=6.5774&lng=3.3212"
echo
echo "point far away (Ikeja, ~9km):"
curl -s "$BASE/airports/detect?lat=6.6018&lng=3.3515"
echo

echo
echo "== C. Driver joins the airport queue, checks position =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234707${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Airport\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
DRIVER_ID=$(echo "$DRIVER" | jget user.id)

curl -s -X POST $BASE/airports/$AIRPORT_ID/queue/join -H "Authorization: Bearer $DRIVER_TOKEN"
echo
curl -s $BASE/airports/$AIRPORT_ID/queue/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo
echo "dispatcher view of the queue:"
curl -s $BASE/airports/$AIRPORT_ID/queue -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== D. Smart dispatch: onboard+approve+vehicle+online this driver, request a ride, check for an auto-created offer =="
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-DISPATCH-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Kia", "model": "Rio", "year": 2021, "plateNumber": "LAG-DISPATCH-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
# Report a location near the pickup point so this driver is "nearby" for the offer algorithm.
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 6.6020, "lng": 3.3517
}' > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234707${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Dispatch\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
echo "ride requested: $RIDE_ID"

echo "driver checks for their pending offer on this ride (should exist — driver was nearby):"
curl -s $BASE/rides/$RIDE_ID/my-offer -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== E. Driver declines the offer — should immediately try to re-offer (no other drivers nearby, so offer goes empty but ride stays searching) =="
curl -s -X PATCH $BASE/rides/$RIDE_ID/decline -H "Authorization: Bearer $DRIVER_TOKEN"
echo
echo "ride status after decline (should still be searching — broadcast-accept still works):"
curl -s $BASE/rides/$RIDE_ID -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:', o.status)})"

echo
echo "== F. Broadcast-accept still works even after the offer was declined (this is the key backward-compat guarantee) =="
curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:', o.status, 'driverId set:', !!o.driverId)})"

echo
echo "== G. API keys: admin creates one, uses it to call the partner endpoint, then revokes it =="
KEY=$(curl -s -X POST $BASE/admin/api-keys -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "name": "Test Travel Partner", "scopes": ["rides.read"]
}')
echo "$KEY"
RAW_KEY=$(echo "$KEY" | jget rawKey)
KEY_ID=$(echo "$KEY" | jget apiKey.id)

echo
echo "partner endpoint WITH valid key:"
curl -s -H "x-api-key: $RAW_KEY" $BASE/partner/rides/$RIDE_ID/status
echo

echo "partner endpoint WITHOUT a key (should 401):"
curl -s -w "\nHTTP:%{http_code}\n" $BASE/partner/rides/$RIDE_ID/status

echo
echo "partner endpoint WITH a bogus key (should 401):"
curl -s -w "\nHTTP:%{http_code}\n" -H "x-api-key: rk_totally_bogus" $BASE/partner/rides/$RIDE_ID/status

echo
echo "revoke the key, then try again (should 401 now):"
curl -s -X DELETE $BASE/admin/api-keys/$KEY_ID -H "Authorization: Bearer $ADMIN_TOKEN"
echo
curl -s -w "\nHTTP:%{http_code}\n" -H "x-api-key: $RAW_KEY" $BASE/partner/rides/$RIDE_ID/status

echo
echo "== H. Non-admin cannot list API keys =="
curl -s -w "\nHTTP:%{http_code}\n" $BASE/admin/api-keys -H "Authorization: Bearer $DRIVER_TOKEN"

echo
echo "DONE."
