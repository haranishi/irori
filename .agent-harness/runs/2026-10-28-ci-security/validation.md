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

Pending: security follow-up PR against the party branch, successful applicable checks, merge into the party branch, updated PR9 checks and merge, then full main CI including all four mutation shards. Full browser verification is delegated to GitHub CI on the submitted commit; it is not claimed complete locally.

## Limits

Static analysis and file checks cannot prove that arbitrary regular source code is benign. Review of future diffs is still required. The filesystem checks assume a stable checkout; an attacker concurrently changing local files requires OS isolation. Physical phones/TV, human group play, external expert audit, and production behavior were not verified in this task. Automatic deployment is currently disabled (`CD_ENABLED` absent); this work does not enable it or change deployment credentials.
