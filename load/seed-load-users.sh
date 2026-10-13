#!/usr/bin/env bash
# Creates the Keycloak accounts the k6 load test logs in with (password LoadUser123!):
#   loaduser1..N@demo.com   role claimant, one per claimant virtual user
#   loadadmin@demo.com      role admin, used by the admin virtual user
#
# Why dedicated accounts: Keycloak brute-force protection is on in the realm. Concurrent logins
# to the SAME account are rejected (about half return 401 with correct credentials), and two
# failures within 1 s lock that account for 60 s. A load test that shares accounts with each
# other, with E2E runs or with people therefore measures Keycloak lockouts, not the app.
#
# Usage: ./load/seed-load-users.sh [count]      (default 20; needs the stack running)
# Safe to re-run: existing users return 409 and are skipped. Keycloak runs with KC_DB=dev-mem,
# so seeded users are lost whenever the infra stack restarts: run this after every ./start-infra.sh
# (./run-tests.sh load does it for you).
set -euo pipefail
COUNT="${1:-20}"
KC="${KEYCLOAK_URL:-http://localhost:8180}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-Admin123!}"
PASSWORD="LoadUser123!"

TOKEN=$(curl -sf -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d username=admin --data-urlencode "password=$ADMIN_PASSWORD" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
role_json() { curl -sf -H "Authorization: Bearer $TOKEN" "$KC/admin/realms/demo-app/roles/$1"; }
CLAIMANT_ROLE=$(role_json claimant)
ADMIN_ROLE=$(role_json admin)

create_user() { # <email> <last name> <role json>
  local user="$1" last="$2" role="$3" status id
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" "$KC/admin/realms/demo-app/users" \
    -d "{\"username\":\"$user\",\"email\":\"$user\",\"firstName\":\"Load\",\"lastName\":\"$last\",\"enabled\":true,\"emailVerified\":true,\"credentials\":[{\"type\":\"password\",\"value\":\"$PASSWORD\",\"temporary\":false}]}")
  if [ "$status" = "201" ]; then
    id=$(curl -sf -H "Authorization: Bearer $TOKEN" "$KC/admin/realms/demo-app/users?username=$user&exact=true" \
      | python3 -c "import sys, json; print(json.load(sys.stdin)[0]['id'])")
    curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      "$KC/admin/realms/demo-app/users/$id/role-mappings/realm" -d "[$role]"
  fi
  echo "$user: $status"
}

for i in $(seq 1 "$COUNT"); do
  create_user "loaduser$i@demo.com" "User$i" "$CLAIMANT_ROLE"
done
create_user "loadadmin@demo.com" "Admin" "$ADMIN_ROLE"
