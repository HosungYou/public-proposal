# Task 7 Report: Independent Public Proposal and LongTable Plugins

## Outcome

One Public Proposal setup invocation now maintains two independent Codex
registrations. Public Proposal exposes only `public-proposal` and
`korean-public-proposal`; LongTable exposes only `longtable` and
`longtable-research`. KPP remains the sole proposal state/release authority and
LongTable remains the research/evidence authority.

The fresh LongTable worktree is
`/Users/hosung/dev/LongTable/.worktrees/codex-plugin-surface`, branch
`feat/codex-plugin-surface`, commit
`092cf454812a8982a2d86ee9ee7041d243191fab`. It contains the canonical plugin,
marketplace entry, two static skill surfaces, and a provider-generated `plugin`
surface with internal role routing.

## Implementation

- Public Proposal source and packaged marketplaces now carry complete local
  source metadata and display metadata; the plugin version matches
  `@longtable/public-proposal@0.1.3`.
- Installer-owned LongTable manifests use the canonical LongTable name,
  `0.1.72` version, marketplace policy, and interface metadata.
- Setup first asks LongTable for its canonical `plugin` skill surface. For the
  currently published CLI that does not recognize that surface, it falls back
  only on the explicit invalid-surface diagnostic, uses `compact`, creates the
  canonical research alias, and removes all non-canonical role skills.
- Legacy receipt migration now creates or reuses the independent LongTable
  registration instead of copying LongTable skills into Public Proposal. It
  snapshots/removes owned legacy role directories and compensates only
  current-invocation additions on failure.
- Doctor retains the compatibility aggregate check and adds independent checks
  for Public Proposal manifest/registration, LongTable manifest/registration,
  exact skill discovery, contract versions, and legacy conflicts. Runtime,
  KPP, LongTable, scholar-research, worker, and authority checks remain
  distinct.

## Verification

The final KPP invocation passed 5 files and 81 tests, followed by successful
typecheck, build, both Public Proposal plugin validators, and `git diff --check`.
The full LongTable `npm test` passed its build, smoke suite, new canonical
plugin smoke, and all workspace typechecks; its plugin validator and diff check
also passed.

Detailed RED/GREEN scenarios, exact invocations, binary observables, and
artifact paths are recorded at `.omo/evidence/task-7-vnext/verification.md`.

No push, publish, merge, release claim, or customer-state mutation was
performed.
