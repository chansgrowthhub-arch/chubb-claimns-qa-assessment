# Test Suite Handover Guide

This repository ships a layered automated test suite for the Claims Management application. It covers unit, component, integration, end-to-end and load tests. Every suite runs on its own with one command:

```bash
./run-tests.sh <suite>      # unit | unit-claims | unit-bff | unit-ui | defects | integration | e2e | load
```

Run `./run-tests.sh` with no argument to print this list.

**On Windows**, the script runs in Git Bash, which comes with Git for Windows. From PowerShell, call Git Bash explicitly. A plain `bash` in PowerShell is WSL's bash and will not work:

```powershell
cd "C:\path\to\demo-app-qa-main"
& "C:\Program Files\Git\bin\bash.exe" ./run-tests.sh integration
```

---

## 1. What is in the suite

| Suite | Command | Tests | Tool | Needs | What it proves |
|-------|---------|-------|------|-------|----------------|
| Claims service unit | `./run-tests.sh unit-claims` | 237 | JUnit 5, Mockito, AssertJ, ArchUnit | JDK 21, Maven | Business rules, the status state machine, use cases, Kafka event envelope, architecture rules |
| BFF unit | `./run-tests.sh unit-bff` | 219 | JUnit 5, Spring MockMvc | JDK 21, Maven | Auth and cookie handling, CSRF, role-based access, Kafka-to-WebSocket messages |
| UI component and unit | `./run-tests.sh unit-ui` | 280 | Vitest, Testing Library | Node 20+ | Screens behave as a user sees them: login, claim wizard, claims table, stores |
| Known defects | `./run-tests.sh defects` | 2 | JUnit 5 (tag `defect`) | JDK 21, Maven | Each test reproduces an open bug, so it fails until that bug is fixed |
| Integration | `./run-tests.sh integration` | 12 | Testcontainers | Docker running | Services against real Postgres, Kafka, Redis and Keycloak containers |
| End-to-end | `./run-tests.sh e2e` | 11 | Playwright (Chromium) | Full stack running | Real user journeys in a browser, end to end through every service |
| Load | `./run-tests.sh load` | 1 scenario | k6 (via Docker) | Full stack running | Response times and error rate with 10 concurrent users |

`./run-tests.sh unit` runs all three unit suites. Each script exits 0 on success, so it drops straight into a CI pipeline.

## 2. What we built, what we prioritised, and why

### How we chose
We read every layer of the code before writing a test. Then we put effort where a defect would hurt a policyholder or the business most:

1. **Claim business rules.** Amounts, dates and the status lifecycle carry money. A boundary mistake there corrupts records silently.
2. **The real-time event pipeline** (claims service → Kafka → BFF → WebSocket → browser). It runs on hand-written message contracts with schema checks switched off, so failures are silent.
3. **Access control.** A gap leaks one customer's claims to another.
4. **Login, session and logout.** This code is hand-rolled around Keycloak, and mistakes here are account-security problems.
5. **Setup reproducibility.** A suite that only runs on one machine protects nobody.

### What we built, by priority

| Priority | Area | Tests added | Where |
|----------|------|-------------|-------|
| 1 | Claim rules | Exact boundary values (min − 1, min, max, max + 1) for amount, description, location and date; all 25 status moves checked from one table | `code/claims-service/src/test/java/com/example/demo/domain/claim/ClaimBoundaryTest.java`, `ClaimStatusTransitionMatrixTest.java` |
| 2 | Event pipeline | Tests that check the content of every pushed message, not just that one was sent; the publisher test rewritten against the real Kafka envelope | `code/bff-service/src/test/java/com/example/demo/adapter/in/messaging/ClaimEventKafkaConsumerContentTest.java`, `code/claims-service/src/test/java/com/example/demo/adapter/out/messaging/KafkaDomainEventPublisherTest.java` |
| 3 | Access control | E2E checks that a claimant gets 403 on admin APIs and never receives another user's claim | `code/demo-app-ui/tests/e2e/auth-and-rbac.spec.ts` |
| 4 | Auth and session | CSRF contract tests for logout and login; E2E checks for wrong password, role-based landing page and anonymous redirect | `code/bff-service/src/test/java/com/example/demo/adapter/in/web/AuthCsrfContractTest.java`, `auth-and-rbac.spec.ts` |
| 4 | User-facing screens | Login page, claims table, and a date display check across time zones | `code/demo-app-ui/app/(auth)/login/login-page.test.tsx`, `src/features/claims/components/claims-table.test.tsx`, `src/features/claims/utils/incident-date-timezone.test.ts` |
| 1–4 | Full journeys | Claimant submits through the 3-step wizard; admin moves the claim through review; illegal moves are not offered; claimant sees the result | `code/demo-app-ui/tests/e2e/claims-lifecycle.spec.ts` |
| 5 | Reproducibility | Fixed the shipped suite, which could not pass; pinned container images; added the missing Playwright setup | See section 6 |
| Bonus | Performance | k6 script with one account per virtual user | `load/k6-claims-smoke.js`, `load/seed-load-users.sh` |

