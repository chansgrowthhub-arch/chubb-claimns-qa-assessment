# Test Strategy & Application Assessment

**Author:** Chan Basha (QA take-home, Chubb APAC)
**Scope:** Claims Management demo app — Next.js UI, Spring Boot BFF, Spring Boot Claims Service, Kafka/Debezium, Keycloak, Redis, PostgreSQL.
**Constraint declared up front:** my assessment machine has no Docker/Podman, so everything that needs a container (Testcontainers integration tests, full-stack E2E) is *written and reviewed* but verified only by compilation, not execution. Unit and component suites were executed locally and are green. This trade-off is explained per layer below.

### Verified results (run locally, JDK 21 / Maven 3.9.9 / Node 22)

| Suite | Command | Result |
|-------|---------|--------|
| Claims-service unit | `cd code/claims-service && mvn test` | 221 passed, 0 failed |
| BFF unit | `cd code/bff-service && mvn test` | 219 passed, 0 failed |
| UI component/unit | `cd code/demo-app-ui && npm test` | 278 passed, 0 failed |
| BFF known-defect tests | `mvn test -Dgroups=defect -Dsurefire.excludedGroups=integration` | 2 failed by design (defects 4-B, 4-C) |
| Playwright E2E | `npx playwright test` (needs the full stack) | 10 specs compile and list; **not executed**, because there was no Docker |

As received, the backend suites did not pass. One test did not compile (the planted one). Two more classes were stale: 9 failures in claims-service. In the UI, 8 shipped tests failed. The details are in section 4-D.

---

## 1. How the system actually works (what I verified by reading every layer)

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
  └── Debezium publishes cdc.demo-app.public.claims (only when CDC stack is up)
