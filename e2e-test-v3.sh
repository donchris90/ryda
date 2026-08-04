#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Admin login =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
echo "admin token: ${ADMIN_TOKEN:0:20}..."

echo
echo "== B. Register referrer passenger =="
REFERRER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234700${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Referrer\", \"lastName\": \"One\", \"role\": \"passenger\"
}")
REFERRER_CODE=$(echo "$REFERRER" | jget user.referralCode)
REFERRER_TOKEN=$(echo "$REFERRER" | jget accessToken)
echo "referrer code: $REFERRER_CODE"

echo
echo "== C. Register referee passenger using referrer's code =="
REFEREE=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234700${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Referee\", \"lastName\": \"Two\", \"role\": \"passenger\",
  \"referralCode\": \"$REFERRER_CODE\"
}")
REFEREE_TOKEN=$(echo "$REFEREE" | jget accessToken)
REFEREE_ID=$(echo "$REFEREE" | jget user.id)
echo "referee registered, referredByCode should be set"

echo
echo "== D. Passenger profile: get (lazy-create), set preferences, set home/work, add favourite, add emergency contact =="
curl -s $BASE/passengers/me -H "Authorization: Bearer $REFEREE_TOKEN"
echo
curl -s -X PATCH $BASE/passengers/me/preferences -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "preferredLanguage": "en", "musicPreference": "afrobeats", "chatPreference": "chatty"
}'
echo
curl -s -X POST $BASE/passengers/me/home -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "lat": 6.6018, "lng": 3.3515, "address": "12 Allen Ave, Ikeja"
}'
echo
curl -s -X POST $BASE/passengers/me/favourites -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "label": "Gym", "lat": 6.61, "lng": 3.35, "address": "Fitness Center, Ikeja"
}'
echo
curl -s -X POST $BASE/passengers/me/emergency-contacts -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "name": "Mom", "phone": "+2348012340000", "relationship": "mother"
}'
echo

echo
echo "== E. Admin creates a promo code (20% off, max 500, min fare 1000) =="
PROMO=$(curl -s -X POST $BASE/admin/promotions -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "code": "WELCOME20", "type": "percentage", "value": 20, "maxDiscountAmount": 500, "minFareAmount": 1000, "usageLimitPerUser": 1
}')
echo "$PROMO"

echo
echo "== F. Validate promo (preview, no redeem) =="
curl -s -X POST $BASE/promotions/validate -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "code": "WELCOME20", "fareAmount": 4123.60
}'
echo

echo
echo "== G. Set up driver, onboard/approve/vehicle/online =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234700${SUFFIX:4:6}3\", \"password\": \"Passw0rd!\", \"firstName\": \"Driver\", \"lastName\": \"Three\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-DR-PROMO1", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
su postgres -c "psql -d ryda -c \"UPDATE driver_profiles SET \\\"approvalStatus\\\"='approved' WHERE id='$DRIVER_PROFILE_ID';\"" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "category": "car", "make": "Honda", "model": "Accord", "year": 2021, "plateNumber": "LAG-PROMO-01"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
echo "driver ready"

echo
echo "== H. Referee requests a ride WITH promo code (should discount totalFare) =="
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$REFEREE_ID';\"" > /dev/null
RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet", "promoCode": "WELCOME20"
}')
echo "$RIDE"
RIDE_ID=$(echo "$RIDE" | jget id)
DISCOUNT=$(echo "$RIDE" | jget discount)
TOTAL=$(echo "$RIDE" | jget totalFare)
echo "ride id: $RIDE_ID, discount: $DISCOUNT, totalFare after discount: $TOTAL"

echo
echo "== I. Try to reuse the same promo code on a second ride request (should fail - usageLimitPerUser=1) =="
REUSE=$(curl -s -w "\nHTTP:%{http_code}" -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet", "promoCode": "WELCOME20"
}')
echo "$REUSE"

echo
echo "== J. Complete the discounted ride (this should also trigger the referral bonus on referee's first completed ride) =="
curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER_TOKEN" > /dev/null
COMPLETE=$(curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$COMPLETE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('status:',o.status,'totalFare:',o.totalFare,'earningsSettled:',o.earningsSettled)})"

echo
echo "== K. Check referee wallet (should have referral bonus credited on top of ride debit) =="
curl -s $BASE/wallet -H "Authorization: Bearer $REFEREE_TOKEN"
echo
echo "== K2. Check referrer wallet (should have referral bonus credited) =="
curl -s $BASE/wallet -H "Authorization: Bearer $REFERRER_TOKEN"
echo
echo "== K3. Referee wallet transactions (should show referral + ride_payment) =="
curl -s $BASE/wallet/transactions -H "Authorization: Bearer $REFEREE_TOKEN"
echo

echo
echo "== L. Check passenger statistics updated =="
curl -s $BASE/passengers/me -H "Authorization: Bearer $REFEREE_TOKEN"
echo

echo
echo "== M. Admin blacklists the referee, then referee tries to request another ride (should fail) =="
curl -s -X PATCH $BASE/passengers/$REFEREE_ID/blacklist -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "blacklisted": true, "reason": "test blacklist"
}'
echo
BLOCKED=$(curl -s -w "\nHTTP:%{http_code}" -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet"
}')
echo "$BLOCKED"

echo
echo "== N. Card-on-file init (simulated, no Paystack key configured) =="
curl -s -X POST $BASE/payments/cards/add-init -H "Authorization: Bearer $DRIVER_TOKEN" -w "\nHTTP:%{http_code}"
echo

echo
echo "DONE."
