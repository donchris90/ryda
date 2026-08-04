#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== Setup: driver + passenger(s), a completed ride =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234717${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Femi\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
DRIVER_ID=$(echo "$DRIVER" | jget user.id)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-NEW-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Camry", "year": 2022, "color": "Black", "plateNumber": "LAG-NEW-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234717${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Ada\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)

FRIEND=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234717${SUFFIX:4:6}3\", \"password\": \"Passw0rd!\", \"firstName\": \"Bola\", \"lastName\": \"Friend\", \"role\": \"passenger\"
}")
FRIEND_TOKEN=$(echo "$FRIEND" | jget accessToken)
FRIEND_PHONE="+234717${SUFFIX:4:6}3"

su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$(echo $PASSENGER | jget user.id)';\"" > /dev/null
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$(echo $FRIEND | jget user.id)';\"" > /dev/null

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "VI",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo
echo "== A. Driver info — passenger should now see who's picking them up =="
curl -s $BASE/rides/$RIDE_ID/driver-info -H "Authorization: Bearer $PASSENGER_TOKEN"
echo
echo "another passenger should be rejected:"
curl -s -w "[HTTP:%{http_code}]\n" $BASE/rides/$RIDE_ID/driver-info -H "Authorization: Bearer $FRIEND_TOKEN"

echo
echo "== B. Ride chat — passenger sends, driver reads, driver replies =="
curl -s -X POST $BASE/rides/$RIDE_ID/messages -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{"message": "I am wearing a red jacket"}'
echo
curl -s -X POST $BASE/rides/$RIDE_ID/messages -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{"message": "Got it, 2 mins away"}'
echo
echo "passenger reads the thread:"
curl -s $BASE/rides/$RIDE_ID/messages -H "Authorization: Bearer $PASSENGER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('message count:', a.length, '| roles:', a.map(m=>m.senderRole).join(','))})"
echo "a random stranger cannot read it:"
curl -s -w "[HTTP:%{http_code}]\n" $BASE/rides/$RIDE_ID/messages -H "Authorization: Bearer $FRIEND_TOKEN"

echo
echo "== C. Complete the ride (needed for loyalty points + realistic split test) =="
curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
COMPLETED=$(curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$COMPLETED" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log('ride completed, totalFare:', r.totalFare)})"

echo
echo "== D. Loyalty — passenger should now have points from this completed ride =="
sleep 1
curl -s $BASE/loyalty/me -H "Authorization: Bearer $PASSENGER_TOKEN"
echo
echo "transactions:"
curl -s $BASE/loyalty/me/transactions -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

echo
echo "== E. Split fare — needs a NEW ride since split requires an active/recent one; reuse the completed ride for the split record itself =="
SPLIT=$(curl -s -X POST $BASE/rides/$RIDE_ID/split -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d "{
  \"participantPhones\": [\"$FRIEND_PHONE\"]
}")
echo "$SPLIT"
echo
echo "friend views the split (should see their share):"
curl -s $BASE/rides/$RIDE_ID/split -H "Authorization: Bearer $FRIEND_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);console.log('status:', s.status, '| participant owes:', s.participants[0].amountOwed)})"

echo "friend's wallet balance BEFORE paying their share:"
curl -s $BASE/wallet -H "Authorization: Bearer $FRIEND_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).balance))"

echo "friend pays their share:"
curl -s -X POST $BASE/rides/$RIDE_ID/split/pay -H "Authorization: Bearer $FRIEND_TOKEN"
echo

echo "friend's wallet balance AFTER paying (should be lower):"
curl -s $BASE/wallet -H "Authorization: Bearer $FRIEND_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).balance))"
echo "split status now (should be completed):"
curl -s $BASE/rides/$RIDE_ID/split -H "Authorization: Bearer $PASSENGER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);console.log('status:', s.status)})"

echo
echo "== F. Trip sharing — generate a link, view it with NO auth token at all =="
SHARE=$(curl -s -X POST $BASE/rides/$RIDE_ID/share -H "Authorization: Bearer $PASSENGER_TOKEN")
echo "$SHARE"
TOKEN=$(echo "$SHARE" | jget shareToken)
echo "public view (no Authorization header):"
curl -s -w "\n[HTTP:%{http_code}]\n" $BASE/rides/shared/$TOKEN
echo "calling share again should return the SAME token (idempotent):"
curl -s -X POST $BASE/rides/$RIDE_ID/share -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

echo
echo "DONE."
