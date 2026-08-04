#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234721${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Tunde\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-TIP-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Kia", "model": "Sportage", "year": 2023, "plateNumber": "LAG-TIP-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234721${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Chioma\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$(echo $PASSENGER | jget user.id)';\"" > /dev/null

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "VI",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
REAL_PIN=$(echo "$RIDE" | jget verificationPin)
echo "== A. Ride created with a real 4-digit PIN =="
echo "PIN: $REAL_PIN"

curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo
echo "== B. Driver tries the WRONG pin first — should say verified:false, not error =="
curl -s -X POST $BASE/rides/$RIDE_ID/verify-pin -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{"pin": "0000"}'
echo
echo "== C. Driver tries the CORRECT pin =="
curl -s -X POST $BASE/rides/$RIDE_ID/verify-pin -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d "{\"pin\": \"$REAL_PIN\"}"
echo
echo "another driver (not on this ride) should be rejected:"
OTHER_DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234721${SUFFIX:4:6}3\", \"password\": \"Passw0rd!\", \"firstName\": \"Other\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
OTHER_DRIVER_TOKEN=$(echo "$OTHER_DRIVER" | jget accessToken)
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/rides/$RIDE_ID/verify-pin -H "Content-Type: application/json" -H "Authorization: Bearer $OTHER_DRIVER_TOKEN" -d "{\"pin\": \"$REAL_PIN\"}"

echo
echo "== D. Tipping BEFORE completion should be rejected =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/rides/$RIDE_ID/tip -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{"amount": 500}'

curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo
echo "== E. Tip AFTER completion — check driver wallet balance before/after =="
DRIVER_BALANCE_BEFORE=$(curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN" | jget balance)
echo "driver balance before tip: $DRIVER_BALANCE_BEFORE"
curl -s -X POST $BASE/rides/$RIDE_ID/tip -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{"amount": 500}'
echo
DRIVER_BALANCE_AFTER=$(curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN" | jget balance)
echo "driver balance after tip (should be +500): $DRIVER_BALANCE_AFTER"

echo
echo "== F. Tipping TWICE should be rejected =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/rides/$RIDE_ID/tip -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{"amount": 500}'

echo
echo "DONE."
