# Task 6 Report: Lossless Adoption and Migration

## Outcome

Implemented project adoption through the public `adoptProject(input)` API and
`kpp adopt <root> --source <path> --master <path> --json`. Adoption discovers
and imports legacy proposal inputs without manufacturing approval: the resulting
state is `UNMANAGED_DRAFT`, source-less content is provisional, readable
LongTable runs are linked rather than copied, and no content, human, or release
approval receipt is created.

Installer setup/update now snapshots the prior receipt, registration state, and
owned-file hashes; records Public Proposal and LongTable ownership separately;
reuses externally owned LongTable registrations; installs only missing
registrations; validates LongTable doctor; removes only Public Proposal-owned
legacy role copies; atomically replaces the receipt; and compensates only
current-invocation additions. Uninstall retains source-bound deregistration and
rollback behavior and preserves externally owned LongTable state.

## TDD evidence

- Adoption RED: importing the not-yet-created API and invoking the missing CLI
  failed. Artifact: `.omo/evidence/task-6/red-adoption.log`.
- Installer RED: external ownership/rollback and migration snapshot assertions
  failed before implementation. Artifact:
  `.omo/evidence/task-6/red-installer.log`.
- Required focused command:
  `npm test -- packages/core/test/adoption.test.ts tests/integration/adopt.test.ts apps/public-proposal-cli/test/setup.test.ts apps/public-proposal-cli/test/uninstall-update.test.ts apps/public-proposal-cli/test/doctor.test.ts`.
  Binary observable: exit 0, 5 test files passed, 66 tests passed. Artifact:
  `.omo/evidence/task-6/focused-tests.log`.

## Contract scenarios and artifacts

| Success criterion | Scenario and invocation | Binary observable | Captured artifact |
| --- | --- | --- | --- |
| Lossless adoption without inferred approval | Built the CLI, invoked `node apps/kpp-cli/dist/main.js adopt <fixture-root> --source <source-packet> --master <working-master> --json`, then inspected the generated project and receipt | exit 0; state `UNMANAGED_DRAFT`; one provisional record; one LongTable link; zero approval artifacts | `.omo/evidence/task-6/runtime-adopt.json`, `.omo/evidence/task-6/runtime-observable.json` |
| Idempotent unchanged adoption | Repeated the same CLI invocation against the same input bytes | exit 0; same adoption ID; `changed: false`; import count remained 3 | `.omo/evidence/task-6/runtime-adopt-retry.json`, `.omo/evidence/task-6/runtime-idempotence.json` |
| Changed-input fail closed | Changed the working-master bytes and repeated adoption | exit 1; `KPP_ADOPTION_INPUT_CHANGED`; one changed binding; original receipt retained | `.omo/evidence/task-6/runtime-changed-input.json`, `.omo/evidence/task-6/runtime-changed-observable.json` |
| External LongTable/customer-state preservation | Ran the focused setup/update test scenario `preserves external LongTable registration and customer files during update` | pass; external marker/customer bytes unchanged and registration recorded `externally_owned` | `.omo/evidence/task-6/installer-scenarios.log` |
| Partial migration compensation and retry | Ran the focused setup test scenario `rolls back only current migration additions and retries without duplicate registration` | pass; first invocation compensated its additions; retry produced one registration | `.omo/evidence/task-6/installer-scenarios.log` |
| Receipt migration snapshot and owned hashes | Ran the focused setup scenario `migrates a current receipt with a registration and hash snapshot` | pass; prior receipt, registration snapshot, and owned-file hashes recorded | `.omo/evidence/task-6/installer-scenarios.log` |
| Uninstall ownership boundary | Ran `apps/public-proposal-cli/test/uninstall-update.test.ts` in the required focused suite | pass; external LongTable registration preserved; installer-owned registration removed only when source-verified | `.omo/evidence/task-6/focused-tests.log` |

## Verification

- `npm run typecheck`: exit 0. Artifact: `.omo/evidence/task-6/typecheck.log`.
- `npm run build`: exit 0. Artifact: `.omo/evidence/task-6/build.log`.
- `git diff --check`: exit 0, empty output. Artifact:
  `.omo/evidence/task-6/diff-check.log`.
- `npm test -- tests/plugin/install-docs.test.ts`: exit 0, 5 tests passed.
  Artifact: `.omo/evidence/task-6/docs-tests.log`.

## Residuals and boundaries

- The optional full-suite run captured 391 passing tests and six failures before
  the documentation wording correction. The documentation suite now passes
  independently. Four remaining release-flow failures require a valid managed
  worker receipt in the test environment and report `Managed worker receipt
  cannot be parsed`; they are outside Task 6 adoption/migration behavior.
