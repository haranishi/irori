# Design: CI and source-file security gates

## Boundaries and decisions

Contributed source files are untrusted. The build machine filesystem and deployment output must not be reachable through source links. An independent review reproduced external synthetic-file copying and overwriting in build-registry and sync-sdk on c23ae1a.

Use lstat-based filesystem checks in the existing tools layer. Reject links rather than resolving and accepting internal links: this keeps behavior portable and avoids link cycles, dangling links, and later retargeting. Reject non-regular files/directories. Validate complete source/destination sets before deleting old output or writing SDK copies. The checkout is assumed stable during a build; protecting against a concurrent local attacker requires OS isolation and is not promised.

Reuse the existing file inventory and check-all pipeline. Add a dependency-free file preflight before npm ci and before prepare:web builds. Do not read source contents or print link targets during preflight. Node_modules, Git metadata, caches, and generated artifacts retain existing exclusions; destinations are checked explicitly at write entry points.

Add CodeQL to ci with a job-scoped security-events permission. Analyze javascript-typescript and actions with security-extended queries, build-mode none, pinned action SHAs, read-only checkout, and no dependency install. Keeping analysis inside ci ensures the existing successful-ci CD condition includes it. Use pull_request (never pull_request_target), main push, schedule, and manual triggers already present.

## Verification and ownership

The implementation agent owns tools/lib/files.mjs, the new file checker, build-registry.mjs, sync-sdk.mjs, and their regression/mutation fixtures. The parent owns this spec, package scripts, CI, and docs. A separate read-only reviewer checks the integrated diff.

Regression fixtures contain only synthetic data. Test external and internal links, dangling links, cycles, directory links, individual SDK-file links, output-parent links, special files, and ordinary successful builds. Demonstrate that removing each safeguard makes its regression fail. Run existing tool/SDK tests and built-asset checks. The older main failures are evidence to verify, not a reason to lower assertions or disable mutations.

Split mutations with `--shard index/count` (1-based, count 4 in CI), filtering by stable index after any `--only` prefix filter. Reject malformed/out-of-range selections and empty matches. Keep baseline validation and failure semantics unchanged. This addresses the old 115-minute main job approaching its 150-minute limit as the suite grows from 168 to 278 cases. Test partition disjointness/completeness and existing CLI compatibility.

An independent audit reproduced sparse pad arrays being accepted by MessagePort validation, serialized to null entries, and causing room-side host disconnection. Inspect every array index for tiles and labeled lists; do not change the wire format or limits. Test direct values, structured clones, bridge/SDK validator agreement, and valid dense values. Update only existing happy-dom/wrangler/fast-uri dependencies to patched compatible versions; keep Node 24 and TypeScript 6.

The first successful main CodeQL scan reported ten alerts. Independent triage reproduced an existing symlink exposing an external synthetic file through the thumbnail server, without a concurrent writer. Reuse assertSafePath/assertSafeTree at local serving and thumbnail write boundaries. Check complete input/output sets before writes and validate request paths before reads; reject malformed URL encoding without crashing. Do not introduce a new server abstraction or weaken CSP/CORS. Test actual loopback HTTP and synthetic external sentinels. The file-safety agent owns make-thumbs and its new tests; the bridge implementation agent owns the test static server and its new tests. The parent owns specs/integration and the separate reviewer verifies the final diff and alert classifications.

CONTRIBUTING.md requires permanent mutation definitions for added safeguards. Persist the verified bridge two and thumbnail four cases under tools/mutations/specs; this expands the full suite from 288 to 294 cases, partitioned 74/74/73/73. Keep the same four shards and failure semantics.
