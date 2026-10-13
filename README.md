# Demo App — Insurance Claims Management

A three-tier microservices application used as a QA assessment platform. The app is fully functional and ships with unit tests. The QA team's task is to extend test coverage across all layers — integration, contract, E2E, load, and beyond.

---

## Architecture

![Architecture](ss-demo-app.png)

| Tier | Technology | Port |
|------|-----------|------|
| UI | Next.js 16 + React 19 | 3001 |
| BFF | Spring Boot 4 + Java 21 | 8090 |
| Claims Service | Spring Boot 4 + Java 21 | 8080 |
| Auth | Keycloak 26 (OAuth2/OIDC) | 8180 |
| Database | PostgreSQL 15 | 5432 |
| Cache | Redis 7 | 6379 |
| Event Streaming | Apache Kafka | 9092 |
| Kafka UI | provectuslabs/kafka-ui | 9093 |
| CDC (optional) | Debezium 2.4 | 8083 |

See [ARCHITECTURE.md](ARCHITECTURE.md) for full details.

---

## Prerequisites

| Tool | Min version | Check | Install |
|------|-------------|-------|---------|
| **Docker Desktop** | 24+ | `docker --version` | https://docs.docker.com/get-docker/ |
| **Java (JDK)** | 21 | `java -version` | https://adoptium.net |
| **Maven** | 3.9+ | `mvn -version` | https://maven.apache.org/download.cgi |
| **Node.js** | 20+ | `node --version` | https://nodejs.org |

> **macOS:** `brew install --cask docker && brew install temurin@21 maven node`

---

## Quick Start

```bash
./start-infra.sh   # Start PostgreSQL, Kafka, Redis, Keycloak
./start-app.sh     # Build JARs + start Claims Service, BFF, UI
```

> First run: ~2–3 min (image downloads). Subsequent starts: ~30 seconds.

### URLs

| What | URL | Credentials |
|------|-----|-------------|
| **Demo App UI** | http://localhost:3001 | See test users below |
| BFF Swagger | http://localhost:8090/swagger-ui.html | — |
| Claims Swagger | http://localhost:8080/swagger-ui.html | — |
| Keycloak Admin | http://localhost:8180 | `admin` / `Admin123!` |
| Kafka UI | http://localhost:9093 | — |

### Test Users

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin@demo.com` | `Admin123!` |
| Claimant | `claimant@demo.com` | `Claimant123!` |

---

## Stop

```bash
./stop-app.sh
./stop-infra.sh

# Wipe all data for a clean slate:
./stop-app.sh && ./stop-infra.sh -v
```

---

## Real-Time Events — Two Modes

Claim events are pushed to the UI in real time via WebSocket. There are two ways to generate those events — choose one. Running both simultaneously causes duplicate notifications.

### Mode 1: Direct Kafka (default)

The Claims Service publishes events directly to Kafka after each write. No extra setup needed.

`APP_EVENTS_CDC_ENABLED=false` is set by default in `docker-compose.apps.yml`. Just run the normal startup above.

---

### Mode 2: Change Data Capture via Debezium

Debezium monitors the PostgreSQL WAL (write-ahead log) and publishes database changes to Kafka. The BFF consumes these CDC events.

**Step 1** — In `docker-compose.apps.yml`, set:
```yaml
APP_EVENTS_CDC_ENABLED: "true"
```

**Step 2** — Start the app (infra + app must be running first):
```bash
./start-app.sh
```

**Step 3** — Start Debezium after the app is healthy:
```bash
./start-cdc.sh
```

**Verify connector is running:**
```bash
curl http://localhost:8083/connectors/claims-connector/status | python3 -m json.tool
```
You should see `"state": "RUNNING"` for both the connector and its task.

**Stop CDC:**
```bash
./stop-cdc.sh
```

> To switch back to direct Kafka: set `APP_EVENTS_CDC_ENABLED=false` and run `./start-app.sh`.

---

## Testing

### What's already there

The codebase ships with **unit tests** across all three tiers and scaffolding for more advanced testing types. The intent is that the QA team uses this as a starting point and builds out coverage from here.

| Layer | Framework | Status |
|-------|-----------|--------|
| Backend unit tests | JUnit 5, Mockito, AssertJ | Provided — some may need fixing |
| Frontend unit tests | Vitest, Testing Library | Provided |
| E2E tests | Playwright | Scaffolded — empty |
| Contract tests | Pact | Scaffolded — empty |
| Integration tests | Testcontainers | Scaffolded — empty |
| Architecture tests | ArchUnit | Provided |

### What's been disabled

To keep the build simple and focused on the app itself, the following have been turned off in `pom.xml` (but the code/config remains for the QA team to re-enable and work with):

| Feature | Property | Notes |
|---------|----------|-------|
| WireMock stub generation | `skipWiremockGeneration=true` | Stubs exist in `code/bff-service/mocks/` |
| AsyncAPI doc generation | `skipAsyncApiGeneration=true` | Specs exist in `src/main/resources/asyncapi/` |
| Postman collection generation | `skipPostmanGeneration=true` | Can be re-enabled |
| Kafka schema validation | `kafka.producer.schema-validation.enabled=false` | Schema files exist in `asyncapi/schemas/` |
| Checkstyle / PMD | Skipped in Docker build | Still runs locally via `mvn verify` |

### QA team scope

The app is a blank canvas for testing. Suggested areas:

- Fix and extend unit tests (a broken test exists as a starting point)
- Add integration tests using Testcontainers
- Build out Pact contract tests between BFF and Claims Service
- Write Playwright E2E tests for the main user journeys
- Add load/performance tests (K6, Gatling, etc.)
- Create a test strategy document
- Write manual test scripts

### Run existing unit tests

```bash
# Backend
cd code/claims-service && mvn test
cd code/bff-service && mvn test