- The clean-install release fixture still assumes LongTable skills are colocated
  inside the Public Proposal marketplace. Task 6 intentionally separates
  external/installer LongTable ownership, and the release verifier is explicitly
  outside Task 6 ownership, so it was left unchanged. The ownership contract is
  covered by the focused setup, doctor, update, and uninstall tests.
- The pre-existing untracked installer plan, the external LongTable checkout,
  customer `.longtable` data, KPP project state, and approval receipts were not
  modified. No push, publish, or merge was performed.

## Fix round 1 — 2026-08-19

Resolved all three HIGH re-review findings. A selected working master remains a
`working_master` import, but is also recorded in `provisional-content.json`
when no RFP/source packet establishes a source relationship. Adoption now
builds its complete project and receipt in an invocation-owned sibling, then
publishes by rename; an in-place adoption first stages a complete copy and uses
an invocation-owned backup for rollback. Current-manifest migration now moves
each complete owned legacy role directory to an invocation snapshot and
restores that tree by rename if manifest publication fails.

The clean-install fixture now models Public Proposal and LongTable as separate
Codex marketplaces/plugins and reads LongTable skills from the independently
receipted LongTable source. No release-gate threshold, managed-worker behavior,
release-verifier gate logic, publication behavior, or source-bound ownership
check changed. The E2E asserts successful setup/public doctor and the exact
installer-owned LongTable registration source; it does not reinterpret the
pre-existing KPP managed-worker warning as a Task 6 success.

### Fix-round evidence

| Success criterion | Exact scenario and invocation | Binary observable | Captured artifact |
| --- | --- | --- | --- |
| Source-less master remains bound and provisional | `npm test -- packages/core/test/adoption.test.ts apps/public-proposal-cli/test/setup.test.ts`, scenario `keeps a source-less working master bound and marks its content provisional` | exit 0; `working_master` import present; provisional entry has `no_source_binding` | `.omo/evidence/task-6-fix1/green-regressions.log` |
| Adoption failure is atomic and unchanged inputs are retry-safe | Same invocation, scenario `publishes adoption atomically so a mid-import failure can be retried`; the second staged copy throws once, published `kpp.project.yaml` remains absent, then identical input bytes succeed | exit 0; failure assertion passes; retry writes matching adoption receipt | `.omo/evidence/task-6-fix1/green-regressions.log` |
| Complete legacy role tree is restored after later failure | Same invocation, scenario `restores the complete legacy role directory when manifest publication fails`; manifest rename fails after role snapshot | exit 0; `SKILL.md` and nested `references/nested.md` retain exact bytes; no migration snapshot remains | `.omo/evidence/task-6-fix1/green-regressions.log` |
| Focused adoption/setup/uninstall/doctor regression | `npm test -- packages/core/test/adoption.test.ts tests/integration/adopt.test.ts apps/public-proposal-cli/test/setup.test.ts apps/public-proposal-cli/test/uninstall-update.test.ts apps/public-proposal-cli/test/doctor.test.ts` | exit 0; 5 files and 69 tests passed | `.omo/evidence/task-6-fix1/focused-tests.log` |
| Separated LongTable clean install | `npm test -- tests/e2e/public-proposal-install.test.ts` | exit 0; 1 file and 10 tests passed; setup/public doctor report independent receipted sources | `.omo/evidence/task-6-fix1/clean-install-e2e.log` |
| Type safety | `npm run typecheck` | exit 0 | `.omo/evidence/task-6-fix1/typecheck.log` |
| Build | `npm run build` | exit 0 | `.omo/evidence/task-6-fix1/build.log` |
| Diff hygiene | `git diff --check 54882b3` | exit 0 and explicit `PASS` marker | `.omo/evidence/task-6-fix1/diff-check.log` |

TDD RED evidence is `.omo/evidence/task-6-fix1/red-regressions.log`: all
three new scenarios failed against `54882b3` for their intended missing
behavior before production changes. No push, publish, or merge was performed.

## Fix round 2 — 2026-08-19

The adoption boundary now rejects a selected symlink root and an already
existing symlink output root with `KPP_INPUT_ADOPTION_SYMLINK` before input
discovery, staging, or publication. The regression scenarios prove the linked
target gains neither `kpp.project.yaml` nor an adoption receipt.

The clean-install E2E retains the independent installer-owned LongTable source
checks, but its title and assertions now state the actual aggregate fixture
result. Setup and the Public Proposal doctor are successful, while the fixture
is an explicit managed-worker partial gate: `exitCode: 1`, `report.ok: false`,
and the `kpp doctor` output contains a `worker_protocol` warning with
`PP_WORKER_PROTOCOL_MISSING`. Managed-worker and release logic were not
changed.

### Fix-round evidence

