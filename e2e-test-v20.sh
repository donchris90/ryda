#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)

echo "== A. Admin tools: real queue stats (should show all 3 queues) =="
curl -s $BASE/admin/tools/queues -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== B. Admin tools: system diagnostics =="
curl -s $BASE/admin/tools/diagnostics -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('node version:', o.node.version, '| maintenanceMode:', o.maintenanceMode, '| queue count:', o.queues.length, '| feature flags:', o.featureFlags.length)})"

echo
echo "== C. Admin tools: cache clear =="
curl -s -X POST $BASE/admin/tools/cache/clear -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== D. Geofencing: create a RESTRICTED zone at a known point, verify checkPoint finds it =="
GEOFENCE=$(curl -s -X POST $BASE/admin/geofences -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "name": "Test Restricted Zone", "type": "restricted", "centerLat": 6.6018, "centerLng": 3.3515, "radiusKm": 1
}')
echo "$GEOFENCE"
GEOFENCE_ID=$(echo "$GEOFENCE" | jget id)

echo "checkPoint AT the zone (should find it):"
curl -s "$BASE/geofences/check?lat=6.6018&lng=3.3515"
echo
echo "checkPoint FAR from the zone (should be empty):"
curl -s "$BASE/geofences/check?lat=6.4281&lng=3.4219"
echo

echo
echo "== E. Real event chain: driver location update inside the restricted zone should log a GeofenceEvent =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234716${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Geo\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
DRIVER_ID=$(echo "$DRIVER" | jget user.id)
curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-GEO-01", "city": "Lagos"
}' > /dev/null

# Move the driver INTO the restricted zone
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 6.6018, "lng": 3.3515
}' > /dev/null

echo "recent geofence events (should show this driver entering the restricted zone):"
curl -s $BASE/admin/geofences/events -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log(a.filter(e=>e.driverUserId==='$DRIVER_ID').map(e=>e.geofenceName+':'+e.geofenceType).join(', '))})"

echo
echo "== F. Deactivate the geofence, confirm checkPoint no longer finds it =="
curl -s -X PATCH $BASE/admin/geofences/$GEOFENCE_ID/active/false -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s "$BASE/geofences/check?lat=6.6018&lng=3.3515"
echo

echo
echo "== G. OTP attempt limiting: send an OTP, guess wrong 5 times, confirm the 6th attempt (even with the CORRECT code) is locked out =="
PHONE="+234716${SUFFIX:4:6}9"
SEND=$(curl -s -X POST $BASE/auth/otp/send -H "Content-Type: application/json" -d "{\"phone\": \"$PHONE\"}")
echo "$SEND"
REAL_CODE=$(echo "$SEND" | jget devOnlyCode)

for i in 1 2 3 4 5; do
  RESULT=$(curl -s -w " [HTTP:%{http_code}]" -X POST $BASE/auth/otp/verify -H "Content-Type: application/json" -d "{\"phone\": \"$PHONE\", \"code\": \"000000\"}")
  echo "attempt $i (wrong code): $RESULT"
done

echo "attempt 6 with the CORRECT code (should now be locked out, not verified):"
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/otp/verify -H "Content-Type: application/json" -d "{\"phone\": \"$PHONE\", \"code\": \"$REAL_CODE\"}"

echo
echo "== H. A fresh OTP for the same phone resets the lockout =="
SEND2=$(curl -s -X POST $BASE/auth/otp/send -H "Content-Type: application/json" -d "{\"phone\": \"$PHONE\"}")
REAL_CODE2=$(echo "$SEND2" | jget devOnlyCode)
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/otp/verify -H "Content-Type: application/json" -d "{\"phone\": \"$PHONE\", \"code\": \"$REAL_CODE2\"}"

echo
echo "== I. Maintenance mode: enable it, confirm normal traffic is blocked but health/auth/admin stay reachable =="
curl -s -X POST $BASE/admin/tools/maintenance-mode -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"enabled": true}'
echo

echo "health (should still work):"
curl -s -w " [HTTP:%{http_code}]\n" $BASE/health

echo "a normal endpoint, e.g. airports list (should be 503 now):"
curl -s -w "\n[HTTP:%{http_code}]\n" $BASE/airports

echo "admin endpoint itself (should still work, so admin can turn maintenance back off):"
curl -s -w " [HTTP:%{http_code}]\n" $BASE/admin/tools/maintenance-mode -H "Authorization: Bearer $ADMIN_TOKEN"

echo
echo "turning maintenance mode back off:"
curl -s -X POST $BASE/admin/tools/maintenance-mode -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"enabled": false}'
echo
echo "normal endpoint should work again:"
curl -s -w "\n[HTTP:%{http_code}]\n" $BASE/airports

echo
echo "DONE."