### Engineering conventions
- **Test names read as specifications.** For example: `should_RejectAmount_When_OneCentAboveMaximum`, and the Playwright test "admin is not offered illegal transitions for an Approved claim".
- **No magic values.** Limits are named constants, and test users live in one place (`tests/e2e/support/test-users.ts`).
- **Page objects for E2E** (`tests/e2e/pages/`). A UI change is fixed in one file, not in every test.
- **Log in once.** Playwright's global setup logs each user in once, saves the session, and warms every page before tests start. Tests are fast and not flaky on a cold server.
- **Behaviour over implementation.** UI tests find elements by role and label, as a user or screen reader would.

### What we deliberately left out
- **Pact contract tests.** Both HTTP sides are generated from the same OpenAPI files, so the unprotected contracts were the Kafka messages. Those are covered by message-content tests instead.
- **Keycloak adapter internals, tracing, metrics, theming.** These carry low business risk for the effort.
- **Visual regression.** This is the next step if UI styling becomes a release risk.

## 3. Before you run anything

| Tool | Version | Check | Needed for |
|------|---------|-------|------------|
| JDK | **exactly 21** | `java -version` | Java unit, defect and integration suites. Newer JDKs (for example 25 or 27) fail to compile the project because Lombok breaks. If several JDKs are installed, set `JAVA_HOME` to the JDK 21 folder. The runner checks this and stops with a clear message |
| Maven | optional | `mvn -version` | If Maven is not installed, the runner uses each service's Maven Wrapper (`./mvnw`), which downloads Maven 3.9.9 on first use |
| Node.js | 20+ | `node --version` | UI unit and E2E suites |
| Docker Desktop | 24+, running | `docker info` | Integration, E2E (stack) and load suites |
| Git Bash | any | Windows only | Running `run-tests.sh` |

Installing JDK 21 on Windows: run `winget install EclipseAdoptium.Temurin.21.JDK`. Then point `JAVA_HOME` at it. In PowerShell use `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.<version>-hotspot"`. In Git Bash use `export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.<version>-hotspot"`.

On the first UI run, the script installs npm packages and generates the UI's API client. That client is gitignored and must be generated on every fresh clone. The first E2E run also downloads Chromium.

## 4. Running each suite

### No services needed
```bash
./run-tests.sh unit-claims     # about 1 min after the first dependency download
./run-tests.sh unit-bff        # about 1 min
./run-tests.sh unit-ui         # about 30 s
./run-tests.sh defects         # about 1 min, expected result: the 2 tests FAIL (see section 5)
```

### Docker running, nothing else
```bash
./run-tests.sh integration     # 3–6 min, starts and stops its own containers
```

### Full stack running
```bash
./start-infra.sh               # Postgres, Kafka, Redis, Keycloak
./start-app.sh                 # claims service, BFF, UI on http://localhost:3001
./run-tests.sh e2e             # about 30 s once the stack is up
./run-tests.sh load            # about 1.5 min; K6_VUS=20 K6_DURATION=2m ./run-tests.sh load to change it
```

Before `./start-app.sh`, generate the UI client once with `cd code/demo-app-ui && npm ci && npm run generate:api`. Otherwise every page behind login returns 500 (open bug, finding 3).

### Running the underlying tools directly
```bash
cd code/claims-service && mvn test                                              # unit
cd code/claims-service && mvn test -Dgroups=integration -Dsurefire.excludedGroups=   # integration
cd code/bff-service    && mvn test -Dgroups=defect -Dsurefire.excludedGroups=integration
cd code/demo-app-ui    && npx vitest run                                        # UI unit
cd code/demo-app-ui    && npx vitest run src/features/claims                    # one folder
cd code/demo-app-ui    && npx playwright test tests/e2e/claims-lifecycle.spec.ts      # one E2E file
cd code/demo-app-ui    && npx playwright test --headed                          # watch the browser
```

## 5. Expected results and how to read them

| Suite | Expected result today |
|-------|-----------------------|
| unit-claims | 237 run, 0 failures |
| unit-bff | 219 run, 0 failures |
| unit-ui | 280 passed. One is a known-defect test written with `it.fails`, which counts as passed while the bug exists |
| defects | **2 failures, and that is the PASS condition.** Each failure is an open bug |
| integration | Claims service 8 run, BFF 4 run, 0 failures |
| e2e | 11 passed. Two are known-defect tests marked `test.fail`; they fail as expected and show as passed |
| load | All thresholds met: 0% failed requests, list-claims p95 under 800 ms |

**Known-defect tests.** These tests describe the correct behaviour, so they fail while a bug exists. That keeps the bug visible without breaking the normal build. When a bug is fixed, its test starts passing, and the runner says so. Then remove the marker so the test joins the normal suite.

