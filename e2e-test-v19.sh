#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. /metrics returns real Prometheus exposition format =="
curl -s -w "\n[HTTP:%{http_code}]\n" http://localhost:3000/api/v1/metrics | head -20

echo
echo "== B. Baseline counter values before any activity =="
BEFORE_RIDES=$(curl -s http://localhost:3000/api/v1/metrics | grep "^ryda_ride_requests_total" | awk '{sum+=$NF} END {print sum+0}')
BEFORE_HTTP=$(curl -s http://localhost:3000/api/v1/metrics | grep "^ryda_http_requests_total" | awk '{sum+=$NF} END {print sum+0}')
echo "ride_requests_total before: $BEFORE_RIDES"
echo "http_requests_total before: $BEFORE_HTTP"

echo
echo "== C. Trigger real activity: register a driver+passenger, request+complete a ride =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234715${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Metrics\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-METRICS-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Kia", "model": "Rio", "year": 2021, "plateNumber": "LAG-METRICS-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 6.6020, "lng": 3.3517
}' > /dev/null

PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234715${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Metrics\", \"lastName\": \"Passenger\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)

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

echo
echo "== D. Counters AFTER activity — should have genuinely increased =="
AFTER_RIDES=$(curl -s http://localhost:3000/api/v1/metrics | grep "^ryda_ride_requests_total" | awk '{sum+=$NF} END {print sum+0}')
AFTER_COMPLETIONS=$(curl -s http://localhost:3000/api/v1/metrics | grep "^ryda_ride_completions_total" | awk '{sum+=$NF} END {print sum+0}')
AFTER_OFFERS=$(curl -s http://localhost:3000/api/v1/metrics | grep "^ryda_dispatch_offers_total " | awk '{print $NF}')
AFTER_WALLET=$(curl -s http://localhost:3000/api/v1/metrics | grep "^ryda_wallet_transactions_total" | awk '{sum+=$NF} END {print sum+0}')
AFTER_HTTP=$(curl -s http://localhost:3000/api/v1/metrics | grep "^ryda_http_requests_total" | awk '{sum+=$NF} END {print sum+0}')
echo "ride_requests_total: $BEFORE_RIDES -> $AFTER_RIDES"
echo "ride_completions_total (should be >=1): $AFTER_COMPLETIONS"
echo "dispatch_offers_total (should be >=1): $AFTER_OFFERS"
echo "wallet_transactions_total (should be >=1): $AFTER_WALLET"
echo "http_requests_total: $BEFORE_HTTP -> $AFTER_HTTP"

echo
echo "== E. Default process metrics are present (proves collectDefaultMetrics ran) =="
curl -s http://localhost:3000/api/v1/metrics | grep -c "^process_cpu_user_seconds_total\|^nodejs_heap_size"

echo
echo "== F. A 400 (validation error) should NOT appear as a Sentry-worthy error — just confirm the app stays healthy after one =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{"phone": "not-a-real-phone"}'
curl -s http://localhost:3000/api/v1/health
echo

echo
echo "DONE."
