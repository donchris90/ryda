#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Admin login =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)

echo
echo "== B. Two users registering with the SAME device fingerprint (should flag multiple_accounts_same_device) =="
USER1=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234706${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Fraud\", \"lastName\": \"UserOne\", \"role\": \"passenger\",
  \"deviceFingerprint\": \"shared-device-abc123\"
}")
USER1_ID=$(echo "$USER1" | jget user.id)

USER2=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234706${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Fraud\", \"lastName\": \"UserTwo\", \"role\": \"passenger\",
  \"deviceFingerprint\": \"shared-device-abc123\"
}")
USER2_ID=$(echo "$USER2" | jget user.id)
echo "user1: $USER1_ID, user2: $USER2_ID (same device fingerprint)"

echo
echo "== C. Admin lists fraud flags — should see multiple_accounts_same_device =="
curl -s "$BASE/admin/fraud/flags?type=multiple_accounts_same_device" -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== D. GPS spoof: driver reports two locations 500km apart within 1 minute (physically impossible) =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234706${SUFFIX:4:6}3\", \"password\": \"Passw0rd!\", \"firstName\": \"Fraud\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-FRAUD-01", "city": "Lagos"
}' > /dev/null

# First location: Lagos
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 6.5244, "lng": 3.3792
}' > /dev/null
# Second location: Abuja (~500km away), reported immediately after — impossible speed
curl -s -X PATCH $BASE/drivers/location -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "lat": 9.0765, "lng": 7.3986
}' > /dev/null

echo "fraud flags for gps_spoof:"
curl -s "$BASE/admin/fraud/flags?type=gps_spoof" -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== E. Review a flag (mark reviewed with notes) =="
FLAG_ID=$(curl -s "$BASE/admin/fraud/flags?type=gps_spoof" -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data[0].id))")
curl -s -X PATCH $BASE/admin/fraud/flags/$FLAG_ID/review -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "status": "reviewed", "notes": "Confirmed test data, not real spoofing"
}'
echo

echo
echo "== F. Referral abuse: referrer and referee share a device fingerprint =="
REFERRER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234706${SUFFIX:4:6}4\", \"password\": \"Passw0rd!\", \"firstName\": \"Fraud\", \"lastName\": \"Referrer\", \"role\": \"passenger\",
  \"deviceFingerprint\": \"referral-shared-device\"
}")
REFERRER_CODE=$(echo "$REFERRER" | jget user.referralCode)

REFEREE=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234706${SUFFIX:4:6}5\", \"password\": \"Passw0rd!\", \"firstName\": \"Fraud\", \"lastName\": \"Referee\", \"role\": \"passenger\",
  \"referralCode\": \"$REFERRER_CODE\", \"deviceFingerprint\": \"referral-shared-device\"
}")
REFEREE_TOKEN=$(echo "$REFEREE" | jget accessToken)

# Complete a ride to trigger the referral bonus grant + abuse check
DRIVER2=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234706${SUFFIX:4:6}6\", \"password\": \"Passw0rd!\", \"firstName\": \"Fraud\", \"lastName\": \"Driver2\", \"role\": \"driver\"
}")
DRIVER2_TOKEN=$(echo "$DRIVER2" | jget accessToken)
ONBOARD2=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER2_TOKEN" -d '{
  "licenseNumber": "LAG-FRAUD-02", "city": "Lagos"
}')
DRIVER2_PROFILE_ID=$(echo "$ONBOARD2" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER2_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
curl -s -X POST $BASE/vehicles -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER2_TOKEN" -d '{
  "category": "car", "make": "Toyota", "model": "Corolla", "year": 2020, "plateNumber": "LAG-FRAUD-02"
}' > /dev/null
curl -s -X PATCH $BASE/drivers/availability/online -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null

REFEREE_ID=$(echo "$REFEREE" | jget user.id)
su postgres -c "psql -d ryda -c \"UPDATE wallets SET balance = 50000 WHERE \\\"userId\\\"='$REFEREE_ID';\"" > /dev/null

RIDE=$(curl -s -X POST $BASE/rides -H "Content-Type: application/json" -H "Authorization: Bearer $REFEREE_TOKEN" -d '{
  "category": "economy",
  "pickupLat": 6.6018, "pickupLng": 3.3515, "pickupAddress": "Ikeja, Lagos",
  "dropoffLat": 6.4281, "dropoffLng": 3.4219, "dropoffAddress": "Victoria Island, Lagos",
  "city": "Lagos", "paymentMethod": "wallet"
}')
RIDE_ID=$(echo "$RIDE" | jget id)
curl -s -X PATCH $BASE/rides/$RIDE_ID/accept -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/arrived -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/start -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null
curl -s -X PATCH $BASE/rides/$RIDE_ID/complete -H "Authorization: Bearer $DRIVER2_TOKEN" > /dev/null

echo "fraud flags for referral_abuse (bonus should still have been granted despite the flag):"
curl -s "$BASE/admin/fraud/flags?type=referral_abuse" -H "Authorization: Bearer $ADMIN_TOKEN"
echo
echo "referee wallet (should show referral bonus credited despite the flag):"
curl -s $BASE/wallet/transactions -H "Authorization: Bearer $REFEREE_TOKEN"
echo

echo
echo "== G. Non-support/admin user cannot view fraud flags (403) =="
curl -s -w "\nHTTP:%{http_code}\n" $BASE/admin/fraud/flags -H "Authorization: Bearer $DRIVER_TOKEN"

echo
echo "== H. Permissions: check resolved permissions for different roles =="
echo "admin's own permissions:"
curl -s $BASE/permissions/mine -H "Authorization: Bearer $ADMIN_TOKEN"
echo
echo "driver's own permissions (should be empty array - drivers have no admin permissions):"
curl -s $BASE/permissions/mine -H "Authorization: Bearer $DRIVER_TOKEN"
echo

echo
echo "== I. Full permission matrix (admin only) =="
curl -s $BASE/permissions/matrix -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== J. Access control: a FINANCE-role user (payments.refund permission, but not in CommissionController's role list) is blocked from commission management =="
FINANCE_USER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234706${SUFFIX:4:6}7\", \"password\": \"Passw0rd!\", \"firstName\": \"Finance\", \"lastName\": \"Person\", \"role\": \"finance\"
}")
FINANCE_TOKEN=$(echo "$FINANCE_USER" | jget accessToken)
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/admin/commission-rules -H "Content-Type: application/json" -H "Authorization: Bearer $FINANCE_TOKEN" -d '{
  "commissionPercent": 20
}'

echo
echo "DONE."