BFF consumes both topics → broadcasts WebSocketMessage to claim owner + admins
```

Key mechanics that drive my risk ranking:

- **Business rules live in one place:** `Claim` aggregate (validation boundaries, status machine in `ClaimStatus.canTransitionTo`). A defect here corrupts money-bearing records.
- **RBAC is enforced three times** (UI route guard = cosmetic; BFF Spring Security `/api/admin/** hasRole('ADMIN')`; claims-service `@PreAuthorize` + ownership check in `GetClaimUseCase`). The claims-service layer is the real control because the BFF calls it with a *service-account* token for some admin operations.
- **Real-time updates have two mutually exclusive producer modes** switched by `app.events.cdc-enabled`, consumed by one BFF consumer that parses two *different* payload shapes. This is the most brittle integration seam in the system.
- **Auth is hand-rolled around Keycloak** (password grant + manual JWT payload decoding in `LoginUseCaseImpl`, cookie plumbing in `AuthController`, CSRF via `CookieCsrfTokenRepository`).

## 2. Highest-risk areas (ranked) and why

| # | Area | Why it ranks here |
|---|------|-------------------|
| 1 | **Claim domain rules** (amount/date/length boundaries, status state machine) | Direct financial impact; every other layer trusts these rules; boundary mistakes (≤ vs <) are silent. |
| 2 | **Kafka → WebSocket event pipeline** (envelope shape, CDC field names, mode switch) | Three hand-written JSON contracts with no schema registry and validation disabled by default (`kafka.producer.schema-validation.enabled=false`). Failures are silent — the UI just never updates. I found real defects here (see §4). |
| 3 | **RBAC & ownership** (claimant cannot read others' claims; admin-only endpoints) | A gap leaks other customers' claim data. The BFF's shared mutable `ApiClient` bearer token makes this worse (§4-F). |
| 4 | **Auth/session lifecycle** (login, refresh-on-401, logout, CSRF) | Hand-rolled; mistakes here are account-takeover or lockout class. Logout is in fact broken (§4-C). |
| 5 | **Admin status transitions end-to-end** (optimistic UI update + rollback + 400 ProblemDetail) | Multi-layer flow with an optimistic update in Zustand that must roll back correctly. |
| 6 | Dashboard caching (Redis TTL, bypass, flush) | Wrong numbers are embarrassing but not corrupting; graceful-degradation code already defensive. |

## 3. What I tested, what I deliberately left out

### Executed and green on my machine
- **Claims-service unit tests** (`mvn test`, integration tag excluded): fixed the planted compile-broken test (`UpdateClaimStatusUseCaseTest` missed the `ApplicationEventPublisher` constructor arg) and added:
  - `ClaimBoundaryTest` — exact boundary values for amount (0.01 ✓ / 1,000,000 ✓ / 1,000,000.01 ✗ / 0 ✗), description (9/10/1000/1001 incl. trimming interaction), location (4/5/200/201), incident date (today ✓ / tomorrow ✗). These catch off-by-one regressions the existing "happy + one sad" tests would miss.
  - `ClaimStatusTransitionMatrixTest` — full 5×5 parameterised matrix as a single source of truth, replacing scattered per-case asserts.
- **BFF unit tests**: added `ClaimEventKafkaConsumerContentTest` — the existing tests only verified *that* a broadcast happened, never *what* was broadcast, which is exactly how the CDC field-name bug (§4-B) slipped through. New tests capture the `WebSocketMessage` and assert claimId/status/oldStatus content for: domain-event envelope, real Debezium column names (`claim_id`), and the documented-schema shape (`id`) — the last one is tagged `defect` and fails by design against current code (run with `-Dgroups=defect -Dsurefire.excludedGroups=integration`); the default suite stays green.
  - `AuthCsrfContractTest` — proves `POST /api/auth/logout` without an `X-XSRF-TOKEN` header is rejected (403). Green server-side, but it documents §4-C: the UI's logout fetch never sends that header.
- **UI component/unit tests** (Vitest + Testing Library): added
  - `login-page.test.tsx` — user-perspective: validation messages, 401 → "Invalid email or password", role-based redirect (ADMIN → dashboard, CLAIMANT → claims), network-error path.
  - `claims-table.test.tsx` — renders rows, realtime highlight for recently-updated claim IDs, copy-ID affordance, view-details callback.
  - `use-claim-realtime-handler` behaviour is already covered via `use-realtime-store`/`use-realtime-claim-updates` tests; I did not duplicate.
- **Repaired shipped tests so the baseline is trustworthy:** `CreateClaimUseCaseTest` (missing mock; it now asserts the event is published and then cleared); `KafkaDomainEventPublisherTest` (rewritten against the real envelope); `wizard-step-2.test.tsx` (a 950-character `type()` timed out and poisoned later tests, so it now pastes); `use-theme-store` (the code was changed to match the tests' localStorage spec).

### Written, compile-reviewed, but requiring the Docker stack (not executable on this machine)
- **Playwright E2E** (`code/demo-app-ui/tests/e2e/`): claimant journey (login → 3-step wizard → claim appears in list), admin journey (login → change status with confirmation → badge updates), RBAC smoke (claimant blocked from /admin). Page objects in `tests/e2e/pages/`, storage-state auth in `global-setup.ts` (which the shipped `playwright.config.ts` referenced but did not exist — the E2E runner was broken out of the box).
- Existing Testcontainers integration tests (Kafka consumer, Postgres repository, RBAC) were reviewed, left in place, and remain behind the `integration` tag.

### Deliberately left out, and why
- **Load tests**: a K6 smoke script is included (`load/k6-claims-smoke.js`, bonus) but untuned — meaningful thresholds need a running stack and a performance baseline I can't capture here.
- **Contract tests (Pact)**: the OpenAPI specs are the de-facto contract and both sides are code-generated from them, so consumer-driven contracts add least marginal value in the 2–3 h budget; the genuinely unguarded contracts are the *Kafka* ones, which I covered with content-asserting consumer tests instead.
- **Keycloak adapter integration, tracing/metrics, theming, Redis serialization round-trip**: low blast radius or pure infrastructure glue.
- **More Testcontainers tests**: writing container tests I cannot execute invites exactly the "always passes / never ran" anti-pattern the brief warns about.

## 4. Defects and quality concerns found

**A. Real-time updates are silently dead in the default quick-start (High).**
`docker-compose.apps.yml` sets `APP_EVENTS_CDC_ENABLED: "true"`, but the README says Mode 1 (direct Kafka, `false`) is the default. With the flag true and `start-cdc.sh` not run, `CreateClaimUseCase`/`UpdateClaimStatusUseCase` skip publishing entirely and Debezium isn't there to compensate → no Kafka events, no WebSocket updates, no admin toasts. Nothing errors; the feature just doesn't happen.

**B. CDC message contract is self-contradictory (High).**
`ClaimEventKafkaConsumer.handleCdcUpdate/Create` read `after.claim_id` (matches real Debezium column names), but the committed AsyncAPI schema `DebeziumClaimsMessage.json` documents the field as `id`, and `TestEventController` (the deterministic E2E injection tool) also emits `id`. Any mock CDC event therefore broadcasts a WebSocketMessage with an **empty claimId**, and the UI updates nothing. The shipped unit tests pass because they assert only "a broadcast happened". My `defect`-tagged test pins this down.

**C. Logout doesn't log out (High).**
`POST /api/auth/logout` is *not* in the BFF's CSRF ignore list, so it requires an `X-XSRF-TOKEN` header. The UI's `app-header.tsx` logout uses a raw `fetch` that never sends one → the BFF returns 403, the `catch` swallows it, local Zustand state is cleared, but the httpOnly `access_token` cookie survives and the Keycloak session is never invalidated. The user looks logged out but any direct navigation is still authenticated for up to the cookie lifetime. The shipped `AuthControllerTest` masked this by always adding `.with(csrf())`.

**C2. Logout also fails for users whose token has expired (High).**
`CookieAuthenticationFilter` turns any `access_token` cookie into a Bearer header. The resource server rejects an expired or invalid token with 401 before `AuthController.logout` runs. A user whose 5-minute access cookie is stale therefore cannot clear the `refresh_token` cookie, which is valid for 30 minutes. This is pinned by the `defect` test `should_ClearCookies_When_LogoutCalledWithExpiredAccessToken`. I found it while writing the passing CSRF test.

**D. The planted broken test, plus a stale test suite (expected find, wider than planted).**
The planted test was not the only problem. `CreateClaimUseCaseTest` threw null pointers for the same missing dependency. `KafkaDomainEventPublisherTest` mocked `writeValueAsString(event)`, but the publisher now builds its envelope with `createObjectNode()`, so all 6 of its tests failed. In the UI, 6 wizard tests failed because of one slow typing test, and 2 theme tests failed because the store persisted to `sessionStorage` while the spec says `localStorage`. The theme mismatch was a real minor defect: theme preference was lost in every new tab. Taken together, the shipped suite cannot have been green in CI. Its coverage and mutation thresholds (90%/80%) were therefore never enforced.

The planted test, `UpdateClaimStatusUseCaseTest`, did not compile because the use case gained an `ApplicationEventPublisher` dependency the test never received. It is fixed. `CreateClaimUseCaseTest` now asserts that the event is published and then cleared when `cdc-enabled=false`.

**E. `ClaimStatusChanged.changedBy` is the claim owner, not the admin (Medium).**
`Claim.updateStatus` builds the event with `this.userId`. The schema documents changedBy as "the admin user who changed the status". Routing to the owner works *by accident* because the BFF treats this field as the notification target — fixing the semantics naively would break owner notifications. Classic coupled-contract trap; worth a test before anyone "fixes" it.

**F. Shared mutable bearer token on a singleton ApiClient (Medium, concurrency).**
`AdminController` and `ClaimsServiceAdapter` call `apiClient.setBearerToken(...)` per request on a shared client. Two concurrent requests can interleave: user B's call to claims-service can carry user A's token (or the service-account token), which is both a correctness and an authorization bleed risk. Needs per-request client or request-interceptor token resolution. Not demonstrable without a running stack + load, hence flagged, not tested.

**G. Money as `double` across every HTTP contract (Medium).**
Domain uses `BigDecimal`, but OpenAPI declares `number format: double`, so each hop does BigDecimal→double→BigDecimal. DB column is `DECIMAL(12,2)` so storage is safe; display/comparison drift is possible at high precision. Recommend `type: string` + BigDecimal mapping.

**H. Smaller findings.**
- BFF `AdminController` maps claims-service 400s to an **empty** 400 body, dropping the ProblemDetail ("Cannot transition from X to Y") the OpenAPI contract promises; the admin UI then shows a generic message.
- Domain allows amounts like `0.001` (`> 0`), while API bean-validation enforces `>= 0.01` — inconsistent floor if any non-HTTP path creates claims.
- Access-token cookie Max-Age is 5 min while the Keycloak access token lives 24 h (`accessTokenLifespan: 86400`) — a long-lived bearer outlives its carrier cookie by design-smell; also WebSocket falls back to accepting the JWT as a **query parameter** (token leakage into logs/history).
- UI truncates descriptions at 50 chars with "…", summary API truncates at 100 without — cosmetic inconsistency.
- `tests/e2e/global-setup.ts` referenced by `playwright.config.ts` did not exist → `npx playwright test` failed before I added the E2E suite.

## 5. What I'd do next, in order
1. Spin the Docker stack and run the Playwright suite + the `integration`-tagged Testcontainers tests; confirm findings A and C live (both have precise repro steps above).
2. Fix A–C (one-line compose fix; align CDC schema/TestEventController/consumer on `claim_id`; add logout to the CSRF ignore list *or* send the header from the UI) — each with the regression test already written here.
3. Kafka contract tests: validate the producer envelope against the AsyncAPI JSON schemas in CI (the validator exists and is switched off).
4. Concurrency test for F (parallel admin + claimant requests through the BFF asserting token isolation), then refactor to per-request clients.
5. K6 baseline on list-claims and dashboard endpoints; wire thresholds.
