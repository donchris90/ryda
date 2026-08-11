#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Register passenger + driver =="
PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234701${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"NotifyPax\", \"lastName\": \"One\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)
PASSENGER_ID=$(echo "$PASSENGER" | jget user.id)

DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234701${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"NotifyDriver\", \"lastName\": \"Two\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
DRIVER_ID=$(echo "$DRIVER" | jget user.id)

echo
echo "== B. Register a push device token for the passenger =="
curl -s -X POST $BASE/notifications/devices -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "token": "fake-device-token-abc123", "platform": "android"
}'
echo

echo
echo "== C. Onboard driver, check driver.approval.changed event fires a notification =="
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-NOTIFY-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)

ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null

echo "driver notifications after approval:"
curl -s $BASE/notifications/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== D. Vehicle + online, then full ride lifecycle to trigger ride.accepted / ride.completed notifications =="
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Camry", "year": 2020, "plateNumber": "LAG-NTF-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$PASSENGER_ID';\"" > /dev/null

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
echo "ride requested: $RIDE_ID"

curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
echo "passenger notifications after driver accepted:"
curl -s $BASE/notifications/mine -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo
echo "passenger notifications after completion:"
curl -s $BASE/notifications/mine -H "Authorization: Bearer $PASSENGER_TOKEN"
echo
echo "driver notifications after completion:"
curl -s $BASE/notifications/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== E. Unread count + mark one read + mark all read =="
curl -s $BASE/notifications/mine/unread-count -H "Authorization: Bearer $PASSENGER_TOKEN"
echo
FIRST_NOTIF_ID=$(curl -s $BASE/notifications/mine -H "Authorization: Bearer $PASSENGER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].id))")
curl -s -X PATCH $BASE/notifications/$FIRST_NOTIF_ID/read -H "Authorization: Bearer $PASSENGER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('isRead:',JSON.parse(d).isRead))"
curl -s -X PATCH $BASE/notifications/mine/read-all -H "Authorization: Bearer $PASSENGER_TOKEN"
echo
curl -s $BASE/notifications/mine/unread-count -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

echo
echo "== F. Admin broadcast to multiple users =="
curl -s -X POST $BASE/notifications/broadcast -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d "{
  \"userIds\": [\"$PASSENGER_ID\", \"$DRIVER_ID\"], \"channel\": \"in_app\", \"title\": \"System maintenance\", \"body\": \"Scheduled maintenance tonight at midnight.\"
}"
echo

echo
echo "== G. Cancellation notification: request+cancel a new ride, check driver isn't notified (no driver assigned) then check with assigned driver =="
RIDE2=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "cash"
}')
RIDE2_ID=$(echo "$RIDE2" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE2_ID/cancel -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{"reason": "changed my mind"}' > /dev/null
echo "cancelled ride with no driver assigned yet (should NOT crash, no notification recipient)"

echo
echo "DONE."
