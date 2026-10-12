# AI Working Journal

**Tooling:** Claude Code (an agentic CLI) in VS Code. It read the code, ran the builds and wrote most of the code. I directed each step, reviewed the results and signed off.
**Log format:** what I asked for, what the AI produced, and whether I **accepted**, **challenged** or **overrode** it, with the reason.

---

### 1. Read before writing
- **Asked:** read every layer and the compose files before writing any test, then rank the risks.
- **Accepted:** the ranked risk list. Domain rules came first, then the Kafka/WebSocket seam, then RBAC, then auth.
- **Challenged:** the first draft ranked the dashboard cache highly because it has the most code. I moved it down. Wrong numbers on a dashboard are embarrassing, but they do not corrupt data, and the cache code already fails gracefully.

### 2. Environment constraint
- My machine had no Docker, Maven or JDK 21. The only Java installed was JDK 27.
- **Accepted:** the AI downloaded a portable Temurin 21 and Maven into a scratch folder. The repo was not modified for this.
- **Overrode:** the AI suggested writing a large set of Testcontainers tests anyway. I declined. A container test I cannot run is unverified code. The brief warns that tests which never ran are worse than no tests. I kept the existing integration tests behind their tag and spent the time on tests I could run.

### 3. The planted broken test
- **Accepted:** the fix for `UpdateClaimStatusUseCaseTest`, which needed the missing `ApplicationEventPublisher` argument.
- **Challenged:** the AI first reported "suite green after fix". It was not. Running the suite showed two more stale test classes. `CreateClaimUseCaseTest` threw a null pointer because the same dependency was missing. `KafkaDomainEventPublisherTest` mocked a serialisation method the code no longer calls, so it failed against today's code. I insisted on running the suite instead of trusting the summary.
- **Overrode:** the AI's first patch for the publisher test made the old mocks pass again. I had the class rewritten with a real `ObjectMapper` and assertions on the envelope content. That envelope is the actual Kafka contract the BFF consumer depends on.

### 4. Kafka consumer tests
- **Accepted:** the observation that the existing tests only checked that a broadcast happened.
- **Directed:** capture the `WebSocketMessage` and assert its fields. This exposed the CDC `id` vs `claim_id` mismatch.
- **Decided:** the defect test fails on purpose and is tagged `defect`. It is excluded from the default run, so CI stays green while the bug stays visible and reproducible with one command. I rejected two alternatives. A disabled test rots silently. A test that asserts the buggy behaviour enshrines the bug.

### 5. Logout
- **Accepted:** the CSRF analysis. Logout is missing from the CSRF ignore list, and the UI's raw fetch sends no CSRF header.
- **Found while verifying:** the AI's first "logout succeeds with a CSRF token" test also sent an `access_token` cookie and got a 401. We could have deleted the cookie and moved on. I kept the case as a second `defect` test instead. Logout fails for exactly the users whose token has expired, which are the users who most need logout to work.

### 6. UI tests
- **Accepted:** the login page tests and claims table tests, which query by role and label as Testing Library intends.
- **Challenged:** the first clipboard test stubbed `navigator.clipboard` before `userEvent.setup()`. That setup call replaces the stub, so the test failed. I had it spy on the clipboard after setup instead.
- **Diagnosed, not papered over:** 6 shipped tests in `wizard-step-2.test.tsx` were failing. The cause was one test typing 950 characters, which took longer than the 5-second timeout and leaked keystrokes into later tests. I changed it to paste the text. This is still a real user action and it is instant. I did not raise the timeout.
- **Overrode:** 2 shipped theme-store tests expected `localStorage`, but the store used `sessionStorage`. The AI offered to change the tests to match the code. I changed the code to match the tests. The tests describe the intended behaviour, which is that theme preference survives a new tab. I logged this as a minor defect.

### 7. E2E
- **Accepted:** page objects, storage-state login in global setup, and selectors based on test IDs and roles.
- **Noted:** `global-setup.ts` was referenced by the Playwright config but did not exist, so the E2E runner was broken as shipped.
- **Limitation, stated plainly:** I confirmed the specs compile and list. They have not run against a live stack.

### Overall stance
I treated the AI as a fast pair who sometimes reports "done" too early. My rule was to accept nothing as passing until I had seen it run.
