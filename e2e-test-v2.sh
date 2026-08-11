#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Admin login =="
ADMIN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{
  "phone": "+2348099998888", "password": "AdminPass123!"
}')
ADMIN_TOKEN=$(echo "$ADMIN" | jget accessToken)
ADMIN_REFRESH=$(echo "$ADMIN" | jget refreshToken)
echo "admin role: $(echo "$ADMIN" | jget user.role)"

echo
echo "== B. Refresh token rotation: use it once (should succeed) =="
REFRESHED=$(curl -s -X POST $BASE/auth/refresh -H "Content-Type: application/json" -d "{\"refreshToken\": \"$ADMIN_REFRESH\"}")
NEW_ACCESS=$(echo "$REFRESHED" | jget accessToken)
echo "got new access token: ${NEW_ACCESS:0:20}..."

echo
echo "== C. Refresh token reuse detection: reuse the OLD (now-revoked) refresh token (should fail with 401) =="
REUSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST $BASE/auth/refresh -H "Content-Type: application/json" -d "{\"refreshToken\": \"$ADMIN_REFRESH\"}")
echo "$REUSE"

echo
echo "== D. Register corporate account owner =="
CORP_OWNER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{
  "phone": "+2348033334444", "password": "Passw0rd!", "firstName": "Chidi", "lastName": "Okafor", "role": "corporate"
}')
CORP_TOKEN=$(echo "$CORP_OWNER" | jget accessToken)
echo "corp owner registered"

echo
echo "== E. Register a passenger to be a corporate employee =="
EMPLOYEE=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{
  "phone": "+2348044445555", "password": "Passw0rd!", "firstName": "Ngozi", "lastName": "Eze", "role": "passenger"
}')
EMPLOYEE_TOKEN=$(echo "$EMPLOYEE" | jget accessToken)
EMPLOYEE_ID=$(echo "$EMPLOYEE" | jget user.id)
echo "employee id: $EMPLOYEE_ID"

echo
echo "== F. Create corporate account with budget, add employee =="
ACCOUNT=$(curl -s -X POST $BASE/corporate/accounts -H "Content-Type: application/json" -H "Authorization: Bearer $CORP_TOKEN" -d '{
  "companyName": "Acme Logistics", "initialBudget": 100000
}')
echo "$ACCOUNT"
ADD_EMP=$(curl -s -X POST $BASE/corporate/accounts/mine/employees -H "Content-Type: application/json" -H "Authorization: Bearer $CORP_TOKEN" -d "{\"userId\": \"$EMPLOYEE_ID\"}")
echo "$ADD_EMP"

echo
echo "== G. Register a second driver for the corporate/card ride, onboard/approve/vehicle/online =="
DRIVER2=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{
  "phone": "+2348055556666", "password": "Passw0rd!", "firstName": "Tunde", "lastName": "Alabi", "role": "driver"
}')
DRIVER2_TOKEN=$(echo "$DRIVER2" | jget accessToken)
DRIVER2_ID=$(echo "$DRIVER2" | jget user.id)

ONBOARD2=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER2_TOKEN" -d '{
  "licenseNumber": "LAG-DR-00999", "city": "Lagos"
}')
DRIVER2_PROFILE_ID=$(echo "$ONBOARD2" | jget id)
su postgres -c "psql -d ryda -c \"UPDATE driver_profiles SET \\\"approvalStatus\\\"='approved' WHERE id='$DRIVER2_PROFILE_ID';\"" > /dev/null

curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER2_TOKEN" -d '{
  "category": "car", "make": "Kia", "model": "Rio", "year": 2020, "plateNumber": "LAG-999-ZZ"
}' > /dev/null

curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null

echo
echo "== H. Driver updates GPS location =="
LOC=$(curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER2_TOKEN" -d '{
  "lat": 6.6050, "lng": 3.3490
}')
echo "$LOC" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('lat/lng set:', o.currentLat, o.currentLng)})"

