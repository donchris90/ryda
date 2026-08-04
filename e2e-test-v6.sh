#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Admin login (audit-logged as auth.login.success) =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
echo "admin token: ${ADMIN_TOKEN:0:20}..."

echo
echo "== B. Failed login attempt (audit-logged as auth.login.failed) =="
curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"WrongPassword!"}' > /dev/null

echo
echo "== C. Register + onboard a driver, admin approves (audit-logged as driver.approval.change) =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234703${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"AuditTest\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
ONBOARD=$(curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-AUDIT-01", "city": "Lagos"
}')
DRIVER_PROFILE_ID=$(echo "$ONBOARD" | jget id)
curl -s -X PATCH $BASE/drivers/$DRIVER_PROFILE_ID/approval/approved -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null

echo
echo "== D. Admin creates a promo code (audit-logged as promotion.create) =="
curl -s -X POST $BASE/admin/promotions -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "code": "AUDITTEST", "type": "fixed_amount", "value": 100
}' > /dev/null

echo
echo "== E. Query audit logs — should see login success/failure, driver approval, promotion create =="
curl -s "$BASE/admin/audit-logs?pageSize=10" -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== F. Filter audit logs by action =="
curl -s "$BASE/admin/audit-logs?action=driver.approval.change" -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== G. Non-admin cannot read audit logs =="
curl -s -w "\nHTTP:%{http_code}\n" "$BASE/admin/audit-logs" -H "Authorization: Bearer $DRIVER_TOKEN"

echo
echo "== H. Analytics overview =="
curl -s $BASE/admin/analytics/overview -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== I. Analytics: rides by status =="
curl -s $BASE/admin/analytics/rides-by-status -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== J. Analytics: revenue time series =="
curl -s "$BASE/admin/analytics/revenue?groupBy=day" -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== K. Analytics: top drivers =="
curl -s "$BASE/admin/analytics/top-drivers?limit=5" -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== L. Analytics: pickup heatmap =="
curl -s $BASE/admin/analytics/heatmap -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== M. Non-admin cannot access analytics =="
curl -s -w "\nHTTP:%{http_code}\n" $BASE/admin/analytics/overview -H "Authorization: Bearer $DRIVER_TOKEN"

echo
echo "DONE."
