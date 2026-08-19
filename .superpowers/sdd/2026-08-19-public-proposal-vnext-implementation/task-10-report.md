# Task 10 Report: KPP-only canonical writer boundary

## Outcome

The canonical section-authoring writer now lives in
`packages/core/src/section-authoring.ts` and is exported by
`@longtable/kpp-core`. Public Proposal's `section-authoring.ts` exposes only
the pure `buildAgentPacket` and `mergeApprovedPatch` surface and associated
types/doctrine. It no longer imports `writeReceipt`, selects canonical KPP
content/receipt filenames, or mutates a KPP project.

The moved KPP writer retains the Task 4 lock, immutable ledger, integrity
anchor, finding/run binding, TOCTOU snapshot, reviewer independence, per-stage
run cap, rebuttal cap, automatic revision cap, representative gate, and
full-authoring gate. Its canonical receipts identify the writer as
`kpp-agent-execution/v1`.

## TDD evidence

| Scenario | Invocation | Binary observable | Artifact |
| --- | --- | --- | --- |
| Public Proposal canonical-writer boundary catches the old implementation | `npm test -- tests/integration/public-proposal-writer-boundary.test.ts` | exit 1; 1/1 failed on the existing `writeReceipt` import | `.omo/evidence/task-10/red-boundary.log` |
| KPP core positive path is missing before the move | `npm test -- packages/core/test/section-authoring-ownership.test.ts` | exit 1; `createSectionPlan is not a function` | `.omo/evidence/task-10/red-kpp-owned-path.log` |
| Canonical receipt authority still carries the old writer identity | `npm test -- apps/public-proposal-cli/test/section-authoring.test.ts -t 'includes the execution-ledger anchor'` | exit 1; expected `kpp-agent-execution/v1`, received `public-proposal-agent-execution/v1` | `.omo/evidence/task-10/red-kpp-receipt-authority.log` |

## Implementation

- Moved all canonical section plan, agent execution ledger, integrity receipt,
  representative review/approval, and full-authoring request writes to
  `packages/core/src/section-authoring.ts`.
- Exported the KPP-owned APIs and types from `packages/core/src/index.ts`.
- Reduced Public Proposal's production module to pure packet/patch re-exports.
- Updated section-authoring tests so every mutating call and the concurrent
  child-process mutation path target KPP core.
- Added a source-tree boundary regression covering every TypeScript file under
  `apps/public-proposal-cli/src` and a positive core-owned persistence test.
- Declared the moved module's direct `zod` dependency in the core package and
  lockfile; dry-run packing contains `dist/section-authoring.*`.
- Isolated the pre-existing worker-protocol test from the user's real
  `~/.config/public-proposal/installation.json`. The first full serial run
  correctly exposed this environment dependency; the production doctor was
  unchanged.

## Final verification

| Scenario | Invocation | Binary observable | Artifact |
| --- | --- | --- | --- |
| Affected section/core/KPP/release flow | `npm test -- tests/integration/public-proposal-writer-boundary.test.ts packages/core/test/section-authoring-ownership.test.ts apps/public-proposal-cli/test/section-authoring.test.ts apps/public-proposal-cli/test/agent-policy.test.ts apps/kpp-cli/test/authoring-bundle.test.ts apps/kpp-cli/test/release-flow.test.ts packages/core/test/state-machine.test.ts tests/integration/content-to-build.test.ts tests/plugin/korean-skill-bundle.test.ts packages/schemas/test/schemas.test.ts` | exit 0; 10 files, 70 tests passed | `.omo/evidence/task-10/affected-tests.log` |
| Installed-worker test isolation | `npm test -- apps/kpp-cli/test/cli.test.ts -t 'does not pass worker protocol when only the version environment value is set'` | exit 0; 1 passed, 14 skipped | `.omo/evidence/task-10/worker-test-isolation.log` |
| Full serial regression suite on final source | `npm test` | exit 0; 47 files, 435 tests passed | `.omo/evidence/task-10/final-full-serial-tests.log` |
| TypeScript contracts | `npm run typecheck` | exit 0 across root, research contracts, and Public Proposal | `.omo/evidence/task-10/final-typecheck.log` |
| All workspace builds | `npm run build` | exit 0 for all seven workspaces | `.omo/evidence/task-10/final-build.log` |
| Publishable core contents | `npm pack --workspace @longtable/kpp-core --dry-run` | exit 0; 82 files; section-authoring JS/declarations/source maps included | `.omo/evidence/task-10/core-pack.log` |
| Whitespace/error-marker check | `git diff --check` | exit 0; no findings | `.omo/evidence/task-10/diff-check.log` |

No npm publish, git push, merge, or external repository mutation was performed.
