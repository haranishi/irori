# Pad re-entry mutation baseline follow-up — 2026-10-28

## Trigger and contract

PR12 passed all applicable PR checks and merged as `a1afb8311a70d006feee80e06a94dc5145baec44`. [Main CI](https://github.com/haranishi/irori/actions/runs/40679538047) passed unit/build, audit and CodeQL (no open alerts after documented triage), but mutation shard 1 reported 72/74 KILLED and two ERRORs because its unchanged baseline was already red.

The shared baseline runs phone-chromium join/menu/states/reconnect/controllers. The failure was join.e2e.ts:98, the no-room code re-entry test: pressSequentially waited for the fourth code box after it disappeared, reaching the original 60-second timeout. Forty-six other cases passed. The two unassessable mutants were padpage-f-replaced-auto-reconnect-e2e and padpage-g-no-probe-on-return-e2e; none survived a green baseline.

The existing pad contract automatically looks up any completed four-character code and shows a re-entry form for a missing room. The test begins with a full code prefill. If the replacement shares a suffix, a partial edit can complete the valid room code before all four loop iterations finish, and the product correctly replaces the input screen.

## Scoped repair and verification gate

Use actual Worker lookups to choose a missing test code sharing the real host suffix. Reproduce the old failure deterministically, then clear all four boxes before typing the replacement. Keep automatic product lookup and strict error/entry/join expectations. Exercise lookup delay 0/500ms and CPU throttling. Do not change product code, mutation definitions, retries, timeouts or skip conditions.

A separate implementation agent owns only apps/web/tests/pad/join.e2e.ts. The parent owns this record/spec/Git integration; an independent read-only reviewer checks the focused change. Required evidence: controlled old failure, corrected browser cases, full affected five-file baseline, both genuine mutant failures after green baselines, applicable PR CI and all final main jobs/294 mutations. No production system or real player data is used.

## Separate clock race from the same main run

The console suite completed with 184 passes and one playtest failure: POST/start returned 500 because clock.pauseAt targeted the past. The tool samples browser Date.now and asks the next RPC to stop at now+1; normal latency can exceed that millisecond. The same method serves POST/clock/pause, so a startup-only workaround is insufficient.

Installed Playwright is 1.64.1. Its [official Clock API](https://playwright.dev/docs/api/class-clock) says setFixedTime fixes Date values while timers run, pauseAt stops timer progression at a target, and setSystemTime sets wall time without firing timers. Installed source confirms the past-target check. The candidate public-API sequence must be behaviorally verified with real Chromium and induced RPC latency; no arbitrary timing cushion, retry, timeout or assertion relaxation is accepted.

## Re-entry results

With actual Worker-selected shared-suffix data, both old 0/500ms cases fail immediately when the first edited character replaces the entry screen. The corrected test clears all four boxes before typing, checks error removal and entry continuity, then requires the join screen. Delay 500ms also uses CPU throttling rate 10 with restoration/detach in finally. Both cases and the exact affected five-file baseline passed 48/48; typecheck passed. The existing two mutation definitions were unchanged, passed their ordinary baseline, and each KILLED with exit 1 without timeout. Independent read-only design and final diff review passed.

The first main run finished with three other mutation shards successful: 74/74, 73/73 and 73/73. Shard 1 was 72/74 with two baseline ERRORs, not surviving mutants. The console browser suite had 184 passes and the separate clock-startup failure, preventing later host/pad stages in that job. A corrected follow-up PR and full final main CI remain required.

## Clock independent-review correction

The initial fixed-Date candidate passed the ordinary HTTP/clock checks, but a separate review added a 25ms Date observer with 500ms RPC latency and found Date rewinding by 480ms. Performance and timer deadlines were retained; that did not establish Date monotonicity. The candidate was rejected before commit. The implementation must now pass that negative regression, retain pending timers, and cover later frames and repeated pause/resume. No permission or product-contract change is used to accept a backward clock.

The replacement design avoids fixed-Date writes. It stops with a sampled host target, handles only the exact past-target outcome whose installed implementation already stopped timers, then records the stopped host time for later documents. Its correctness depends on verified Playwright 1.64.1 post-error semantics and real regressions; this is not presented as a public API guarantee. Neither arbitrary timing cushions nor game-frame values may choose the host target. Intermediate and later frames, per-frame monotonicity, strict exception propagation, and the actual HTTP flow remain verification gates.

## Final local result

The host-only two-phase pause passed actual HTTP and Chromium/iframe cases 5/5: 0/50/500ms latency, 25ms observers, existing/intermediate/future frames, stopped Date/performance, retained timer deadlines, repeated pause, runFor/resume, and unrelated exception propagation. The first fixed-Date candidate fails the same observer regression; the final candidate passes independently. Three permanent clock mutations all KILLED with exit 1 and no timeout. Re-entry's two existing mutants also KILLED after a green baseline.

The independent reviewer returned final PASS. Full local suite passed 1,945 (149 tools, no skipped cases with the verified font); typecheck, repository checks, final build/Worker dry-run and budgets passed. Static collection confirms console 189 cases and pad 150 including the same 71 conditional screenshot skips (79 applicable). The mutation suite is 297 unique cases, partitioned 75/74/74/74; every replacement matches once. Final PR/main CI is a separate live integration gate.
