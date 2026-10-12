# Test Strategy & Application Assessment

**Author:** Chan Basha (QA take-home, Chubb APAC)
**Scope:** Claims Management demo app: Next.js UI, Spring Boot BFF, Spring Boot Claims Service, Kafka/Debezium, Keycloak, Redis, PostgreSQL.
**Environment:** Windows 11, Docker Desktop 4.94 (engine 29.8.2), JDK 21, Maven 3.9.9, Node 22. The full Docker Compose stack was started and every suite below was executed against it, including the optional Debezium CDC stack.

### Verified results

| Suite | Command | Result |
|-------|---------|--------|
| Claims-service unit | `cd code/claims-service && mvn test` | 237 passed |
| BFF unit | `cd code/bff-service && mvn test` | 219 passed |
| UI component/unit | `cd code/demo-app-ui && npm test` | 280 passed (includes 1 known-defect test that fails by design) |
| BFF known-defect tests | `mvn test -Dgroups=defect -Dsurefire.excludedGroups=integration` | 2 fail by design (findings 5 and 6) |
| Integration (Testcontainers) | `mvn test -Dgroups=integration -Dsurefire.excludedGroups=` | Claims service 8 passed, BFF 4 passed (after pinning images, finding 14) |
| Playwright E2E, live stack | `cd code/demo-app-ui && npx playwright test` | 11 passed: 9 green and 2 known-defect tests that fail by design (findings 4 and 7) |
| k6 load, live stack | see `load/k6-claims-smoke.js` | 10 VUs for 60 s: 650 requests, 0 failed, list-claims p95 72 ms, cached dashboard p95 77 ms |

**As received**, the suites did not pass. The planted test did not compile, two more claims-service classes were stale (9 failures), 8 UI tests failed, the E2E runner had no setup file, and two integration tests failed on this machine. Finding 9 has the details.

---

## 1. How the system works

```
Browser ── cookie (access_token, httpOnly) ──> Next.js (rewrites /api/* → BFF)
  │                                              │
  │  WebSocket /api/ws/claims (cookie or ?token) │
  ▼                                              ▼
BFF :8090 ── validates JWT, proxies ──> Claims Service :8080 ── JPA ──> Postgres
  ▲      └─ Keycloak (password grant, admin API, service-account token)
  │
Kafka ◄── Claims Service publishes claim-events (only when app.events.cdc-enabled=false)
  ▲
  └── Debezium publishes cdc.demo-app.public.claims (only when the CDC stack is up)
BFF consumes both topics → broadcasts WebSocketMessage to claim owner + admins
```

- **Business rules live in one place.** The `Claim` aggregate holds validation boundaries and the status machine in `ClaimStatus.canTransitionTo`. A defect here corrupts money-bearing records.
- **Access control is enforced three times.** The UI route guard is cosmetic. The BFF restricts `/api/admin/**` to admins. The claims service checks roles and claim ownership, and that is the real control.
- **Real-time updates have two mutually exclusive producer modes.** A flag selects them, and one BFF consumer parses two different payload shapes. This is the most brittle seam in the system.
- **Auth is hand-rolled around Keycloak.** Login uses the password grant and decodes the JWT by hand. Cookies, CSRF and signup through the Keycloak admin API are custom code.

## 2. Highest-risk areas and why

| # | Area | Why it ranks here |
|---|------|-------------------|
| 1 | Claim domain rules | Direct financial impact. Every other layer trusts them, and boundary mistakes are silent. |
| 2 | Kafka to WebSocket pipeline | Hand-written JSON contracts, schema validation switched off, silent failure. Findings 1 and 6 live here. |
| 3 | Access control and ownership | A gap leaks other customers' claims. Findings 7 and 10 touch this. |
| 4 | Auth and session lifecycle | Hand-rolled. Findings 2, 4 and 5 live here. |
| 5 | Environment and setup | A stack that only works on one machine invalidates every other test. Findings 3 and 14 live here. |
| 6 | Dashboard caching | Wrong numbers are embarrassing but not corrupting, and the code already degrades gracefully. |

## 3. What I tested, and what I left out

### Added tests
- **Claims service unit tests.**
  - `ClaimBoundaryTest` covers exact boundary values for amount, description, location and incident date.
  - `ClaimStatusTransitionMatrixTest` asserts the full 5×5 status matrix from one table.
- **BFF unit tests.**
  - `ClaimEventKafkaConsumerContentTest` asserts what is broadcast, not just that a broadcast happened.
  - `AuthCsrfContractTest` pins the logout CSRF contract.
  - Two tests tagged `defect` fail by design.
- **UI component tests.**
  - `login-page.test.tsx` and `claims-table.test.tsx` test behaviour by role and label.
  - `incident-date-timezone.test.ts` pins finding 8 with `it.fails`.
- **Playwright E2E**, with page objects and a global setup that logs in each user once and warms every route.
  - The claimant journey: three-step wizard, then the claim appears in the list.
  - The admin journey: two status changes, then a check that illegal transitions are not offered.
  - RBAC and auth checks: wrong password, role routing, the anonymous redirect, a claimant calling an admin API, and a data-leak guard.
  - Two known-defect tests marked `test.fail`.
