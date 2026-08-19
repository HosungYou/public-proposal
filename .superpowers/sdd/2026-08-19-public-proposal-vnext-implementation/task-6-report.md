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
