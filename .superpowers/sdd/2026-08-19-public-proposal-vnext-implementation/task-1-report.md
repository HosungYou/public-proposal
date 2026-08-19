# Task 1 implementation report — shared Proposal Research Contract

## Result

Implemented and committed the pure `@longtable/proposal-research-contracts`
workspace package. The package has only the pinned runtime dependency `zod`
`4.4.3`; it does not import KPP packages or perform filesystem, subprocess, or
network operations at runtime.

## Changed files

- `package.json`
  - Added the contract package to root build, pack, and typecheck order.
- `package-lock.json`
  - Registered the workspace link and exact `zod@4.4.3` dependency pin.
- `packages/proposal-research-contracts/package.json`
- `packages/proposal-research-contracts/README.md`
- `packages/proposal-research-contracts/tsconfig.json`
- `packages/proposal-research-contracts/src/index.ts`
- `packages/proposal-research-contracts/src/schemas.ts`
- `packages/proposal-research-contracts/test/contracts.test.ts`

## Design decisions

- Used strict Zod objects for the versioned request, bundle, source, dataset,
  transformation, claim, figure, and gap contracts, with cross-reference
  validation for dataset/source/claim/figure identifiers.
- Kept proposal classes aligned with the research bridge v1 contract:
  `academic_research`, `research_service`, `policy_research`, and
  `general_procurement`.
- Preserved the existing receipt convention of a lowercase, bare 64-character
  SHA-256 value for source/file hashes.
- `parseCanonicalJson` recursively sorts plain-object keys, preserves array
  order, rejects unsupported/non-finite values, and emits JSON without a
  trailing newline. `sha256Canonical` hashes that UTF-8 representation and
  returns lowercase hexadecimal.
- Figure `dataIds` are checked against bundle dataset IDs, so an untraceable
  plotted data reference is rejected at bundle validation time.

## TDD evidence

The required red test was run before implementation:

```text
npm test -- packages/proposal-research-contracts/test/contracts.test.ts
```

Result: exit 1; Vitest reported `Cannot find module '../src/index.js'` and
`0 test` because the package source did not yet exist.

The focused green test was then run:

```text
npm test -- packages/proposal-research-contracts/test/contracts.test.ts
```

Result: exit 0; `Test Files 1 passed (1)`, `Tests 3 passed (3)`.

## Verification evidence

Exact final verification command:

```text
npm test -- packages/proposal-research-contracts/test/contracts.test.ts && npm run typecheck && npm run build --workspace @longtable/proposal-research-contracts && npm pack --workspace @longtable/proposal-research-contracts --dry-run
```

Result: exit 0.

- Focused tests: `1` file and `3` tests passed.
- Root typecheck: `tsc --noEmit -p tsconfig.base.json`, contract package
  typecheck, and existing public-proposal typecheck all exited 0.
- Contract build: `tsc -p tsconfig.json` exited 0 and emitted declarations.
- Pack dry run: `@longtable/proposal-research-contracts@0.1.0`, `10` files,
  containing README/package metadata and the `dist` output only; no source,
  test, or unrelated workspace files were included.

## Concerns / residual scope

- The full repository Vitest suite was not run; the brief calls for the focused
  contract test and build/typecheck/pack gates, all of which passed.
- The pre-existing untracked
  `docs/superpowers/plans/2026-08-18-public-proposal-meta-installer.md` was
  intentionally left untouched.
- LongTable adapter/runtime work remains explicitly out of scope for Task 1.

## Commits

- `a330bec497977460af0a5e6597b0215f792f7ebb`
  (`feat: add proposal research contract package`)

## Review fixes (2026-08-19)

### Changes

- Added `document_restyle` to `ResearchProposalClassSchema` so the research
  request remains compatible with the existing proposal-class convention in
  `packages/schemas/src/project.ts`.
- Added bundle-level provenance checks for claim `sourceIds` and `dataIds`,
  figure `sourceCaption.sourceIds`, and transformation `inputDatasetIds`.
  Each dangling identifier now emits a targeted Zod issue at its array path.
- Added one acceptance test for `document_restyle`, four dangling-reference
  rejection tests, and a valid bundle fixture proving the references accepted
  by the tests remain valid.

### TDD and verification evidence

The review regression tests were run before the fix:

```text
npm test -- packages/proposal-research-contracts/test/contracts.test.ts
```

Result: exit 1; Vitest reported `8 tests | 5 failed`, with the compatibility
test returning `false` instead of `true` and each of the four dangling-reference
tests returning `true` instead of `false`.

After the schema changes, the focused test was run:

```text
npm test -- packages/proposal-research-contracts/test/contracts.test.ts
```

Result: exit 0; `Test Files 1 passed (1)`, `Tests 8 passed (8)`.

Exact final fix verification command:

```text
npm test -- packages/proposal-research-contracts/test/contracts.test.ts && npm run typecheck && npm run build --workspace @longtable/proposal-research-contracts && npm pack --workspace @longtable/proposal-research-contracts --dry-run
```

Result: exit 0.

- Focused tests: `1` file and `8` tests passed.
- Root typecheck: base TypeScript check, contract package typecheck, and
  existing public-proposal typecheck all exited 0.
- Contract build: `tsc -p tsconfig.json` exited 0.
- Pack dry run: `@longtable/proposal-research-contracts@0.1.0`, `10` files,
  README/package metadata plus `dist` output only; package size `9.6 kB`,
  unpacked size `49.5 kB`.

### Fix commit

- `fe427eb50f2b08ba9d19dc6da0976627582a3d11`
  (`fix: close proposal research provenance references`)

The pre-existing untracked
`docs/superpowers/plans/2026-08-18-public-proposal-meta-installer.md` remains
untouched. The full repository test suite remains outside this focused review
fix verification.
