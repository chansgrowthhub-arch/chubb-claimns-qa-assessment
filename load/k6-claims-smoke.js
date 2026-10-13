// K6 smoke/load test for the read-heavy paths through the BFF (bonus deliverable).
//
// 1. Seed one Keycloak user per VU (shared accounts trip Keycloak brute-force protection):
//      ./load/seed-load-users.sh 20
// 2. Run k6 on the compose network, no local install needed:
//      docker run --rm --network demo-network -v "$PWD/load:/scripts" grafana/k6:0.54.0 run \
//        -e BFF_URL=http://bff-service:8090 -e VUS=10 -e DURATION=30s /scripts/k6-claims-smoke.js
//    or with a local k6:  k6 run -e BFF_URL=http://localhost:8090 load/k6-claims-smoke.js
//
// Thresholds are first-pass values from a 10-VU run on a laptop Docker Desktop stack, not an
// SLA (see TEST_STRATEGY.md). The BFF uses httpOnly cookies, so each VU logs in once and k6's
// per-VU cookie jar carries access_token automatically.
import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BFF_URL = __ENV.BFF_URL || 'http://localhost:8090';
// One account per VU: loaduser<VU>@demo.com, created by seed-load-users.sh. __VU is numbered across
// both scenarios (1..VUS+1), so seed at least VUS+1 users (run-tests.sh load does this).
const claimantForThisVu = () => ({ email: `loaduser${__VU}@demo.com`, password: 'LoadUser123!' });
// A dedicated admin created by seed-load-users.sh. Sharing admin@demo.com with E2E runs or
// people trips Keycloak's quick-login check (two failures within 1 s lock the account for 60 s).
const ADMIN = {
  email: __ENV.ADMIN_EMAIL || 'loadadmin@demo.com',
  password: __ENV.ADMIN_PASSWORD || 'LoadUser123!',
};
const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };
const THINK_TIME_SECONDS = 1;

export const options = {
  // k6 empties each VU's cookie jar at the start of every iteration by default. We log in once
  // per VU and rely on the httpOnly access_token cookie, so the jar must persist.
  noCookiesReset: true,
  scenarios: {
    claimants: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || '30s',
      exec: 'claimantJourney',
    },
    admins: {
      executor: 'constant-vus',
      vus: 1,
      duration: __ENV.DURATION || '30s',
      exec: 'adminJourney',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:list_claims}': ['p(95)<800'],
    'http_req_duration{endpoint:dashboard_cached}': ['p(95)<300'],
    checks: ['rate>0.99'],
  },
};

// Per-VU login state. Retry on the next iteration if login fails instead of hammering
// protected endpoints unauthenticated.
let loggedIn = false;

function ensureLoggedIn(user) {
  if (loggedIn) return true;
  const res = http.post(`${BFF_URL}/api/auth/login`, JSON.stringify(user), {
    ...JSON_HEADERS,
    tags: { endpoint: 'login' },
  });
  loggedIn = check(res, { 'login succeeded': (r) => r.status === 200 });
  return loggedIn;
}

// Never call r.json() on a failed response: it throws, aborts the iteration and skips sleep().
const isJsonArray = (r) => {
  try { return r.status === 200 && Array.isArray(r.json()); } catch (e) { return false; }
};

export function claimantJourney() {
  if (!ensureLoggedIn(claimantForThisVu())) { sleep(THINK_TIME_SECONDS); return; }

  group('list own claims', () => {
    const res = http.get(`${BFF_URL}/api/claims`, { tags: { endpoint: 'list_claims' } });
    check(res, {
      'list claims 200': (r) => r.status === 200,
      'list claims returns array': isJsonArray,
    });
  });
  sleep(THINK_TIME_SECONDS);
}

export function adminJourney() {
  if (!ensureLoggedIn(ADMIN)) { sleep(THINK_TIME_SECONDS); return; }

  group('dashboard via cache', () => {
    const res = http.get(`${BFF_URL}/api/admin/dashboard/stats`, {
      tags: { endpoint: 'dashboard_cached' },
    });
    check(res, { 'dashboard 200': (r) => r.status === 200 });
  });
  sleep(THINK_TIME_SECONDS);
}