| Success criterion | Exact scenario and invocation | Binary observable | Captured artifact |
| --- | --- | --- | --- |
| Symlinked selected root is rejected before publication | `npm test -- packages/core/test/adoption.test.ts`, scenario `rejects a symlinked adoption root before it can mutate the target` | RED: promise resolved and exposed the bypass; GREEN: exit 0, rejection code is `KPP_INPUT_ADOPTION_SYMLINK`, and target `kpp.project.yaml` plus receipt remain absent | `.omo/evidence/task-6-fix2/red-symlink-regressions.log`; `.omo/evidence/task-6-fix2/green-symlink-regressions.log` |
| Existing symlink output root is rejected before publication | Same invocation, scenario `rejects an existing symlink output root before it can mutate the target` | RED: `ENOTDIR`; GREEN: exit 0, rejection code is `KPP_INPUT_ADOPTION_SYMLINK`, and target `kpp.project.yaml` plus receipt remain absent | `.omo/evidence/task-6-fix2/red-symlink-regressions.log`; `.omo/evidence/task-6-fix2/green-symlink-regressions.log` |
| Honest aggregate clean-install state with separate LongTable source checks | `npm test -- tests/e2e/public-proposal-install.test.ts` | exit 0; 1 file/10 tests; E2E asserts `exitCode === 1`, `report.ok === false`, and KPP's worker warning while preserving setup/Public Proposal/LongTable assertions | `.omo/evidence/task-6-fix2/clean-install-e2e.log` |
| Direct partial-gate observable | `node --input-type=module -e '<runCleanEnvironmentFixture probe>'` | probe exit 0; fixture `exitCode: 1`, `reportOk: false`, KPP doctor command exit 0, worker check `warn`/`PP_WORKER_PROTOCOL_MISSING` | `.omo/evidence/task-6-fix2/clean-install-partial-gate.json` |
| Focused Task 6 regression suite | `npm test -- packages/core/test/adoption.test.ts tests/integration/adopt.test.ts apps/public-proposal-cli/test/setup.test.ts apps/public-proposal-cli/test/uninstall-update.test.ts apps/public-proposal-cli/test/doctor.test.ts` | exit 0; 5 files/71 tests | `.omo/evidence/task-6-fix2/focused-task-6-tests.log` |
| Type safety | `npm run typecheck` | exit 0 | `.omo/evidence/task-6-fix2/typecheck.log` |
| Build | `npm run build` | exit 0 | `.omo/evidence/task-6-fix2/build.log` |
| Diff hygiene | `git diff --check e2afb84` | exit 0, empty output | `.omo/evidence/task-6-fix2/diff-check.log` |

The pre-existing untracked installer plan remained untouched. No push,
publish, or merge was performed.

## Fix round 3 — 2026-08-19

Adoption now validates every existing component of `input.root` and an
existing `outputRoot` before discovery, staging, or publication. A symbolic
link at either final component or any ancestor fails closed with
`KPP_INPUT_ADOPTION_SYMLINK`; the linked target retains neither
`kpp.project.yaml` nor an adoption receipt. Test fixtures canonicalize macOS
`/var` temporary paths to `/private/var`: this keeps the strict product policy
intact while exercising ordinary non-symlink roots.

### Fix-round evidence

| Success criterion | Exact scenario and invocation | Binary observable | Captured artifact |
| --- | --- | --- | --- |
| Ancestor symlink rejection (TDD) | First ran `npx vitest run packages/core/test/adoption.test.ts --no-file-parallelism` after adding input-root and existing-output-root ancestor-link regressions, before production code | exit 1; both promises resolved, proving the bypass existed | `.omo/evidence/task-6-fix3/report.md` |
| Input and existing output-root boundary | `npm test -- packages/core/test/adoption.test.ts tests/integration/adopt.test.ts apps/public-proposal-cli/test/setup.test.ts apps/public-proposal-cli/test/uninstall-update.test.ts apps/public-proposal-cli/test/doctor.test.ts` | exit 0; 5 files, 73 tests; direct and ancestor link tests reject with `KPP_INPUT_ADOPTION_SYMLINK`, while canonical ordinary roots adopt successfully | `.omo/evidence/task-6-fix3/report.md` |
| Honest separate-LongTable clean-install gate | `npm test -- tests/e2e/public-proposal-install.test.ts` | exit 0; 1 file, 10 tests; preserves explicit aggregate partial-gate assertions (`exitCode: 1`, `report.ok: false`, `PP_WORKER_PROTOCOL_MISSING`) | `.omo/evidence/task-6-fix3/report.md` |
| Type safety, build, and diff hygiene | `npm run typecheck`; `npm run build`; `git diff --check e2afb84`; `git diff --check` | each exit 0; both diff checks empty | `.omo/evidence/task-6-fix3/report.md` |

No managed-worker behavior, release logic, setup/update/uninstall ownership,
atomic adoption, rollback, or LongTable/customer-state handling changed. No
push, publish, or merge was performed.
