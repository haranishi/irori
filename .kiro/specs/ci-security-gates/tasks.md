# Tasks: CI and source-file security gates

- [x] 1. Diagnose current PR/main CI, review existing specs, and reproduce source-link boundary violations with synthetic fixtures. Requirements: 1, 4.
- [x] 2. Implement source/destination file guards and targeted regression/mutation cases. Owner: file-safety implementation agent. Depends: 1. Requirements: 1, 2.
- [x] 2.1. Reject sparse game pad arrays with regression and mutation coverage. Owner: protocol implementation agent. Depends: 1. Requirement: 6.
- [x] 3. Wire dependency-free preflight and pinned CodeQL into CI/build checks; document scope and limitations. Owner: parent. Depends: 1. Requirements: 2, 3.
- [x] 3.1. Add validated mutation sharding and runner regression tests. Owner: mutation implementation agent. Depends: 1. Requirement: 4.
- [x] 3.2. Patch existing vulnerable development dependencies and audit the full lockfile. Owner: parent. Depends: 1. Requirement: 7.
- [x] 4. Run normal checks/build, targeted browser and mutation regressions, and independent read-only review; fix concrete findings within three cycles. Depends: 2, 3. Requirements: 1–5.
5. Integration gate (live PR/Actions record): Submit the security/CI follow-up against the party-pack branch, merge it after successful checks, then verify and merge the updated party-pack PR and verify main CI/CD status. Depends: 4. Requirements: 4, 5.

Evidence: `.agent-harness/runs/2026-10-28-ci-security/validation.md` (filled after execution).

Implementation and local verification are complete. Release completion is evaluated from the live follow-up PR, PR9, and main Actions results; the validation record distinguishes that external gate from local test results.

PR10 Linux CI found an existing midgame test race (WebKit: 180 passed, 1 failed): the test opens pause before the prior phone hop arrives. The next scoped fix must reproduce that race with delayed input, wait for observed delivery, retain result assertions, and rerun both browser engines before integration.

The follow-up reproduced the old midgame assertion failure with 500ms delayed WebKit input; delivery barriers fixed it without changing expected scores. Chromium/WebKit × 0/500ms passed 4/4, nearby midgame regression passed 12/12, and the independent read-only diff review passed.

The second Linux run passed all 183 console and 50 host browser cases, but two pad cases exposed a shared TestHost race: addNodePad returned after pad welcome before host joined. Final CI cycle repairs that fixture contract and verifies both event orders and reused-seat history before rerunning the full pad suite.

The shared fixture fix failed 3/4 controlled-order regressions before the change and passed 4/4 afterward. Both removing the joined barrier and removing the old-event boundary were detected. Full web unit suite passed 217 tests; actual Worker/pad browser suite passed 78 with 71 existing conditional skips. Independent read-only review passed.

The party pack and CI/security fixes merged through PR10/9/11. Main dd695795 passed all 12 CI jobs: 1,908 unit/tool/game tests, 313 browser cases (71 existing conditional skips), zero audited dependency vulnerabilities, and 288/288 mutation cases detected without outer timeouts. CodeQL completed with ten alerts requiring reachability triage rather than a zero-findings claim.

- [x] 6. Extend existing file guards to thumbnail serving/writes and the bridge test server; reproduce unsafe existing links over actual HTTP and verify safe requests, malformed URLs, special files, and external sentinel retention. Requirement: 8.
- [x] 7. Independently review the scoped fix and classify all ten main alerts with actual prerequisites; fix reachable violations and record accepted test-only/concurrent-writer limitations. Requirements: 5, 8.
8. Follow-up release gate (live PR/Actions): merge the reviewed local-server fix only after applicable PR CI; verify the resulting main CI, mutation shards, and CodeQL status.

Local-server follow-up independently reviewed PASS after persisting all six guard mutations. Full local suite 1,945 passed; typecheck, checks, build/Worker dry-run, budgets, and redacted secret scan passed. Permanent mutations killed 6/6 (exit 1, no timeout); all 294 definitions match exactly once and partition completely. Final main integration is evaluated from task 8 and the live PR/Actions record.
