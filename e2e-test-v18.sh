#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Confirm Redis is actually running and BullMQ queues exist =="
redis-cli ping
redis-cli keys "bull:*" | head -10

ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)

echo
echo "== B. Set up a driver =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234714${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Batch\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
DRIVER_ID=$(echo "$DRIVER" | jget user.id)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-BATCH-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Camry", "year": 2020, "plateNumber": "LAG-BATCH-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 6.6020, "lng": 3.3517
}' > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234714${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Batch\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)
PASSENGER_ID=$(echo "$PASSENGER" | jget user.id)

echo
echo "== C. SCHEDULED RIDES: book a ride 10 seconds from now (server launched with SCHEDULED_RIDE_LEAD_MINUTES=0 for a fast, real delay) =="
FUTURE=$(node -e "console.log(new Date(Date.now() + 10000).toISOString())")
SCHEDULED=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d "{
  \"category\": \"economy\", \"pickupLat\": 6.6018, \"pickupLng\": 3.3515, \"pickupAddress\": \"A\",
  \"dropoffLat\": 6.4281, \"dropoffLng\": 3.4219, \"dropoffAddress\": \"B\", \"city\": \"Lagos\", \"paymentMethod\": \"wallet\",
  \"scheduledAt\": \"$FUTURE\"
}")
echo "$SCHEDULED" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:', o.status, 'scheduledAt:', o.scheduledAt)})"
SCHEDULED_RIDE_ID=$(echo "$SCHEDULED" | jget id)

echo "passenger's scheduled rides list (should show this one):"
curl -s $BASE/rides/scheduled/mine -H "Authorization: Bearer $PASSENGER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('count:', a.length)})"

echo "confirms it's NOT immediately dispatched (no offer exists for the driver yet):"
curl -s $BASE/rides/$SCHEDULED_RIDE_ID/my-offer -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo "waiting ~15s for the real BullMQ delayed job (10s delay) to fire and activate the ride..."
sleep 15

echo "ride status after the delay (should now be searching, and driver should have received an offer):"
curl -s $BASE/rides/$SCHEDULED_RIDE_ID -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:', o.status)})"
curl -s $BASE/rides/$SCHEDULED_RIDE_ID/my-offer -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== D. Cancelling a still-scheduled ride removes its queued job (book another, cancel immediately) =="
FUTURE2=$(node -e "console.log(new Date(Date.now() + 3600000).toISOString())")
SCHEDULED2=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d "{
  \"category\": \"economy\", \"pickupLat\": 6.6018, \"pickupLng\": 3.3515, \"pickupAddress\": \"A\",
  \"dropoffLat\": 6.4281, \"dropoffLng\": 3.4219, \"dropoffAddress\": \"B\", \"city\": \"Lagos\", \"paymentMethod\": \"wallet\",
  \"scheduledAt\": \"$FUTURE2\"
}")
SCHEDULED2_ID=$(echo "$SCHEDULED2" | jget id)
curl -s -X PATCH $BASE/rides/$SCHEDULED2_ID/cancel -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{"reason":"test"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:', o.status)})"

echo
echo "== E. Rejects a scheduledAt in the past =="
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy", "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B", "city": "Lagos", "paymentMethod": "wallet",
  "scheduledAt": "2020-01-01T00:00:00.000Z"
}'

echo
echo "== F. DRIVER INCENTIVES: admin creates a QUEST (complete 2 trips, earn 1000) =="
QUEST=$(curl -s -X POST $BASE/admin/incentives -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "name": "Welcome quest", "type": "quest", "targetTrips": 2, "rewardAmount": 1000
}')
echo "$QUEST"

echo
echo "driver wallet BEFORE any trips:"
curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo "completing 2 wallet-paid rides with this driver..."
for i in 1 2; do
  su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$PASSENGER_ID';\"" > /dev/null
  R=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
    "category": "economy", "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
    "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B", "city": "Lagos", "paymentMethod": "wallet"
  }')
  RID=$(echo "$R" | jget id)
  curl -s -X PATCH $BASE/rides/$RID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
  curl -s -X PATCH $BASE/rides/$RID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
  curl -s -X PATCH $BASE/rides/$RID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
  curl -s -X PATCH $BASE/rides/$RID/complete -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
  curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
done

sleep 1
echo "driver's incentive progress (quest should show rewarded):"
curl -s $BASE/incentives/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo
echo "driver wallet AFTER completing the quest (should include the 1000 bonus on top of ride earnings):"
curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN"
echo
echo "wallet transactions (should show a BONUS category entry):"
curl -s $BASE/wallet/transactions -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log(a.map(t=>t.category+':'+t.amount).join(', '))})"

echo
echo "== G. OFFLINE CASH RECONCILIATION: drain the driver's wallet, then complete a CASH ride (commission can't be debited) =="
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 0 WHERE \\\"userId\\\"='$DRIVER_ID';\"" > /dev/null

CASH_RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy", "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B", "city": "Lagos", "paymentMethod": "cash"
}')
CASH_RIDE_ID=$(echo "$CASH_RIDE" | jget id)
curl -s -X PATCH $BASE/rides/$CASH_RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$CASH_RIDE_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$CASH_RIDE_ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
echo "completing the cash ride with a ZERO-balance wallet (should NOT throw/block — should complete and record a debt instead):"
curl -s -w "\nHTTP:%{http_code}\n" -X PATCH $BASE/rides/$CASH_RIDE_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(d))"

echo
echo "driver's reconciliation summary (should show an outstanding debt):"
curl -s $BASE/reconciliation/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== H. Auto-settlement: credit the driver's wallet again (another wallet-paid ride), confirm the debt gets auto-settled =="
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$PASSENGER_ID';\"" > /dev/null
R2=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy", "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "A",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "B", "city": "Lagos", "paymentMethod": "wallet"
}')
R2ID=$(echo "$R2" | jget id)
curl -s -X PATCH $BASE/rides/$R2ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$R2ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$R2ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$R2ID/complete -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null

echo "waiting for the wallet.updated -> BullMQ settlement job to process..."
sleep 3

echo "reconciliation summary AFTER the wallet was credited (debt should now be settled, 0 outstanding):"
curl -s $BASE/reconciliation/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== I. Admin views pending reconciliation queue and can write off a debt =="
curl -s $BASE/admin/reconciliation/pending -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('pending count:', a.length)})"

echo
echo "DONE."
