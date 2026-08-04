#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

PHONE="+234724${SUFFIX:4:6}1"
EMAIL="testuser${SUFFIX}@example.com"

echo "== A. Register with both phone and email =="
REG=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"$PHONE\", \"email\": \"$EMAIL\", \"password\": \"Passw0rd!\", \"firstName\": \"Emeka\", \"lastName\": \"Test\", \"role\": \"passenger\"
}")
echo "$REG" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log('registered, email saved:', r.user.email)})"

echo
echo "== B. Duplicate email should be rejected on a second registration =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234724${SUFFIX:4:6}2\", \"email\": \"$EMAIL\", \"password\": \"Passw0rd!\", \"firstName\": \"Dup\", \"lastName\": \"Test\", \"role\": \"passenger\"
}"

echo
echo "== C. Login with PHONE + password (existing behavior, must still work) =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/login -H "Content-Type: application/json" -d "{
  \"phone\": \"$PHONE\", \"password\": \"Passw0rd!\"
}" | head -c 200
echo

echo
echo "== D. Login with EMAIL + password (new) =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/login -H "Content-Type: application/json" -d "{
  \"email\": \"$EMAIL\", \"password\": \"Passw0rd!\"
}" | head -c 200
echo

echo
echo "== E. Login with EMAIL + WRONG password should be rejected =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/login -H "Content-Type: application/json" -d "{
  \"email\": \"$EMAIL\", \"password\": \"WrongPassword!\"
}"

echo
echo "== F. Login with NEITHER phone nor email should be a clean 400, not a 500 =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{
  "password": "Passw0rd!"
}'

echo
echo "== G. Login with a non-existent email should be rejected cleanly =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{
  "email": "doesnotexist@example.com", "password": "Passw0rd!"
}'

echo
echo "== H. Register with NO email (still optional) should still work =="
curl -s -w "\n[HTTP:%{http_code}]\n" -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234724${SUFFIX:4:6}3\", \"password\": \"Passw0rd!\", \"firstName\": \"NoEmail\", \"lastName\": \"Test\", \"role\": \"passenger\"
}" | head -c 200
echo

echo
echo "DONE."
