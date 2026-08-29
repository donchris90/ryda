#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== 1. Register passenger =="
PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{
  "email": "ada.obi@example.com", "phone": "+2348011112222", "password": "Passw0rd!", "firstName": "Ada", "lastName": "Obi", "termsAccepted": true, "role": "passenger"
}')
echo "$PASSENGER"
PASSENGER_ID=$(echo "$PASSENGER" | jget userId)
su postgres -c "psql -d ryda -c \"UPDATE users SET \\\"isEmailVerified\\\"=true WHERE id='$PASSENGER_ID';\""
PASSENGER_LOGIN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"email":"ada.obi@example.com","password":"Passw0rd!"}')
PASSENGER_TOKEN=$(echo "$PASSENGER_LOGIN" | jget accessToken)
echo "passenger id: $PASSENGER_ID"

echo
echo "== 2. Register driver =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{
  "email": "musa.bello@example.com", "phone": "+2348022223333", "password": "Passw0rd!", "firstName": "Musa", "lastName": "Bello", "termsAccepted": true, "role": "driver"
}')
echo "$DRIVER"
DRIVER_ID=$(echo "$DRIVER" | jget userId)
su postgres -c "psql -d ryda -c \"UPDATE users SET \\\"isEmailVerified\\\"=true WHERE id='$DRIVER_ID';\""
DRIVER_LOGIN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"email":"musa.bello@example.com","password":"Passw0rd!"}')
DRIVER_TOKEN=$(echo "$DRIVER_LOGIN" | jget accessToken)
echo "driver id: $DRIVER_ID"

echo
echo "== 3. Onboard driver =="
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-DR-00123", "city": "Lagos", "services": ["ride", "delivery"]
}')
echo "$ONBOARD"
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
echo "driver profile id: $DRIVER_PROFILE_ID"

echo
echo "== 4. Approve driver (simulated admin action via SQL, no admin user seeded yet) =="
su postgres -c "psql -d ryda -c \"UPDATE driver_profiles SET \\\"approvalStatus\\\"='approved' WHERE id='$DRIVER_PROFILE_ID';\""

echo
echo "== 5. Register vehicle (auto-becomes active vehicle) =="
VEHICLE=$(curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Corolla", "year": 2019, "plateNumber": "LAG-123-XY"
}')
echo "$VEHICLE"
VEHICLE_ID=$(echo "$VEHICLE" | jget id)
echo "vehicle id: $VEHICLE_ID"

echo
echo "== 5b. Approve required documents (license, insurance, roadworthiness) — now a genuine prerequisite for going online, simulated via SQL same as the driver-profile approval above =="
su postgres -c "psql -d ryda -c \"
INSERT INTO driver_documents (id, \\\"driverProfileId\\\", type, \\\"documentUrl\\\", status, \\\"createdAt\\\", \\\"updatedAt\\\")
VALUES
  (gen_random_uuid(), '$DRIVER_PROFILE_ID', 'drivers_license', 'https://example.com/license.jpg', 'approved', now(), now()),
  (gen_random_uuid(), '$DRIVER_PROFILE_ID', 'insurance', 'https://example.com/insurance.jpg', 'approved', now(), now()),
  (gen_random_uuid(), '$DRIVER_PROFILE_ID', 'road_worthiness', 'https://example.com/roadworthiness.jpg', 'approved', now(), now());
\""

echo
echo "== 6. Driver goes online =="
ONLINE=$(curl -s -X PATCH $BASE/drivers/availability/online_for_both -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$ONLINE"

echo
echo "== 7. Fare estimate (Ikeja -> Victoria Island, Lagos) =="
ESTIMATE=$(curl -s -X POST $BASE/rides/estimate -H "Content-Type: application/json" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515,
  "dropoffLat": 6.4281, "dropoffLng": 3.4219
}')
echo "$ESTIMATE"

echo
echo "== 8. Passenger requests ride (wallet payment) =="
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$PASSENGER_ID';\""

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos",
  "paymentMethod": "wallet"
}')
echo "$RIDE"
RIDE_ID=$(echo "$RIDE" | jget id)
TOTAL_FARE=$(echo "$RIDE" | jget totalFare)
echo "ride id: $RIDE_ID, totalFare: $TOTAL_FARE"

echo
echo "== 9. Driver accepts ride =="
ACCEPT=$(curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$ACCEPT"

echo
echo "== 10. Driver marks arrived =="
curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== 11. Driver starts ride =="
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== 12. Driver completes ride (this settles wallet + commission) =="
COMPLETE=$(curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$COMPLETE"

echo
echo "== 13. Check passenger wallet (should be debited totalFare) =="
curl -s $BASE/wallet -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

echo
echo "== 14. Check driver wallet (should be credited totalFare - commission) =="
curl -s $BASE/wallet -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== 15. Check driver profile (trip count should be 1, level rookie) =="
curl -s $BASE/drivers/me -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== 16. Wallet transaction history for driver =="
curl -s $BASE/wallet/transactions -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "DONE."
