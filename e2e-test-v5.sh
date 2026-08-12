#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Register fleet owner =="
OWNER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234702${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Fleet\", \"lastName\": \"Owner\", \"role\": \"fleet_owner\"
}")
OWNER_TOKEN=$(echo "$OWNER" | jget accessToken)

echo
echo "== B. Create fleet company (auto-creates wallet + owner staff record) =="
COMPANY=$(curl -s -X POST $BASE/fleet/companies -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER_TOKEN" -d '{
  "name": "Lagos Rides Fleet Ltd", "city": "Lagos"
}')
echo "$COMPANY"
COMPANY_ID=$(echo "$COMPANY" | jget id)

echo
echo "== C. Try creating a second company as the same owner (should fail - already staff) =="
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/fleet/companies -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER_TOKEN" -d '{
  "name": "Second Fleet", "city": "Abuja"
}'

echo
echo "== D. Register a fleet driver, onboard, approve, register vehicle (independently first) =="
FLEET_DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234702${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Fleet\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
FLEET_DRIVER_TOKEN=$(echo "$FLEET_DRIVER" | jget accessToken)
FLEET_DRIVER_ID=$(echo "$FLEET_DRIVER" | jget user.id)

ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $FLEET_DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-FLEET-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
su postgres -c "psql -d ryda -c \"UPDATE driver_profiles SET \\\"approvalStatus\\\"='approved' WHERE id='$DRIVER_PROFILE_ID';\"" > /dev/null

VEHICLE=$(curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $FLEET_DRIVER_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Sienna", "year": 2022, "plateNumber": "LAG-FLEET-CAR-01"
}')
VEHICLE_ID=$(echo "$VEHICLE" | jget id)
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $FLEET_DRIVER_TOKEN" > /dev/null
echo "driver+vehicle ready, vehicle id: $VEHICLE_ID"

echo
echo "== E. Fleet owner assigns the driver and vehicle to their fleet =="
curl -s -X POST $BASE/fleet/companies/mine/drivers -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER_TOKEN" -d "{
  \"driverUserId\": \"$FLEET_DRIVER_ID\"
}"
echo
curl -s -X POST $BASE/fleet/companies/mine/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER_TOKEN" -d "{
  \"vehicleId\": \"$VEHICLE_ID\"
}"
echo

echo
echo "== F. Owner lists fleet drivers/vehicles =="
curl -s $BASE/fleet/companies/mine/drivers -H "Authorization: Bearer $OWNER_TOKEN"
echo
curl -s $BASE/fleet/companies/mine/vehicles -H "Authorization: Bearer $OWNER_TOKEN"
echo

echo
echo "== G. Add a manager to the fleet =="
MANAGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234702${SUFFIX:4:6}3\", \"password\": \"Passw0rd!\", \"firstName\": \"Fleet\", \"lastName\": \"Manager\", \"role\": \"passenger\"
}")
MANAGER_ID=$(echo "$MANAGER" | jget user.id)
curl -s -X POST $BASE/fleet/companies/mine/managers -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER_TOKEN" -d "{
  \"userId\": \"$MANAGER_ID\"
}"
echo

echo
echo "== H. Passenger requests + completes a WALLET ride with the fleet driver — earnings should land in FLEET wallet, not driver's personal wallet =="
PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234702${SUFFIX:4:6}4\", \"password\": \"Passw0rd!\", \"firstName\": \"Fleet\", \"lastName\": \"Rider\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)
PASSENGER_ID=$(echo "$PASSENGER" | jget user.id)
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$PASSENGER_ID';\"" > /dev/null

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
TOTAL_FARE=$(echo "$RIDE" | jget totalFare)
echo "ride: $RIDE_ID, fare: $TOTAL_FARE"

curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $FLEET_DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $FLEET_DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $FLEET_DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $FLEET_DRIVER_TOKEN" > /dev/null

echo
echo "driver's PERSONAL wallet (should be UNCHANGED, still 0):"
curl -s $BASE/wallet -H "Authorization: Bearer $FLEET_DRIVER_TOKEN"
echo
echo "FLEET wallet (should be credited driverEarnings, ~75% of fare for a rookie):"
curl -s $BASE/fleet/companies/mine/wallet -H "Authorization: Bearer $OWNER_TOKEN"
echo
echo "fleet wallet transactions:"
curl -s $BASE/fleet/companies/mine/wallet/transactions -H "Authorization: Bearer $OWNER_TOKEN"
echo

echo
echo "== I. Fleet analytics =="
curl -s $BASE/fleet/companies/mine/analytics -H "Authorization: Bearer $OWNER_TOKEN"
echo

echo
echo "== J. Fleet payout request (no Paystack key -> simulated success) =="
PAYOUT=$(curl -s -X POST $BASE/fleet/companies/mine/payouts -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER_TOKEN" -d '{
  "amount": 1000, "bankAccountNumber": "0123456789", "bankCode": "058"
}')
echo "$PAYOUT"

echo
echo "fleet wallet after payout (balance reduced by 1000):"
curl -s $BASE/fleet/companies/mine/wallet -H "Authorization: Bearer $OWNER_TOKEN"
echo

echo
echo "== K. Manager (non-owner) can view but not add another manager =="
MANAGER_LOGIN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d "{\"phone\":\"+234702${SUFFIX:4:6}3\",\"password\":\"Passw0rd!\"}")
MANAGER_TOKEN=$(echo "$MANAGER_LOGIN" | jget accessToken)
curl -s $BASE/fleet/companies/mine -H "Authorization: Bearer $MANAGER_TOKEN"
echo
OTHER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234702${SUFFIX:4:6}5\", \"password\": \"Passw0rd!\", \"firstName\": \"Random\", \"lastName\": \"Person\", \"role\": \"passenger\"
}")
OTHER_ID=$(echo "$OTHER" | jget user.id)
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/fleet/companies/mine/managers -H "Content-Type: application/json" -H "Authorization: Bearer $MANAGER_TOKEN" -d "{
  \"userId\": \"$OTHER_ID\"
}"

echo
echo "DONE."
