#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Swagger docs load =="
curl -s -o /dev/null -w "UI page: HTTP %{http_code}\n" http://localhost:3000/api/docs
curl -s http://localhost:3000/api/docs-json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const spec=JSON.parse(d);console.log('OpenAPI version:', spec.openapi, '| title:', spec.info.title, '| path count:', Object.keys(spec.paths).length)})"

echo
echo "== B. Admin login, subscribe a webhook pointed at our own self-loopback receiver =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
curl -s $BASE/admin/webhooks/events -H "Authorization: Bearer $ADMIN_TOKEN"
echo
SUB=$(curl -s -X POST $BASE/admin/webhooks/subscriptions -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d "{
  \"partnerName\": \"Test Partner\", \"url\": \"http://localhost:3000/api/v1/webhooks/test-receiver\", \"events\": [\"ride.created\", \"ride.completed\", \"driver.online\"]
}")
echo "$SUB"
SUB_ID=$(echo "$SUB" | jget subscription.id)

echo
echo "== C. Trigger real domain events (driver going online, requesting/completing a ride) and check delivery logs =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234712${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Hook\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-HOOK-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Camry", "year": 2020, "plateNumber": "LAG-HOOK-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234712${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Hook\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
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
curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

sleep 1
echo "delivery logs for this subscription (should show ride.created, ride.completed, driver.online — all success with HTTP 201):"
curl -s $BASE/admin/webhooks/subscriptions/$SUB_ID/logs -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const logs=JSON.parse(d);console.log(logs.map(l=>l.event+':'+l.status+':'+l.responseCode).join(', '))})"

echo
echo "== D. Deactivate the subscription, trigger another event, confirm no new delivery =="
curl -s -X PATCH $BASE/admin/webhooks/subscriptions/$SUB_ID/active/false -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X PATCH $BASE/drivers/availability/offline -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
sleep 1
curl -s $BASE/admin/webhooks/subscriptions/$SUB_ID/logs -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const logs=JSON.parse(d);console.log('log count (should be unchanged, still 3):', logs.length)})"

echo
echo "== E. Emergency: passenger triggers SOS during a ride =="
RIDE2=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE2_ID=$(echo "$RIDE2" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE2_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

SOS=$(curl -s -X POST $BASE/emergency/sos -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d "{
  \"rideId\": \"$RIDE2_ID\", \"lat\": 6.61, \"lng\": 3.35
}")
echo "$SOS"
INCIDENT_ID=$(echo "$SOS" | jget id)

echo
echo "== F. Admin/responder sees it in active incidents, checks timeline, acknowledges, then resolves =="
curl -s $BASE/admin/emergency/incidents/active -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('active incidents:', a.length)})"
curl -s $BASE/emergency/incidents/$INCIDENT_ID/timeline -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('timeline entries:', a.map(e=>e.action).join(', '))})"
curl -s -X PATCH $BASE/admin/emergency/incidents/$INCIDENT_ID/acknowledge -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:', o.status)})"
curl -s -X PATCH $BASE/admin/emergency/incidents/$INCIDENT_ID/resolve -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"notes": "False alarm, passenger confirmed safe by phone"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:', o.status, 'resolvedBy set:', !!o.resolvedBy)})"

echo
echo "== G. Live ride monitoring: should show RIDE2 as active with driver's current location =="
curl -s $BASE/admin/emergency/live-rides -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== H. Admin force-cancels RIDE2 (emergency intervention) =="
curl -s -X POST $BASE/admin/emergency/rides/$RIDE2_ID/force-cancel -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "reason": "Safety concern reported, dispatching alternate support"
}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:', o.status, 'cancelReason:', o.cancelReason)})"

echo
echo "== I. Non-responder role (driver) cannot access the command center (403) =="
curl -s -w "\nHTTP:%{http_code}\n" $BASE/admin/emergency/incidents/active -H "Authorization: Bearer $DRIVER_TOKEN"

echo
echo "DONE."
