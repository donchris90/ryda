#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234728${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Segun\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-PUSH-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Corolla", "year": 2021, "plateNumber": "LAG-PUSH-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 6.6020, "lng": 3.3517
}' > /dev/null

echo "== A. Register a fake Expo push token for this driver (proves routing works even without a real device) =="
curl -s -X POST $BASE/notifications/devices -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "token": "ExponentPushToken[fake-token-for-testing]", "platform": "android"
}'
echo

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234728${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Test\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)

echo
echo "== B. Passenger requests a ride, driver should get a ride.offered notification WITH rideId metadata =="
RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "VI",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
echo "Ride requested: $RIDE_ID"

sleep 1
echo
echo "== C. Driver checks their notifications — the ride_offer one should carry the exact rideId in metadata =="
curl -s $BASE/notifications/mine -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const notifs = JSON.parse(d);
  const offerNotif = notifs.find(n => n.title === 'New ride nearby!');
  console.log('Found ride_offer notification:', !!offerNotif);
  console.log('metadata.rideId matches the real ride:', offerNotif?.metadata?.rideId === '$RIDE_ID');
  console.log('metadata.type:', offerNotif?.metadata?.type);
});
"

echo
echo "DONE."
