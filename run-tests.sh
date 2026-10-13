#!/usr/bin/env bash
# Runs the QA test suites one at a time. See TESTING.md for what each suite covers.
#
#   ./run-tests.sh <suite>
#
# Suites that need nothing running:
#   unit-claims    Claims service unit tests (JUnit 5)
#   unit-bff       BFF unit tests (JUnit 5)
#   unit-ui        UI component and unit tests (Vitest + Testing Library)
#   unit           All three unit suites above
#   defects        Known-defect tests: they FAIL while the bugs exist (that is the expected result)
# Suites that need Docker running:
#   integration    Testcontainers tests for both services (starts its own containers)
# Suites that need the full stack (./start-infra.sh && ./start-app.sh):
#   e2e            Playwright browser tests against http://localhost:3001
#   load           k6 load test against the BFF (seeds one Keycloak user per virtual user first)
#
# Extra Maven arguments can be passed through MAVEN_ARGS, for example a local repository:
#   MAVEN_ARGS="-Dmaven.repo.local=/path/to/repo" ./run-tests.sh unit-claims
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAIMS="$ROOT/code/claims-service"
BFF="$ROOT/code/bff-service"
UI="$ROOT/code/demo-app-ui"
UI_URL="${UI_URL:-http://localhost:3001}"
BFF_URL="${BFF_URL:-http://localhost:8090}"
K6_IMAGE="grafana/k6:0.54.0"
K6_VUS="${K6_VUS:-10}"
K6_DURATION="${K6_DURATION:-60s}"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
pass() { printf '\033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*"; }

need() {
  command -v "$1" >/dev/null 2>&1 || { fail "'$1' is not on PATH. $2"; exit 2; }
}

REQUIRED_JAVA=21

# Maven: use an installed `mvn` if there is one, otherwise each service's Maven Wrapper
# (./mvnw downloads Maven 3.9.9 on first use), so only a JDK has to be installed.
MVN_CMD=""

check_java() {
  local java_bin="java"
  [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ] && java_bin="$JAVA_HOME/bin/java"
  command -v "$java_bin" >/dev/null 2>&1 || { fail "No Java found. Install JDK $REQUIRED_JAVA (https://adoptium.net) and set JAVA_HOME to it."; exit 2; }
  local version major
  version=$("$java_bin" -version 2>&1 | head -1 | sed -E 's/.*version "([^"]+)".*/\1/')
  major="${version%%.*}"
  if [ "$major" != "$REQUIRED_JAVA" ]; then
    fail "Java $version found, but this project needs JDK $REQUIRED_JAVA (newer JDKs fail to compile it: Lombok breaks)."
    echo "     Install JDK $REQUIRED_JAVA and point JAVA_HOME at it, for example:"
    echo "       export JAVA_HOME=\"/c/Program Files/Eclipse Adoptium/jdk-21...\"   (Git Bash)"
    exit 2
  fi
  if command -v mvn >/dev/null 2>&1; then MVN_CMD="mvn"; else MVN_CMD="./mvnw"; fi
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    # Docker Desktop's per-user install is not on PATH in terminals opened before installing it.
    local per_user="${LOCALAPPDATA:-}/Programs/DockerDesktop/resources/bin"
    command -v cygpath >/dev/null 2>&1 && [ -n "${LOCALAPPDATA:-}" ] && per_user="$(cygpath -u "$LOCALAPPDATA")/Programs/DockerDesktop/resources/bin"
    if [ -x "$per_user/docker.exe" ] || [ -x "$per_user/docker" ]; then export PATH="$per_user:$PATH"; fi
  fi
  need docker "Install and start Docker Desktop."
  docker info >/dev/null 2>&1 || { fail "Docker is installed but the engine is not running. Start Docker Desktop."; exit 2; }
}

check_stack() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$UI_URL/login" || true)
  [ "$code" = "200" ] || { fail "The app is not reachable at $UI_URL. Start it with ./start-infra.sh && ./start-app.sh"; exit 2; }
}

# The UI imports a client generated from the BFF OpenAPI spec. The folder is gitignored,
# so a fresh clone must generate it before UI tests can run (finding 3 in TEST_STRATEGY.md).
ensure_ui_ready() {
  need node "Install Node.js 20+."
  need npm "Install Node.js 20+."
  if [ ! -d "$UI/node_modules" ]; then
    say "Installing UI dependencies (first run only)"
    (cd "$UI" && npm ci --no-audit --no-fund) || { fail "npm ci failed"; exit 1; }
  fi
  if [ ! -f "$UI/src/lib/api/generated/index.ts" ]; then
    say "Generating the UI API client from the BFF OpenAPI spec (first run only)"
    (cd "$UI" && npm run generate:api) || { fail "API client generation failed"; exit 1; }
  fi
}

