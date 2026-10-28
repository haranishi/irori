# Main CodeQL triage — 2026-10-28

Snapshot: main `dd695795d2b5da982bbc91faa185be3fad18cff4`, [successful CI](https://github.com/haranishi/irori/actions/runs/40666875250). The first successful full-main JavaScript analysis reported nine alerts; Actions reported one. A green analysis job is not a zero-findings claim.

A separate read-only reviewer checked each source, execution boundary, and required attacker capability. Two real HTTP reproductions used only external synthetic sentinels in temporary directories. No production system or real private data was tested.

| Alert | Boundary and disposition |
| --- | --- |
| [19](https://github.com/haranishi/irori/security/code-scanning/19) missing-origin-check, console malicious test | Test-only attack-report collector, with no privileged product sink. Accepting reports from sandboxed/foreign origins is intentional. Classify as used in tests. |
| [18](https://github.com/haranishi/irori/security/code-scanning/18) missing-origin-check, bridge host fixture | Test observation records, separate from the real handshake and product message validation. Cross-origin reports are intentional. Classify as used in tests. |
| [17](https://github.com/haranishi/irori/security/code-scanning/17) missing-origin-check, flood game | Deliberately hostile fixture used to prove rate/shape rejection. Not a distributed game. Classify as used in tests. |
| [16](https://github.com/haranishi/irori/security/code-scanning/16) file-access-to-http, playtest | The URL is the child process startup result in a private temporary directory and is validated against an anchored loopback-only HTTP/port expression before fetch. No external file-data destination. False positive. |
| [15](https://github.com/haranishi/irori/security/code-scanning/15) file-system-race, mutation runner | A check/write gap exists, but the file is in a private temporary copy; mutation commands already execute trusted developer code. A concurrent process with the same local permissions is outside the stable-checkout contract. Record as won't fix with this residual limitation. |
| [14](https://github.com/haranishi/irori/security/code-scanning/14) file-system-race, thumbnail server | Existing linked files were served as 200 with CORS `*`, without a concurrent writer. Reachable boundary violation: fix serving and thumbnail manifest/output paths, with actual HTTP and external-sentinel regressions. |
| [13](https://github.com/haranishi/irori/security/code-scanning/13) file-system-race, registry checker | Existing source links are rejected by complete-source preflight and per-path checks. A later local mutation still races the read; OS isolation is required for such an attacker. Record as won't fix within the stable-checkout contract. |
| [12](https://github.com/haranishi/irori/security/code-scanning/12) file-system-race, playtest screenshot assertion | The test reads a completed screenshot made by its own child in a private temporary directory (mode 700 verified). A same-permission concurrent writer is outside the test contract. Record as won't fix. |
| [11](https://github.com/haranishi/irori/security/code-scanning/11) file-system-race, bridge static fixture | Existing links also exposed external synthetic content over real loopback HTTP with CORS `*`. Fix the configured-root boundary rather than dismissing merely because this is a test server. |
| [1](https://github.com/haranishi/irori/security/code-scanning/1) Actions untrusted-checkout | Deployment requires successful CI for a push to main in the same repository. PR/fork input cannot satisfy the job conditions. Credentials are step-scoped and current main SHA is rechecked before deployment. False positive. |

## Follow-up verification

The scoped local-server fixes and regression results are tracked in the follow-up PR and the validation record. Alerts 11 and 14 must not be dismissed until those actual boundaries are fixed and independently rechecked. A remaining check/read race under an actively mutating local filesystem is a documented limitation, not a claim of atomic filesystem isolation.

Classification does not disable any CodeQL query, source directory, job, or security assertion. Future alerts require individual reachability review. Intentional attack fixtures must remain capable of exercising the real product defenses.
