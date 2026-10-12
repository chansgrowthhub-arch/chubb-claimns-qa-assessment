// K6 smoke/load test for the read-heavy paths through the BFF (bonus deliverable).
// Run against the Docker Compose stack:
//   k6 run load/k6-claims-smoke.js
//   k6 run -e BFF_URL=http://localhost:8090 -e VUS=20 -e DURATION=2m load/k6-claims-smoke.js
//
// Thresholds are deliberately loose placeholders: a real baseline must be captured on the
// target environment first (see TEST_STRATEGY.md section 5). Note the BFF uses httpOnly cookies,
// so each VU logs in once and k6's per-VU cookie jar carries access_token automatically.
import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BFF_URL = __ENV.BFF_URL || 'http://localhost:8090';
const CLAIMANT = {
  email: __ENV.CLAIMANT_EMAIL || 'claimant@demo.com',
  password: __ENV.CLAIMANT_PASSWORD || 'Claimant123!',
};
const ADMIN = {
  email: __ENV.ADMIN_EMAIL || 'admin@demo.com',
  password: __ENV.ADMIN_PASSWORD || 'Admin123!',
};
const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };
const THINK_TIME_SECONDS = 1;

export const options = {
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

function login(user) {
  const res = http.post(`${BFF_URL}/api/auth/login`, JSON.stringify(user), {
    ...JSON_HEADERS,
    tags: { endpoint: 'login' },
  });
  check(res, { 'login succeeded': (r) => r.status === 200 });
}

export function claimantJourney() {
  if (__ITER === 0) login(CLAIMANT);

  group('list own claims', () => {
    const res = http.get(`${BFF_URL}/api/claims`, { tags: { endpoint: 'list_claims' } });
    check(res, {
      'list claims 200': (r) => r.status === 200,
      'list claims returns array': (r) => Array.isArray(r.json()),
    });
  });
  sleep(THINK_TIME_SECONDS);
}

export function adminJourney() {
  if (__ITER === 0) login(ADMIN);

  group('dashboard via cache', () => {
    const res = http.get(`${BFF_URL}/api/admin/dashboard/stats`, {
      tags: { endpoint: 'dashboard_cached' },
    });
    check(res, { 'dashboard 200': (r) => r.status === 200 });
  });
  sleep(THINK_TIME_SECONDS);
}