- **k6** load script, plus `seed-load-users.sh`, which creates one account per virtual user (finding 15).

### Repaired shipped tests
- `UpdateClaimStatusUseCaseTest` (the planted error) and `CreateClaimUseCaseTest` were missing a dependency.
- `KafkaDomainEventPublisherTest` was rewritten against the real envelope.
- `wizard-step-2.test.tsx` now pastes text instead of typing 950 keystrokes.
- The theme store now uses `localStorage`, as its tests specify.
- The Testcontainers images are now pinned.

### Live verification scripts
These are outside the repo, and their output is captured in the PDF report. They reproduce findings 1, 2, 4, 5, 6 and 7 with raw HTTP and WebSocket calls. For findings 1 and 2, they also confirm the recommended fix works by restarting a single container with the corrected setting.

### Deliberately left out
- **Pact contract tests.** Both HTTP sides are generated from the OpenAPI specs. The unguarded contracts were the Kafka ones, so I tested those instead.
- **New Testcontainers tests.** The existing ones now run green. I spent the remaining time on live end-to-end verification instead.
- **Keycloak adapter internals, tracing and metrics, theming, Redis serialisation.** All have a low blast radius.

## 4. Findings

Severity reflects impact on a real user or on the team's ability to test.

| # | Finding | Severity | Status | How it was proven |
|---|---------|----------|--------|-------------------|
| 1 | Real-time updates are off in the default stack | High | Open | Live: no WebSocket event and 0 Kafka messages. Fix validated live. |
| 2 | Signup is broken: the BFF uses the wrong Keycloak admin password | High | Open | Live: HTTP 500 and Keycloak 401. Fix validated live. |
| 3 | A fresh clone renders no app pages: the API client is never generated | High | Open | Live: fresh-clone image returns 500 "Module not found" |
| 4 | Logout is rejected by CSRF protection, so the session survives | High | Open | Live in API and browser; contract test; E2E `test.fail` |
| 5 | Logout fails when the access token has expired | High | Open | Live 401; unit test tagged `defect` |
| 6 | The CDC contract is wrong: the schema says `id`, Debezium sends `claim_id`, plus 4 type mismatches | Medium | Open | Real Debezium message; unit test tagged `defect` |
| 7 | The BFF returns 500 for "not found" and "forbidden" claims | Medium | Open | Live; E2E `test.fail` |
| 8 | Incident dates show one day early for users west of UTC | Medium | Open | Reproduced; `it.fails` unit test |
| 9 | The shipped test suite could not pass | Medium | Fixed | Before and after runs |
| 10 | Shared bearer token across concurrent requests | Medium | Open | Code review; not reproduced at 10 users |
| 11 | `changedBy` records the claim owner instead of the admin | Medium | Open | Code review |
| 12 | Theme preference is lost in every new tab | Low | Fixed | Shipped tests now pass |
| 13 | The E2E runner was broken: setup file missing | Low | Fixed | 11 specs run |
| 14 | Unpinned `:latest` Testcontainers images break the integration tests | Low | Fixed | Before 2 errors, after 12 of 12 |
| 15 | Concurrent logins for the same account are rejected | Low | Open | Live: 8 of 10 parallel logins got 401 |
| 16 | `start-cdc.sh` reports failure on a clean, successful run | Low | Open | Live |
| 17 | The status-change error detail is dropped (empty 400) | Low | Open | Code review |
| 18 | Smaller contract and security smells | Low | Open | Code review |

**1. Real-time updates are off in the default stack.**
`docker-compose.apps.yml` sets `APP_EVENTS_CDC_ENABLED: "true"`, while the README says direct Kafka is the default. In CDC mode the claims service publishes nothing and relies on Debezium, which the quick-start never starts.

- **Live evidence:** the claims service logged "CDC enabled — event will be published by Debezium". `claim-events` held 0 messages, and the admin WebSocket received nothing within 15 s.
- **Fix validated:** with the flag set to `false`, the event arrived in under 1 s and the topic held 1 message.

**2. Signup is broken.**
The BFF falls back to `KEYCLOAK_ADMIN_PASSWORD=admin`, but compose bootstraps Keycloak with `Admin123!`, and `docker-compose.apps.yml` never passes the real value. Every signup returns 500. The BFF log shows `NotAuthorizedException: HTTP 401` from the Keycloak admin client.

- **Fix validated:** with `KEYCLOAK_ADMIN_PASSWORD` set on `bff-service`, signup returns 201 and the new user can log in.

**3. A fresh clone renders no app pages.**
The generated client is gitignored. The UI `Dockerfile` runs `next dev` without generating it, and `start-app.sh` never generates it either. I cloned the repo from GitHub and built the UI image exactly as compose does. `/login` works, but every authenticated page returns 500 `Module not found: Can't resolve './generated'`. It only worked on my machine because I had run `npm run generate:api` earlier.

- **Fix:** generate the client in `start-app.sh` before the compose build, or generate it inside the image with the spec in the build context.

**4. Logout is rejected by CSRF protection.**
`/api/auth/logout` is not in the CSRF ignore list, and the UI's raw fetch sends no `X-XSRF-TOKEN` header.

