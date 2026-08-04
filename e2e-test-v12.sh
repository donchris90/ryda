#!/bin/bash
set -e
BASE=http://localhost:3000/api/v1
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const path='$1'.split('.');let v=o;for(const p of path)v=v[p];console.log(v)}catch(e){console.log('PARSE_ERR:',d)}})"; }

echo "== A. Admin login, create a campaign =="
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d '{"phone":"+2348099998888","password":"AdminPass123!"}' | jget accessToken)
CAMPAIGN=$(curl -s -X POST $BASE/admin/ads/campaigns -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "name": "Q1 Launch Promo", "advertiserName": "Coca-Cola Nigeria", "budget": 500000
}')
echo "$CAMPAIGN"
CAMPAIGN_ID=$(echo "$CAMPAIGN" | jget id)

echo
echo "== B. Activate the campaign =="
curl -s -X PATCH $BASE/admin/ads/campaigns/$CAMPAIGN_ID/status/active -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== C. Create a banner ad for the home screen, linked to the campaign =="
BANNER=$(curl -s -X POST $BASE/admin/ads/banners -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d "{
  \"campaignId\": \"$CAMPAIGN_ID\", \"title\": \"Refresh with Coke\", \"imageUrl\": \"https://example.com/coke-banner.jpg\",
  \"targetUrl\": \"https://coca-cola.com/promo\", \"placement\": \"home_screen\"
}")
echo "$BANNER"
BANNER_ID=$(echo "$BANNER" | jget id)

echo
echo "== D. Create a second banner for a DIFFERENT placement (should not show in home_screen query) =="
curl -s -X POST $BASE/admin/ads/banners -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "title": "Ride Screen Ad", "imageUrl": "https://example.com/other.jpg", "targetUrl": "https://example.com", "placement": "ride_screen"
}' > /dev/null

echo
echo "== E. Public: active banners for home_screen placement (should only show banner 1) =="
curl -s "$BASE/ads/banners?placement=home_screen"
echo

echo
echo "== F. Public: record 3 impressions and 1 click on the banner =="
curl -s -X POST $BASE/ads/banners/$BANNER_ID/impression > /dev/null
curl -s -X POST $BASE/ads/banners/$BANNER_ID/impression > /dev/null
curl -s -X POST $BASE/ads/banners/$BANNER_ID/impression > /dev/null
curl -s -w "\nHTTP:%{http_code}\n" -o /dev/null "$BASE/ads/banners/$BANNER_ID/click"

echo
echo "== G. Admin views the banner with tracked stats (impressions:3, clicks:1) =="
curl -s $BASE/admin/ads/banners -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== H. Deactivate the banner, confirm it no longer shows publicly =="
curl -s -X PATCH $BASE/admin/ads/banners/$BANNER_ID/active/false -H "Authorization: Bearer $ADMIN_TOKEN"
echo
echo "public list after deactivation (should be empty):"
curl -s "$BASE/ads/banners?placement=home_screen"
echo

echo
echo "== I. Sponsored locations: create one, then query nearby vs far =="
LOCATION=$(curl -s -X POST $BASE/admin/ads/sponsored-locations -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{
  "name": "KFC Ikeja", "lat": 6.6020, "lng": 3.3517, "radiusKm": 1, "targetUrl": "https://kfc.com/ikeja"
}')
echo "$LOCATION"

echo "nearby (point very close to KFC):"
curl -s "$BASE/ads/sponsored-locations/nearby?lat=6.6018&lng=3.3515"
echo
echo "far away (Victoria Island, ~20km):"
curl -s -w "\nHTTP:%{http_code}\n" "$BASE/ads/sponsored-locations/nearby?lat=6.4281&lng=3.4219"

echo
echo "== J. Admin sees the sponsored location's impression count incremented from the nearby query =="
curl -s $BASE/admin/ads/sponsored-locations -H "Authorization: Bearer $ADMIN_TOKEN"
echo

echo
echo "== K. Non-marketing/admin user cannot manage ads (403) =="
DRIVER=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{
  "phone": "+2348079990001", "password": "Passw0rd!", "firstName": "Ads", "lastName": "Tester", "role": "driver"
}')
DRIVER_TOKEN=$(echo "$DRIVER" | jget accessToken)
curl -s -w "\nHTTP:%{http_code}\n" -X POST $BASE/admin/ads/campaigns -H "Content-Type: application/json" -H "Authorization: Bearer $DRIVER_TOKEN" -d '{
  "name": "Sneaky Campaign", "advertiserName": "Nobody"
}'

echo
echo "DONE."
