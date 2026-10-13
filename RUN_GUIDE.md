# Step-by-Step Run Guide

This guide takes you from a fresh copy of the source code to running every test suite. It assumes Windows 11 and VS Code. On macOS or Linux, skip the Windows-only parts. Every command from step 4 onward is the same on all systems.

Work through the steps in order the first time. After that, use the quick reference at the end.

| Step | What you do | Time on first run |
|------|-------------|-------------------|
| 1 | Install the tools (once per machine) | 15–30 min |
| 2 | Open the project in VS Code with a Git Bash terminal | 2 min |
| 3 | Point the terminal at JDK 21 | 2 min |
| 4 | Start the Docker engine | 1–2 min |
| 5 | Run the suites that need no services | 5 min |
| 6 | Run the integration suite | 3–10 min |
| 7 | Start the full application stack | 5–10 min |
| 8 | Run the end-to-end and load suites | 3 min |
| 9 | Stop everything | 1 min |

---

## Step 1. Install the tools (once per machine)

| Tool | Version | How to install on Windows |
|------|---------|---------------------------|
| Git for Windows | any recent | https://git-scm.com/download/win. It includes **Git Bash**, which runs the project scripts |
| JDK | **exactly 21** | `winget install EclipseAdoptium.Temurin.21.JDK` |
| Node.js | 20 or newer | `winget install OpenJS.NodeJS.LTS` |
| Docker Desktop | 24 or newer | https://www.docker.com/products/docker-desktop. Keep the default WSL 2 backend |
| VS Code | any | https://code.visualstudio.com |

You do **not** need to install Maven. Each Java service ships a Maven Wrapper that downloads Maven on first use.

> **Why exactly JDK 21?** The project uses Lombok, which does not compile on newer JDKs such as 25 or 27. Other JDKs can stay installed. Step 3 points this project at JDK 21 only.

If Docker Desktop asks for WSL during installation, run this in an administrator PowerShell, then restart Windows:

```powershell
wsl --install
```

After installing, close every open terminal and VS Code window, so they pick up the new tools.

## Step 2. Open the project in VS Code with a Git Bash terminal

1. Unzip or clone the source code, for example to `C:\work\demo-app-qa-main`.
2. In VS Code, choose **File > Open Folder** and select the `demo-app-qa-main` folder. It is the folder that contains `run-tests.sh`.
3. Make Git Bash the default terminal. Press `Ctrl+Shift+P`, type **Terminal: Select Default Profile**, and choose **Git Bash**.
4. Open a terminal with **Terminal > New Terminal**. The prompt should end in `$`, not `PS C:\...>`.

Every command from here on runs in this Git Bash terminal, from the project folder.

> **Why not PowerShell?** The scripts are bash scripts, and PowerShell cannot run them. Typing a plain `bash` in PowerShell starts WSL's Linux bash, which cannot see Windows' Java. If you must stay in PowerShell, prefix each command with Git Bash, for example `& "C:\Program Files\Git\bin\bash.exe" ./run-tests.sh unit`.

On macOS or Linux, if the code came as a zip file, make the scripts executable once:

```bash
chmod +x *.sh load/*.sh code/*/mvnw
```

## Step 3. Point the terminal at JDK 21

Find the exact name of the JDK 21 folder:

```bash
ls "/c/Program Files/Eclipse Adoptium/"
```

Put the `jdk-21...` name it prints into the first line below. This example uses `jdk-21.0.5.11-hotspot`:

```bash
echo 'export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.5.11-hotspot"' >> ~/.bashrc
echo 'export PATH="$JAVA_HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
java -version
```

`java -version` must print `version "21...`. The setting is saved in `~/.bashrc`, so every new Git Bash terminal uses JDK 21 from now on.

Check the other tools in the same terminal:

```bash
node --version      # v20 or newer
git --version
docker --version
```

If `docker` says "command not found", close VS Code completely and reopen it. A terminal opened before Docker Desktop was installed cannot see it.

## Step 4. Start the Docker engine

1. Start **Docker Desktop** from the Windows Start menu.
2. Wait until its window shows **Engine running** in the bottom-left corner.
3. Confirm from the terminal:

```bash
docker info --format '{{.ServerVersion}}'
```

It prints a version number, such as `29.0.0`. If it prints an error instead, the engine is still starting. Wait 30 seconds and try again.

Docker is needed from step 6 onward. Step 5 works without it.

## Step 5. Run the suites that need no services

These run straight from the source code. The first run downloads Maven and npm dependencies, so it takes longer than later runs.

```bash
./run-tests.sh unit-claims     # claims service: expect 237 tests, 0 failures
./run-tests.sh unit-bff        # BFF: expect 219 tests, 0 failures
./run-tests.sh unit-ui         # UI: expect 280 passed
./run-tests.sh defects         # expect 2 FAILURES, which is the correct result
```

To run the three unit suites in one go:

```bash
./run-tests.sh unit
```

Each command ends with a green **PASS** or a red **FAIL** line.

