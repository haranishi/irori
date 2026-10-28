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
