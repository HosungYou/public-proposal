# Task 5 report — CLI doctor, init, and status

## Scope

- Base commit: `7f59c04cfe63eca1be31f3c193e2fe5cadd087a8`
- Implementation commit: `27d0ded` (`feat: add KPP doctor init and status commands`)
- Added the Commander executable surface for `kpp doctor`, `kpp init`, and
  `kpp status` with the stable JSON envelope `{ ok, code, message, data }`.
- `init` delegates project-record creation to `@kpp/core`; the core creates
  the approved working directories plus the atomically persisted YAML record.
  It intentionally does not create `release/`, because only `release` may
  create a final submission directory.
- Added dependency-package builds so `apps/kpp-cli/dist/main.js` is a runnable
  executable rather than an emitted entrypoint that still resolves source-only
  workspace modules.

## TDD evidence

The initial CLI integration suite was written before the executable existed.
`npm test -- apps/kpp-cli/test/cli.test.ts` failed because
`apps/kpp-cli/src/main.ts` was missing; captured output is
`.omo/evidence/task-5-cli-red.log`. The post-implementation source CLI suite
passed at `.omo/evidence/task-5-cli-green.log`.

The compiled-executable test then failed with `ERR_MODULE_NOT_FOUND` for the
core's source-only `.js` import at `.omo/evidence/task-5-built-cli-red.log`.
The packaging fix was validated by the passing compiled CLI suite at
`.omo/evidence/task-5-cli-final-green.log`.

## Success-criterion verification

| Criterion | Scenario and invocation | Binary observable | Captured artifact |
| --- | --- | --- | --- |
| CLI init/status envelope and INIT state | `npm test -- apps/kpp-cli/test/cli.test.ts` | 4 tests passed; a real subprocess creates YAML and approved non-release directories, then `status` returns `data.state: "INIT"` | `.omo/evidence/task-5-cli-final-green.log` |
| Stable JSON error | Same CLI test, `status <empty-temp-root> --json` | exits `1` with `ok: false` and `code: "KPP_INPUT_PROJECT_READ"` | `.omo/evidence/task-5-cli-final-green.log` |
| Portable doctor checks | `node apps/kpp-cli/dist/main.js doctor --json` | exits `0`; JSON contains Node, Python, soffice, Noto-font, temp-storage, and worker-protocol checks with `pass`/`warn` status | `.omo/evidence/task-5-postcommit-doctor.json` |
| Current macOS diagnostics are observed, not hardcoded | Same real doctor invocation | `platform: "darwin"`, detected `Python 3.14.6`, and `/opt/homebrew/bin/soffice`; worker protocol is an actionable `warn` because no worker is configured | `.omo/evidence/task-5-postcommit-doctor.json` |
| Full regression suite | `npm test` | 5 test files and 27 tests passed | `.omo/evidence/task-5-postcommit-full-test.log` |
| Static validation | `npm run typecheck` | TypeScript exits `0` | `.omo/evidence/task-5-postcommit-typecheck.log` |
| Production build | `npm run build` | schemas, core, and CLI package compilation all exit `0` | `.omo/evidence/task-5-postcommit-build.log` |
| Commit diff hygiene | `git show --check --format=fuller HEAD` | exits `0` with no whitespace errors for `27d0ded` | `.omo/evidence/task-5-postcommit-show-check.log` |

## Boundaries preserved

- No direct AI/API calls were added.
- Doctor only reads/probes local executables and font paths; its temporary
  write probe is deleted before completion and it never installs software.
- No final submission directory is created by `init`.

## Review-blocker remediation

The follow-up fixes only the Task 5 executable and doctor review blockers.
`main.ts` now has a Node shebang and the CLI build sets `dist/main.js` to
executable mode. The public `bin.kpp` target remains `dist/main.js`.

`doctor` now treats `KPP_WORKER_PATH` as the documented worker configuration:
it runs that executable with the non-mutating `--protocol-version` request and
only passes when the response is exactly `1.0.0`. The obsolete
`KPP_WORKER_PROTOCOL_VERSION` value cannot produce a pass on its own. Python,
LibreOffice, and Noto discovery now uses macOS, Linux, and Windows candidate
sets while retaining the observed macOS candidates.

| Criterion | Scenario and invocation | Binary observable | Captured artifact |
| --- | --- | --- | --- |
| Built executable and linked `kpp` command | `npm run build`, then direct `apps/kpp-cli/dist/main.js doctor --json`; a temporary linked `kpp` executes the same command | `dist/main.js` is `-rwxr-xr-x`; both direct and linked invocations exit 0 with `code: "KPP_OK"` | `.omo/evidence/task-5-fix-final-build.log`, `.omo/evidence/task-5-fix-final-direct-executable.log`, `.omo/evidence/task-5-fix-final-linked-kpp.log` |
| Env-only worker false pass is blocked | `KPP_WORKER_PROTOCOL_VERSION=1.0.0 apps/kpp-cli/dist/main.js doctor --json` | `worker_protocol.status` is `"warn"`, `actual` and `worker` are `null`, and the action names `KPP_WORKER_PATH` | `.omo/evidence/task-5-fix-final-worker-env-only.json` |
| Configured worker handshake is required | Focused CLI regression creates an executable fixture that returns `1.0.0` only to `--protocol-version` | The fixture is the only passing worker case; focused suite reports 8/8 tests | `.omo/evidence/task-5-fix-final-focused-cli-test.log` |
| Portable candidates and current macOS evidence | Focused Windows/Linux candidate tests; real direct doctor invocation on this host | Candidate tests pass; real doctor detects `platform: "darwin"`, `Python 3.14.6`, and `/opt/homebrew/bin/soffice` | `.omo/evidence/task-5-fix-final-focused-cli-test.log`, `.omo/evidence/task-5-fix-final-doctor.json` |
| Regression, static, package, and diff hygiene | `npm test`; `npm run typecheck`; `npm pack --dry-run --workspace @enaction-labs/kpp-cli`; `git diff --check` | 5 files / 31 tests pass; typecheck/build exit 0; tarball includes `dist/main.js`; diff check exits 0 | `.omo/evidence/task-5-fix-final-full-test.log`, `.omo/evidence/task-5-fix-final-typecheck.log`, `.omo/evidence/task-5-fix-final-npm-pack-dry-run.log`, `.omo/evidence/task-5-fix-final-diff-check.log` |

### Follow-up TDD evidence

- Direct-entry regression first failed because the compiled target had no
  execute bits: `.omo/evidence/task-5-fix-executable-red.log`.
- Worker, handshake, direct-entry, and portable-candidate regressions then
  failed against the pre-fix behavior: `.omo/evidence/task-5-fix-doctor-portability-red.log`.
- The final focused suite passed all eight real subprocess/candidate scenarios:
  `.omo/evidence/task-5-fix-final-focused-cli-test.log`.