| Test | Marker | Open bug it pins | When fixed |
|------|--------|------------------|------------|
| `ClaimEventKafkaConsumerContentTest.should_BroadcastClaimId_When_CdcPayloadMatchesCommittedAsyncApiSchema` | `@Tag("defect")` | CDC schema and event-injection tool use `id`, real events use `claim_id` (finding 6) | Remove the tag |
| `AuthCsrfContractTest.should_ClearCookies_When_LogoutCalledWithExpiredAccessToken` | `@Tag("defect")` | Logout fails when the access token has expired (finding 5) | Remove the tag |
| `auth-and-rbac.spec.ts`: logout invalidates the server session | `test.fail` | Logout rejected by CSRF protection; the session survives (finding 4) | Delete the `test.fail` line |
| `auth-and-rbac.spec.ts`: missing claim returns 404 | `test.fail` | BFF returns 500 instead of 404/403 (finding 7) | Delete the `test.fail` line |
| `incident-date-timezone.test.ts`: user west of UTC | `it.fails` | Incident dates show one day early west of UTC (finding 8) | Change `it.fails` to `it` |

**Reports.**
- Maven: `code/<service>/target/surefire-reports/`.
- Playwright: `code/demo-app-ui/playwright-report/index.html`, with a trace kept on retry.
- Playwright JUnit XML for CI: `code/demo-app-ui/playwright-report/results.xml`.
- k6: the summary is printed in the terminal.

The full bug list with evidence is in `TEST_STRATEGY.md` and `docs/QA_Findings_Report.pdf`.

## 6. Problems you may hit, and the fix

| Symptom | Cause | Fix |
|---------|-------|-----|
| UI tests or pages fail with `Can't resolve './generated'` | The UI API client is gitignored and was never generated | `cd code/demo-app-ui && npm run generate:api` (the runner does this for you) |
| `docker: command not found` on Windows right after installing | Docker Desktop's per-user install is not on PATH in an already-open terminal | The runner now finds it automatically. For your own shell, open a new terminal or add `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin` to PATH |
| `'/run-tests.sh' is not recognized` in PowerShell | PowerShell cannot run bash scripts, and the command was missing the leading dot | `& "C:\Program Files\Git\bin\bash.exe" ./run-tests.sh <suite>` (see the top of this guide) |
| `Java 27 found, but this project needs JDK 21` | A newer JDK is first on PATH | Install JDK 21 and set `JAVA_HOME` to it (section 3) |
| `Docker Desktop is unable to start`, or the runner says the engine is not running | Docker's engine stopped. On Windows this often follows a WSL update error (`Wsl/CallMsi/Install/ERROR_NOT_FOUND` in Docker's log) | Check that `wsl --version` works, then restart Docker Desktop from its tray menu or with `docker desktop restart` |
| `./run-tests.sh: bad interpreter` or `$'\r'` errors | The script was saved with Windows line endings | `git config core.autocrlf input` and check out again (the repo's `.gitattributes` keeps `.sh` files on LF) |
| Integration tests fail with `invalid value for parameter "TimeZone"` | An unpinned `postgres:latest` image (fixed in this repo) | Keep test images pinned to the versions in `docker-compose.infra.yml` |
| Load test: some or all logins return 401 | Keycloak brute-force protection: parallel logins to one account are rejected, and two failures within 1 s lock it for 60 s | The runner seeds dedicated accounts, `loaduser1..N+1` plus `loadadmin`, so no account is shared. k6 numbers virtual users across both scenarios, so it needs one more account than `K6_VUS`. Keycloak runs in memory, so accounts vanish when the stack restarts; the runner re-seeds every time |
| Signup returns 500 on the stack | The BFF is not given the Keycloak admin password (open bug, finding 2) | Add `KEYCLOAK_ADMIN_PASSWORD: "Admin123!"` to `bff-service` in `docker-compose.apps.yml` |
| No live updates in the UI | The stack ships with CDC mode on but Debezium off (open bug, finding 1) | Set `APP_EVENTS_CDC_ENABLED: "false"` for `claims-service`, or run `./start-cdc.sh` |
| First E2E run is slow | `next dev` compiles each page on first visit | Expected. Global setup warms every page before the tests start |

## 7. Adding a test

| Kind | Put it in | Run it with |
|------|-----------|-------------|
| Business rule | `code/claims-service/src/test/java/.../domain/` | `./run-tests.sh unit-claims` |
| BFF endpoint or security rule | `code/bff-service/src/test/java/.../adapter/in/web/` using `@WebMvcTest` | `./run-tests.sh unit-bff` |
| Needs a real database or Kafka | Same packages, class annotated `@Tag("integration")` | `./run-tests.sh integration` |
| Screen behaviour | Next to the component, `*.test.tsx`, using Testing Library queries by role and label | `./run-tests.sh unit-ui` |
| User journey | `code/demo-app-ui/tests/e2e/*.spec.ts`, using the page objects in `tests/e2e/pages/` | `./run-tests.sh e2e` |
| Reproduces an open bug | Normal test plus `@Tag("defect")`, `test.fail(...)` or `it.fails(...)`, with a comment naming the bug | `./run-tests.sh defects` (Java) |
