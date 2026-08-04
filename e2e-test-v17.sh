#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Register a user, upload a profile photo (real multipart upload, local-disk driver) =="
USER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234713${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Storage\", \"lastName\": \"Tester\", \"role\": \"passenger\"
}")
TOKEN=$(echo "$USER" | jget accessToken)

echo "test image content" > /tmp/test-photo.txt
UPLOAD=$(curl -s -X POST $BASE/users/me/profile-photo -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/test-photo.txt;type=image/jpeg")
echo "$UPLOAD"
PHOTO_URL=$(echo "$UPLOAD" | jget profilePhotoUrl)
echo "photo url: $PHOTO_URL"

echo
echo "== B. Fetch the uploaded file back and confirm content matches =="
curl -s "$PHOTO_URL"
echo

echo
echo "== C. Confirm the profile now reflects the photo URL =="
curl -s $BASE/users/me -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log('profilePhotoUrl set:', !!o.profilePhotoUrl)})"

echo
echo "== D. Search: create an airport, then search for it by partial name =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
curl -s -X POST $BASE/airports -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "name": "Nnamdi Azikiwe International Airport", "iataCode": "ABV", "city": "Abuja", "lat": 9.0067, "lng": 7.2632
}' > /dev/null

echo "search 'Azikiwe' (partial name match):"
curl -s "$BASE/search/airports?q=Azikiwe" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('results:', a.map(r=>r.name).join(', '))})"

echo "search 'ABV' (IATA code match):"
curl -s "$BASE/search/airports?q=ABV" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('results:', a.map(r=>r.iataCode).join(', '))})"

echo "search 'zzz-nomatch' (should return empty):"
curl -s "$BASE/search/airports?q=zzz-nomatch" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('results count:', a.length)})"

echo
echo "== E. Search drivers by license/name (admin only, verify RBAC) =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234713${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Findme\", \"lastName\": \"Driver\", \"role\": \"driver\"
}")
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
curl -s -X POST $BASE/drivers/onboard -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "licenseNumber": "LAG-SEARCH-01", "city": "Lagos"
}' > /dev/null

echo "admin searching for 'Findme':"
curl -s "$BASE/search/drivers?q=Findme" -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('results:', a.map(r=>r.firstName+' '+r.lastName).join(', '))})"

echo "non-admin (driver) cannot search drivers (403):"
curl -s -w "\nHTTP:%{http_code}\n" "$BASE/search/drivers?q=Findme" -H "Authorization: Bearer $DRIVER_TOKEN"

echo
echo "DONE."
