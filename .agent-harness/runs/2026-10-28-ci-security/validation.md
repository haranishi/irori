# CI and security validation — 2026-10-28

## Scope and snapshots

Maintainer request: repair failing CI, add security defenses, create PRs and merge after verification. Initial main: `58f4f12ef57b7feddd9b7dd856afc90bb2db70e3`; party-pack PR9: `c23ae1a1439b35ca5fe3ec457ed8f212b5a294a3`.

PR9 already had a successful [latest PR run](https://github.com/haranishi/irori/actions/runs/40618563416). Older [main CI](https://github.com/haranishi/irori/actions/runs/40417906729) failed the playtest navigation and header-navigation mutation. Its assertions are preserved, with the party-pack fixes reverified below.

## Changes and review

- Reject linked/special source files and destination ancestors before SDK synchronization or registry copying. Validate every destination before modifying any output.
- Inspect generated output metadata before excluding its contents. Independent review reproduced the initial missing `dist` check with real Vite; cycle 2 fixed it and preserved synthetic external sentinels. Git metadata and dependency links remain explicit exclusions.
- Reject sparse arrays in game-to-host pad specifications before JSON conversion; regenerate all 11 distributed SDK copies. Dense pad arrays and protocol limits remain unchanged.
- Run dependency-free preflight before CI/CD installation and build; disable install scripts; audit development dependencies as well as production.
- Patch happy-dom to 21.0.4, Wrangler to 4.154.0 (undici 7.30.1), and fast-uri to 3.1.9. No new direct dependency or major Node/TypeScript migration.
- Add commit-pinned CodeQL for JavaScript/TypeScript and Actions with job-scoped security-events write permission. Analysis runs inside ci, so existing successful-ci deployment gating includes it.
- Partition all mutations into four stable shards without dropping cases. Invalid or empty selections fail.

Separate agents implemented file guards, array checks, and sharding. A fresh read-only reviewer found the output-directory gap, then independently repeated both blocked Vite reproductions and ordinary successful builds: final PASS. No production attack or real-secret fixture was used.

## Local verification

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts` | Successful with the updated lockfile |
| `npm run typecheck` | All packages and games passed |
| `npm test` | 1,904 passed; 72 real-Worker edge tests, 112 tool tests, 763 game tests, 957 other package tests; no failures/skips |
| `npm run check` | File boundaries, docs, rights, dependency direction/licenses, 11 registry entries, and SDK synchronization passed |
| `npm run deploy:dry-run` | Final build and Worker dry-run succeeded; no deployment performed |
| `npm run budgets` | Passed; SDK raw 70,565 bytes, below both budget checks |
| `npm audit` | 0 vulnerabilities, including development dependencies (initially 5) |
| actionlint 1.7.12 | CI/CD workflow syntax passed; official binary checksum verified |
| New security mutations | 10/10 KILLED, exit 1 rather than timeout; file guards 8, sparse arrays 2 |
| Mutation selection | 288 cases, 72 per shard, no duplicate/missing case; all mutation find strings matched exactly once |
| Shard runner regressions | 13 passed; removing partition/empty-selection checks caused failures |
| Previously failing header mutation | Correct baseline passed; mutation KILLED (exit 1, no timeout) |
| Previously failing playtest | 1 passed with Chromium, actual host/phones/Worker |
| Secret scan | Staged diff checked with Gitleaks redaction before submission |

File-guard tests demonstrated failure before the fix, including source links, individual SDK-file links, output ancestors, generated output trees, cycles/dangling links and FIFOs. The array regressions failed before the fix and pass for direct and structured-cloned values, with valid dense arrays retained. The independent reviewer tested the actual Vite boundary, not just helper behavior.

## GitHub and integration

[Security follow-up PR10](https://github.com/haranishi/irori/pull/10) targets the party branch. Its [first Linux run](https://github.com/haranishi/irori/actions/runs/40629510837) passed seven jobs; both CodeQL analyses reported zero findings/warnings. Browser console tests had 180 passes and one WebKit failure: a phone hop was sent immediately before opening the pause menu, so the in-flight input could be dropped before the test kicked that seat. The follow-up reproduced the failure with 500ms delayed WebKit input, then added delivery synchronization without changing expected scores, timeouts, skips or product behavior. Chromium/WebKit × 0/500ms passed 4/4 and nearby midgame regressions passed 12/12; independent diff review passed. The [second Linux run](https://github.com/haranishi/irori/actions/runs/40645861733) passed all 183 console cases and 50 host cases; pad cases had 76 passes, 2 failures and 71 existing conditional skips. Both failures expose a shared fixture race: Node pad welcome arrives before the host joined event, so a subsequent test can inspect an incomplete player list. The final CI cycle repairs that fixture contract: controlled arrival-order tests failed 3/4 before the fix and passed 4/4 afterward, including old seat history and concurrent joins. Removing either guard was detected. Web unit tests passed 217/217; the actual Worker/pad browser suite passed 78 with 71 existing conditional skips; independent read-only review passed. Pending: corrected PR checks, merge into the party branch, updated PR9 checks/merge, and full main CI including all four mutation shards. Full browser verification is delegated to GitHub CI on the submitted commit; it is not claimed complete locally.

## Limits

Static analysis and file checks cannot prove that arbitrary regular source code is benign. Review of future diffs is still required. The filesystem checks assume a stable checkout; an attacker concurrently changing local files requires OS isolation. Physical phones/TV, human group play, external expert audit, and production behavior were not verified in this task. Automatic deployment is currently disabled (`CD_ENABLED` absent); this work does not enable it or change deployment credentials.

## Main follow-up

PR10 merged as `4086ba5`, then the updated PR9 passed all applicable checks and merged as `ea9ff65`. The [first main run](https://github.com/haranishi/irori/actions/runs/40658138075) passed unit/build, audit, CodeQL and one mutation shard, while the console suite had 182 passes and a daifugo readiness race: the test read an earlier wait spec before tiles reached the phone. A focused follow-up PR waits for all phone hands before recording or inspecting them; product behavior and assertions remain unchanged. Delaying host-to-Worker tiles by 500ms reproduced the exact TypeError before the fix. After the fix, Chromium/WebKit × 0/500ms passed 4/4, and 12 related daifugo/privacy/minimum-player/departure/old-host/axe cases passed (16 total). Independent read-only review passed. Final main status is tracked by the follow-up PR and its main CI.

## Full-main verification and CodeQL follow-up

PR11 merged as `dd695795`. Its [full main CI](https://github.com/haranishi/irori/actions/runs/40666875250) passed all 12 jobs: 1,908 unit/tool/game tests, 185 console + 50 host + 78 pad browser cases (71 unchanged conditional pad skips), zero audited vulnerabilities, and all four mutation shards at 72/72 KILLED each (288/288, no outer timeout). Both CodeQL analyses completed; the first successful main-wide scan reported ten findings, individually reviewed in [the triage record](codeql-triage.md). Eight alerts were classified with specific reasons on GitHub; two real existing-link HTTP disclosures require this additional scoped local-server fix. The new release gate is its PR plus final main CI, not a zero raw-findings claim.

## Local-server fix verification

The bridge and thumbnail HTTP servers now reject existing links, special files, malformed URL encoding and path traversal while retaining ordinary assets and required CSP/CORS. Thumbnail generation validates every selected game/manifest/output before fonts, directories or browser work. Original external-sentinel leaks were reproduced before the fix, without racing the filesystem.

- Real HTTP bridge regression: 9/9; existing real-browser bridge tests: 10/10.
- Thumbnail regressions: 28/28 with verified OFL font and actual Chromium; output decoded as JPEG, 640×480. CI without that local font executes 27 cases and skips only the additional optional normal-image generation case. No existing skip or assertion changed.
- Temporary-copy guard removal: bridge 2/2 and thumbnail 4/4 detected, exit 1 rather than timeout.
- Full local suite: 1,945 passed (149 tools included), zero skipped with the verified font. Repository checks passed. Final typecheck/build/Worker dry-run/budgets passed. Independent code/HTTP/output review passed, including a second real Chromium JPEG generation. The reviewer required persisting the six verified guards as mutation definitions under CONTRIBUTING.md; all six permanent cases then KILLED with exit 1 and no timeout (thumbnail baseline also passed without a local font). The suite is now 294 cases, partitioned 74/74/73/73. The final PR records integration status.

## PR12 Linux fixture follow-up

The [first PR12 run](https://github.com/haranishi/irori/actions/runs/40674296295) passed typecheck, CodeQL jobs, dependency audit, secrets and REUSE, but three new thumbnail HTTP cases failed with ECONNRESET before their assertions. The test helper shared Node's keep-alive globalAgent while closing/reopening the same fixture port. Reuse was observed in 30/60 requests; agent:false observed 0/60. The reset itself was not reproduced locally (0/100 failures), so the Linux log remains the actual red evidence.

The helper now gives each request an independent connection. No retry, timeout, assertion, security source or skip condition changed. Afterward: 27 thumbnail cases passed without a font plus the same optional image skip; with the verified font and actual Chromium all 28 passed; all 149 tools passed; four permanent thumbnail mutations KILLED with exit 1 and no timeout. Independent review passed. Three new CodeQL alerts were separately reviewed as custom-guard/constant-test-code false positives in the triage record. Corrected Linux CI remains the release gate.

PR12 passed applicable PR CI and merged as `a1afb831`. Main mutation shard 1 then rejected two cases because an unchanged browser baseline failed during room-code re-entry (72/74 killed, two ERRORs). This is tracked in the [focused follow-up record](pad-reentry.md); final main completion remains pending.

The focused follow-up now passes independent review, 48 affected pad baseline cases, five real HTTP/clock cases, and all five targeted mutants. Full local suite passed 1,945 plus typecheck/checks/build/Worker dry-run/budgets. The final suite contains 297 mutations and 318 applicable browser cases; see the focused record for the monotonic-clock correction and explicit Playwright version dependence. Final PR/main CI remains the live gate.