# Frontend
cd code/demo-app-ui && npm test
```

### Run E2E tests (requires full stack running)

```bash
cd code/demo-app-ui && npx playwright test
```

---

## Diagnostics

```bash
# Container status
docker compose -f docker-compose.infra.yml ps
docker compose -f docker-compose.apps.yml ps

# Service logs
docker compose -f docker-compose.apps.yml logs -f claims-service
docker compose -f docker-compose.apps.yml logs -f bff-service
docker compose -f docker-compose.apps.yml logs -f ui

# Health checks
curl http://localhost:8080/actuator/health   # Claims Service
curl http://localhost:8090/actuator/health   # BFF Service
```

---

## Running Services Locally (IDE / Debugging)

Start infra via Docker, then run services on your machine:

```bash
./start-infra.sh

# Terminal 1
cd code/claims-service && mvn spring-boot:run

# Terminal 2
cd code/bff-service && mvn spring-boot:run

# Terminal 3
cd code/demo-app-ui
npm install   # first time only
npm run dev -- --port 3001
```

---

## Rebuilding After Code Changes

```bash
# Full rebuild (Maven + Docker)
./start-app.sh

# Rebuild a single service image only
docker compose -f docker-compose.apps.yml up --build --pull never claims-service
docker compose -f docker-compose.apps.yml up --build --pull never bff-service
docker compose -f docker-compose.apps.yml up --build --pull never ui
```

---

## QA Assessment Deliverables (added)

| File | Purpose |
|------|---------|
| [RUN_GUIDE.md](RUN_GUIDE.md) | **New machine? Start here:** step-by-step from installing tools and starting Docker to running every suite |
| [TESTING.md](TESTING.md) | **Start here to run the tests:** what each suite covers, how to run it, the expected results |
| [run-tests.sh](run-tests.sh) | One command per suite: `./run-tests.sh unit \| defects \| integration \| e2e \| load` |
| [docs/QA_Findings_Report.pdf](docs/QA_Findings_Report.pdf) | Walkthrough report: 18 findings with live evidence and fixes |
| [TEST_STRATEGY.md](TEST_STRATEGY.md) | Risk assessment, test choices, findings, next steps |
| [AI_JOURNAL.md](AI_JOURNAL.md) | What I accepted, challenged and overrode from the AI |
| [load/](load/) | k6 load script and the Keycloak load-user seeder |

### Before you start the stack (known setup defects)

The quick-start above has three defects, all documented in TEST_STRATEGY.md. Work around them like this:

```bash
# Finding 3: the UI's API client is gitignored and never generated, so every page behind login returns 500
cd code/demo-app-ui && npm ci && npm run generate:api && cd -

# Finding 2: signup returns 500 unless the BFF gets the real Keycloak admin password
#   add  KEYCLOAK_ADMIN_PASSWORD: "Admin123!"  under bff-service.environment in docker-compose.apps.yml

# Finding 1: real-time updates need APP_EVENTS_CDC_ENABLED: "false", unless ./start-cdc.sh is running
```

The E2E suite runs against the stack exactly as shipped. It does not need these workarounds, apart from the generated client.

### Running the tests

The quickest way is the runner. Run `./run-tests.sh <suite>`, and see [TESTING.md](TESTING.md) for the full guide. The raw commands it wraps are below.

```bash
# Unit and component suites (no Docker needed)
cd code/claims-service && mvn test           # 237 passed
cd code/bff-service    && mvn test           # 219 passed
cd code/demo-app-ui    && npm test           # 280 passed (needs the generated client, see above)

# Known-defect regression tests - FAIL BY DESIGN until the bugs are fixed
cd code/bff-service && mvn test -Dgroups=defect -Dsurefire.excludedGroups=integration

# Integration tests (Testcontainers, needs Docker running) - claims 8 passed, BFF 4 passed
mvn test -Dgroups=integration -Dsurefire.excludedGroups=

# E2E (needs ./start-infra.sh && ./start-app.sh) - 11 passed, 2 of them known-defect tests that fail by design
cd code/demo-app-ui && npx playwright install chromium && npx playwright test

# Load (needs the stack). Seed one Keycloak user per virtual user first, see finding 15.
./load/seed-load-users.sh 20
docker run --rm --network demo-network -v "$PWD/load:/scripts" grafana/k6:0.54.0 run \
  -e BFF_URL=http://bff-service:8090 -e VUS=10 -e DURATION=60s /scripts/k6-claims-smoke.js
```

> **Windows:** Docker Desktop's per-user install puts `docker.exe` in `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin`. Open a new terminal after installing, or add that folder to `PATH`.