> **About `defects`:** these two tests reproduce bugs that are still open. They are written to fail until the bugs are fixed. So 2 failures means "the bugs are still there", and the runner prints PASS. If the runner ever reports that the defect tests now pass, a bug has been fixed. Section 5 of TESTING.md explains what to do then.

## Step 6. Run the integration suite (Docker must be running)

```bash
./run-tests.sh integration     # expect claims service 8 tests and BFF 4 tests, 0 failures
```

This suite starts its own temporary Postgres, Kafka, Redis and Keycloak containers and removes them at the end. It does not need the application stack from step 7. The first run downloads those container images, so allow up to 10 minutes.

## Step 7. Start the full application stack

The end-to-end and load suites test the real running application, so start it first.

**7a. Generate the UI's API client (first time only).** The UI image is built from the source folder, and this generated code is not in the repository. If you skip this step, every page behind login fails with error 500. This is a known bug in the shipped project, finding 3 in TEST_STRATEGY.md.

```bash
cd code/demo-app-ui && npm ci && npm run generate:api && cd ../..
```

**7b. Start the infrastructure:** Postgres, Kafka, Redis and Keycloak.

```bash
./start-infra.sh
```

**7c. Build and start the application:** the claims service, the BFF and the UI. The `-d` flag runs it in the background and gives you your terminal back.

```bash
./start-app.sh -d
```

The first run compiles both Java services and builds three images, so it takes several minutes.

**7d. Check that it is up.** The UI takes up to a minute to answer after its container starts. Repeat this until it prints `200`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/login
```

You can also open http://localhost:3001 in a browser and sign in with a seeded account:

| Role | Email | Password |
|------|-------|----------|
| Claimant | claimant@demo.com | Claimant123! |
| Admin | admin@demo.com | Admin123! |

Other useful pages:

| Service | Address |
|---------|---------|
| Keycloak admin console | http://localhost:8180 (admin / Admin123!) |
| Kafka UI | http://localhost:9093 |
| BFF health check | http://localhost:8090/actuator/health |

## Step 8. Run the end-to-end and load suites (stack must be running)

```bash
./run-tests.sh e2e             # expect 11 passed
./run-tests.sh load            # expect "Load test thresholds met"
```

**End-to-end.** The first run downloads the Chromium browser. Two of the 11 tests are known-defect tests. They fail as expected, and Playwright counts them as passed.

To open the HTML report:

```bash
cd code/demo-app-ui && npx playwright show-report
```

To watch the browser while the tests run:

```bash
cd code/demo-app-ui && npx playwright test --headed
```

**Load.** The runner first creates one test login per virtual user. Then it runs k6 in Docker with 10 users for 60 seconds. To change the load:

```bash
K6_VUS=20 K6_DURATION=2m ./run-tests.sh load
```

## Step 9. Stop everything

```bash
./stop-app.sh       # stops the claims service, BFF and UI
./stop-infra.sh     # stops Postgres, Kafka, Redis and Keycloak, and keeps their data
```

To also delete all data, so the next start is completely fresh:

```bash
./stop-infra.sh -v
```

You can then quit Docker Desktop.

---

## Next time: quick reference

Once steps 1, 2, 3 and 7a are done, a normal session looks like this:

```bash
# First start Docker Desktop and wait for "Engine running"
./run-tests.sh unit            # no services needed
./run-tests.sh defects         # no services needed, 2 failures expected
./run-tests.sh integration     # Docker only

./start-infra.sh
./start-app.sh -d              # rebuilds, so code changes are picked up
./run-tests.sh e2e
./run-tests.sh load

./stop-app.sh && ./stop-infra.sh
```

If the code has not changed since the last build, this starts the application faster, because it skips the rebuild:

```bash
docker compose -f docker-compose.apps.yml up -d --no-build
```

## If something goes wrong

| What you see | What to do |
|--------------|------------|
| `'/run-tests.sh' is not recognized` | You are in PowerShell. Switch the terminal to Git Bash (step 2) and type `./run-tests.sh`, with the leading dot |
| `Java 27 found, but this project needs JDK 21` | `JAVA_HOME` is not set to JDK 21. Redo step 3, then open a new terminal |
| `Docker is installed but the engine is not running` | Start Docker Desktop and wait for **Engine running** (step 4) |
| `Docker Desktop is unable to start` | In PowerShell, check that `wsl --version` works. Then restart Docker Desktop from its icon in the system tray |
| `The app is not reachable at http://localhost:3001`, or E2E setup fails while logging in | The stack is not running. Do step 7. Restarting Docker Desktop or Windows stops all the containers |
| `dependency kafka failed to start` during `./start-infra.sh` | Run `docker restart demo-zookeeper`, then `./start-infra.sh` again. This happens after Docker was stopped abruptly |
| Pages behind login show error 500 | Step 7a was skipped. Do it, then run `./start-app.sh -d` to rebuild the UI |
| `$'\r': command not found` | The scripts were checked out with Windows line endings. Run `git config --global core.autocrlf input`, then clone the repository again |
| `Permission denied` when running a script | Run the `chmod` command from step 2 |

TESTING.md has more detail on what each suite covers and why, and more troubleshooting.
