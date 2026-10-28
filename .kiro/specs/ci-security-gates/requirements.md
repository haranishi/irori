# Requirements: CI and source-file security gates

The maintainer requested CI repair, PR creation/merging, and defenses against unsafe contributions on 2026-10-28. Reuse the approved party-game-pack behavior and existing security contract.

1. Source enumeration, bundled-game copying, and SDK synchronization must reject symbolic links and special files without reading or writing their targets. Check source trees, destination ancestors, and destination files before destructive operations. Ordinary sources and generated builds must keep working.
2. CI must check source-file safety before installing dependencies. Normal repository checks and build entry points must enforce the same policy. Dependencies, Git metadata, and generated artifacts are outside the source inventory; explicitly validate generated destinations used by the build.
3. PRs, main pushes, and scheduled runs must analyze JavaScript/TypeScript and Actions with pinned CodeQL tooling and minimal permissions, without exposing deployment credentials or executing PR code with elevated repository privileges.
4. Preserve the full browser and mutation assertions. Partition the full mutation suite deterministically across four main CI jobs, covering every case exactly once and rejecting invalid/empty shard selections. Verify the previously failing playtest and header-navigation mutation on the party-pack head. Run the relevant security regressions and the complete main CI after merge.
5. Record actual test/CI results and limitations. Merge only reviewed changes with successful applicable checks; preserve concurrent work and existing CI/CD authorization boundaries.

6. Reject sparse arrays in game-to-host pad specifications before forwarding to the room service. Preserve valid dense arrays and protocol limits.
7. Update vulnerable existing development dependencies to compatible fixed releases and audit development as well as production dependencies in CI. No new package or major version migration.

Out of scope: new games, new npm dependencies, production attacks, credential rotation, repository-wide permission changes, and claims that static scanning proves all code benign.