echo
echo "== I. Corporate-paid ride: employee requests a ride with paymentMethod=corporate =="
RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $EMPLOYEE_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos",
  "paymentMethod": "corporate"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
TOTAL_FARE=$(echo "$RIDE" | jget totalFare)
echo "corporate ride id: $RIDE_ID, fare: $TOTAL_FARE"

echo
echo "== J. Admin/dispatch: find nearby drivers for this ride =="
NEARBY=$(curl -s "$BASE/rides/$RIDE_ID/nearby-drivers" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$NEARBY"

echo
echo "== K. Driver2 accepts, arrives, starts, completes the corporate ride =="
curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
COMPLETE=$(curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER2_TOKEN")
echo "$COMPLETE"

echo
echo "== L. Check corporate account budget was debited =="
curl -s $BASE/corporate/accounts/mine -H "Authorization: Bearer $CORP_TOKEN"
echo
echo "== L2. Corporate transaction ledger =="
curl -s $BASE/corporate/accounts/mine/transactions -H "Authorization: Bearer $CORP_TOKEN"
echo

echo
echo "== M. Ratings: employee rates driver, driver rates employee =="
RATE_DRIVER=$(curl -s -X POST $BASE/rides/$RIDE_ID/rate/driver -H "Content-Type: application/json" -H "Authorization: Bearer $EMPLOYEE_TOKEN" -d '{
  "rating": 5, "comment": "Smooth ride, great music"
}')
echo "$RATE_DRIVER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('driverRating on ride:', o.driverRating)})"

RATE_PASSENGER=$(curl -s -X POST $BASE/rides/$RIDE_ID/rate/passenger -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER2_TOKEN" -d '{
  "rating": 4, "comment": "Polite passenger"
}')
echo "$RATE_PASSENGER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('passengerRating on ride:', o.passengerRating)})"

echo
echo "== N. Check driver2 profile rating average updated =="
curl -s $BASE/drivers/me -H "Authorization: Bearer $DRIVER2_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('driver rating avg:', o.rating, 'count:', o.ratingCount)})"

echo
echo "== O. Double-rating should fail =="
DOUBLE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST $BASE/rides/$RIDE_ID/rate/driver -H "Content-Type: application/json" -H "Authorization: Bearer $EMPLOYEE_TOKEN" -d '{"rating": 3}')
echo "$DOUBLE"

echo
echo "== P. Card payment ride: employee (as passenger role too) not needed - use original passenger from wallet test would conflict; register a fresh passenger for card payment =="
CARD_PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{
  "phone": "+2348066667777", "password": "Passw0rd!", "firstName": "Femi", "lastName": "Sola", "role": "passenger"
}')
CARD_TOKEN=$(echo "$CARD_PASSENGER" | jget accessToken)

CARD_RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $CARD_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos",
  "paymentMethod": "card"
}')
CARD_RIDE_ID=$(echo "$CARD_RIDE" | jget id)
curl -s -X PATCH $BASE/rides/$CARD_RIDE_ID/accept -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$CARD_RIDE_ID/arrived -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$CARD_RIDE_ID/start -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
CARD_COMPLETE=$(curl -s -X PATCH $BASE/rides/$CARD_RIDE_ID/complete -H "Authorization: Bearer $DRIVER2_TOKEN")
echo "$CARD_COMPLETE"

echo
echo "== Q. Check payment record was created for the card ride =="
curl -s $BASE/payments/mine -H "Authorization: Bearer $CARD_TOKEN"
echo

echo
echo "== R. Admin views all commission rules (should be empty list, falls back to defaults) =="
curl -s $BASE/admin/commission-rules -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== S. Rate limiting: hammer login endpoint 12 times, expect a 429 near the end (limit=10/min) =="
for i in $(seq 1 12); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"wrong"}')
  echo "attempt $i: $STATUS"
done

echo
echo "DONE."