- **Live in the browser:** logout returned 403 and the `access_token` cookie survived. Navigating back to `/claims` showed the claimant's claims, and the API answered 200.
- **Masked by the shipped tests:** `AuthControllerTest` always added a CSRF token.

**5. Logout fails when the access token has expired.**
`CookieAuthenticationFilter` turns any `access_token` cookie into a Bearer header. An expired token gets 401 before logout runs, so no cookies are cleared. This was confirmed live.

**6. The CDC contract is wrong.**
I captured a real Debezium message from the live stack:

- It uses `claim_id`, so the BFF consumer is correct.
- The committed `DebeziumClaimsMessage.json` schema and `TestEventController` use `id`, so every injected test event reaches the UI with an empty claim id.
- `claim_amount` arrives as base64 decimal bytes (`"AeJA"` is 1234.56), not a number.
- `incident_date` arrives as days since epoch, and the timestamps as microseconds, not date strings.

Enabling the existing schema validator would reject every real event. I downgraded this from High after seeing the production CDC path work end to end.

**7. The BFF returns 500 for "not found" and "forbidden" claims.**
The claims service correctly returns a ProblemDetail with 404 or 403. `ClaimsServiceAdapter.getClaim` wraps both in `IllegalStateException`, so the browser gets a bare 500. No data leaks, but the UI shows a generic error instead of "Claim not found".

**8. Incident dates show one day early for users west of UTC.**
The generated client parses `"2026-10-01"` with `new Date()`, which gives UTC midnight, and `formatDate` renders it in local time. New York and Los Angeles show "Sep 30, 2026". Users in APAC and the UK are unaffected. I reproduced this with the generated client.

**9. The shipped test suite could not pass.** This is now fixed.
- **Claims service:** the planted compile error, plus two stale classes (9 failures).
- **UI:** 8 failures. One slow typing test leaked keystrokes into five others, and two failures came from finding 12.
- **E2E:** the runner failed because its setup file was missing.
- **Integration:** 2 tests errored on this machine (finding 14).

The coverage and mutation thresholds in the POMs could never have been enforced.

**10. Shared bearer token on a singleton `ApiClient`.**
`AdminController` and `ClaimsServiceAdapter` mutate one client's bearer token per request. Under concurrency, a call could go out with another user's token. Ten parallel list-claims calls showed no failures, which is weak evidence the race is narrow, not proof it is absent. It needs a targeted concurrency test with mixed roles.

**11. `changedBy` records the claim owner instead of the admin.**
`Claim.updateStatus` fills it with `this.userId`. Owner notifications only work because the BFF uses this field as the notification target.

**12. Theme preference is lost in every new tab.** This is fixed; the store now uses `localStorage`.

**13. The E2E runner was broken.** This is fixed. `global-setup.ts` was referenced by the config but missing.

**14. Unpinned Testcontainers images break the integration tests.** This is fixed.
`postgres:latest` now resolves to Postgres 18.6, which rejects the JVM's default zone name `Asia/Calcutta` (the default on an Indian Windows install), so 2 full-context tests errored. The test I left untouched already pinned `postgres:15-alpine`, as compose does. Postgres and Redis are now pinned to the compose versions. Kafka is still `:latest`.

**15. Concurrent logins for the same account are rejected.**
Ten parallel logins with valid credentials gave 8 × 401, through the BFF and directly against Keycloak. Ten distinct users in parallel all succeeded. The realm has `bruteForceProtected: true`. Users see "Invalid email or password" after a double submit or simultaneous logins from two devices. It is also a load-test trap, which I worked around with one account per virtual user.

**16. `start-cdc.sh` reports failure on a clean, successful run.**
The CDC compose file's `debezium-init` container registers the connector, then the script deletes it and registers it again. That gives 409, "ERROR" and exit 1, although the connector is RUNNING.

**17. The status-change error detail is dropped.**
`AdminController.updateClaimStatus` returns an empty 400, discarding "Cannot transition from X to Y".

**18. Smaller smells.**
- Money is declared as `double` in both OpenAPI specs.
- The domain accepts 0.001 while the API floor is 0.01.
- The WebSocket accepts the JWT in the query string.
- The access token lives 24 h but its cookie only 5 min.
- The UI truncates descriptions at 50 characters, the API at 100.
- The Testcontainers Keycloak is 26.1.4, while compose uses 26.5.2.

## 5. What I'd do next, in order
1. Fix findings 1–5. Four are configuration or one-line changes, and findings 1 and 2 are already validated live. The failing defect tests then turn green and stay as regression guards.
2. Make the quick-start reproducible: generate the API client in the build, pin all images, and add a CI job that runs from a fresh clone.
3. Fix the CDC schema to match real Debezium output. Run the schema validator in CI against a captured Debezium message.
4. Map claims-service ProblemDetails through the BFF unchanged (findings 7 and 17). Treat date-only fields as dates in the UI (finding 8).
5. Write a mixed-role concurrency test for finding 10, then move to per-request tokens.
6. Run k6 at higher load against a production-like build (`next start`, not `next dev`), then set real thresholds.
