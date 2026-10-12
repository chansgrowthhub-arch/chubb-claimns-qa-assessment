#!/usr/bin/env bash
# Creates loaduser1..N@demo.com (password LoadUser123!, role claimant) in the demo-app realm.
#
# Why: Keycloak brute-force protection is enabled in the realm, and concurrent password grants
# for the SAME account are rejected (about half return 401 with correct credentials). A load
# test that shares one account therefore measures Keycloak contention, not the app. Each k6
# VU logs in as its own user instead. Safe to re-run: existing users return 409 and are skipped.
#
# Usage: ./load/seed-load-users.sh [count]      (default 20; needs the stack running)
# Keycloak runs with KC_DB=dev-mem, so seeded users are lost whenever the infra stack restarts:
# re-run this script after every ./start-infra.sh.
set -euo pipefail
COUNT="${1:-20}"
KC="${KEYCLOAK_URL:-http://localhost:8180}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-Admin123!}"
PASSWORD="LoadUser123!"

TOKEN=$(curl -sf -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d username=admin --data-urlencode "password=$ADMIN_PASSWORD" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
ROLE=$(curl -sf -H "Authorization: Bearer $TOKEN" "$KC/admin/realms/demo-app/roles/claimant")

for i in $(seq 1 "$COUNT"); do
  USER="loaduser$i@demo.com"
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" "$KC/admin/realms/demo-app/users" \
    -d "{\"username\":\"$USER\",\"email\":\"$USER\",\"firstName\":\"Load\",\"lastName\":\"User$i\",\"enabled\":true,\"emailVerified\":true,\"credentials\":[{\"type\":\"password\",\"value\":\"$PASSWORD\",\"temporary\":false}]}")
  if [ "$STATUS" = "201" ]; then
    ID=$(curl -sf -H "Authorization: Bearer $TOKEN" "$KC/admin/realms/demo-app/users?username=$USER&exact=true" \
      | python3 -c "import sys, json; print(json.load(sys.stdin)[0]['id'])")
    curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      "$KC/admin/realms/demo-app/users/$ID/role-mappings/realm" -d "[$ROLE]"
  fi
  echo "$USER: $STATUS"
done
