#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
SUFFIX=$(date +%s)
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Admin login =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)

echo
echo "== B. Register passenger, create a support ticket (lost item) =="
PASSENGER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234704${SUFFIX:4:6}1\", \"password\": \"Passw0rd!\", \"firstName\": \"Support\", \"lastName\": \"Tester\", \"role\": \"passenger\"
}")
PASSENGER_TOKEN=$(echo "$PASSENGER" | jget accessToken)

TICKET=$(curl -s -X POST $BASE/support/tickets -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "category": "lost_item", "subject": "Left my phone in the car", "description": "I think I left my phone in the back seat during my last ride."
}')
echo "$TICKET"
TICKET_ID=$(echo "$TICKET" | jget id)

echo
echo "== C. Passenger's own ticket list, and fetch by id =="
curl -s $BASE/support/tickets/mine -H "Authorization: Bearer $PASSENGER_TOKEN"
echo
curl -s $BASE/support/tickets/$TICKET_ID -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

echo
echo "== D. A random other passenger CANNOT view this ticket (should 403) =="
OTHER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d "{
  \"phone\": \"+234704${SUFFIX:4:6}2\", \"password\": \"Passw0rd!\", \"firstName\": \"Random\", \"lastName\": \"Other\", \"role\": \"passenger\"
}")
OTHER_TOKEN=$(echo "$OTHER" | jget accessToken)
curl -s -w "\nHTTP:%{http_code}\n" $BASE/support/tickets/$TICKET_ID -H "Authorization: Bearer $OTHER_TOKEN"

echo
echo "== E. Admin lists all tickets, assigns to self, adds a reply, updates status =="
curl -s "$BASE/admin/support/tickets" -H "Authorization: Bearer $ADMIN_TOKEN"
echo
ADMIN_ID=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget user.id)
curl -s -X PATCH $BASE/support/tickets/$TICKET_ID/assign -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d "{\"agentUserId\": \"$ADMIN_ID\"}"
echo
curl -s -X POST $BASE/support/tickets/$TICKET_ID/messages -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "message": "Thanks for reaching out — we found your phone and it will be returned to you."
}'
echo
curl -s -X PATCH $BASE/support/tickets/$TICKET_ID/status/resolved -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== F. Passenger sees the thread (their own message + admin's reply) and notification about status change =="
curl -s -X POST $BASE/support/tickets/$TICKET_ID/messages -H "Content-Type: application/json" -H "Authorization: Bearer $PASSENGER_TOKEN" -d '{
  "message": "Thank you so much!"
}' > /dev/null
curl -s $BASE/support/tickets/$TICKET_ID/messages -H "Authorization: Bearer $PASSENGER_TOKEN"
echo
curl -s $BASE/notifications/mine -H "Authorization: Bearer $PASSENGER_TOKEN"
echo

echo
echo "== G. CMS: admin creates FAQ and Terms pages =="
curl -s -X POST $BASE/admin/cms/pages/faq -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "title": "Frequently Asked Questions", "content": "Q: How do I book a ride? A: Open the app and tap Book Ride."
}'
echo
curl -s -X POST $BASE/admin/cms/pages/terms -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "title": "Terms of Service", "content": "By using Ryda you agree to...", "isPublished": false
}'
echo

echo
echo "== H. Public can read the published FAQ page but NOT the unpublished terms page =="
curl -s $BASE/cms/pages/faq
echo
curl -s -w "\nHTTP:%{http_code}\n" $BASE/cms/pages/terms

echo
echo "== I. Admin creates an announcement, public sees it in active list =="
curl -s -X POST $BASE/admin/cms/announcements -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "title": "Scheduled maintenance", "body": "The app will be briefly unavailable tonight at midnight."
}'
echo
curl -s $BASE/cms/announcements
echo

echo
echo "DONE."