run_maven() { # <dir> <label> [extra args...]
  local dir="$1" label="$2"; shift 2
  say "$label"
  if (cd "$dir" && $MVN_CMD -B test ${MAVEN_ARGS:-} "$@"); then pass "$label"; return 0; fi
  fail "$label"; return 1
}

unit_claims() { check_java; run_maven "$CLAIMS" "Claims service unit tests"; }
unit_bff()    { check_java; run_maven "$BFF" "BFF unit tests"; }

unit_ui() {
  ensure_ui_ready
  say "UI component and unit tests"
  if (cd "$UI" && npx vitest run); then pass "UI component and unit tests"; return 0; fi
  fail "UI component and unit tests"; return 1
}

defects() {
  check_java
  say "Known-defect tests (expected to FAIL until findings 5 and 6 are fixed)"
  local log; log="$(mktemp)"
  (cd "$BFF" && $MVN_CMD -B test ${MAVEN_ARGS:-} -Dgroups=defect -Dsurefire.excludedGroups=integration) 2>&1 | tee "$log"
  if grep -q "BUILD SUCCESS" "$log"; then
    fail "The defect tests now PASS: the bugs look fixed. Remove @Tag(\"defect\") from those tests so they join the normal suite."
    rm -f "$log"; return 1
  fi
  if grep -qE "Tests run: [0-9]+, Failures: [1-9]" "$log"; then
    pass "Known defects still reproduce, as expected (each failing test = one open bug)"
    rm -f "$log"; return 0
  fi
  fail "The defect suite did not run cleanly (compile or setup error). See the output above."
  rm -f "$log"; return 1
}

integration() {
  check_java; check_docker
  local rc=0
  run_maven "$CLAIMS" "Claims service integration tests (Testcontainers)" -Dgroups=integration -Dsurefire.excludedGroups= || rc=1
  run_maven "$BFF" "BFF integration tests (Testcontainers)" -Dgroups=integration -Dsurefire.excludedGroups= || rc=1
  return $rc
}

e2e() {
  check_stack; ensure_ui_ready
  say "Installing the Playwright browser (first run only)"
  (cd "$UI" && npx playwright install chromium) >/dev/null || { fail "Playwright browser install failed"; exit 1; }
  say "Playwright end-to-end tests against $UI_URL"
  if (cd "$UI" && npx playwright test); then
    pass "E2E tests (tests marked as known defects fail by design and still count as passed)"
    echo "HTML report: code/demo-app-ui/playwright-report/index.html (open with: cd code/demo-app-ui && npx playwright show-report)"
    return 0
  fi
  fail "E2E tests"; return 1
}

load() {
  check_stack; check_docker
  # k6 numbers VUs across all scenarios (claimants + 1 admin), and the script maps VU n to
  # loaduser<n>, so seed one account per VU in total, not just per claimant VU.
  say "Seeding one Keycloak load-test user per virtual user"
  bash "$ROOT/load/seed-load-users.sh" "$((K6_VUS + 1))" >/dev/null || { fail "Seeding load users failed"; exit 1; }
  say "k6: $K6_VUS virtual users for $K6_DURATION"
  local scripts="$ROOT/load"
  if command -v cygpath >/dev/null 2>&1; then scripts="$(cygpath -w "$ROOT/load")"; fi
  if MSYS_NO_PATHCONV=1 docker run --rm --network demo-network -v "$scripts:/scripts" "$K6_IMAGE" run \
       -e BFF_URL=http://bff-service:8090 -e VUS="$K6_VUS" -e DURATION="$K6_DURATION" /scripts/k6-claims-smoke.js; then
    pass "Load test thresholds met"; return 0
  fi
  fail "Load test thresholds crossed"; return 1
}

case "${1:-}" in
  unit-claims) unit_claims ;;
  unit-bff)    unit_bff ;;
  unit-ui)     unit_ui ;;
  unit)        rc=0; unit_claims || rc=1; unit_bff || rc=1; unit_ui || rc=1; exit $rc ;;
  defects)     defects ;;
  integration) integration ;;
  e2e)         e2e ;;
  load)        load ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
