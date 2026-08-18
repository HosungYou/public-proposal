# Task 4 Report: Managed KPP DOCX Worker

Status: DONE

## Files and Interfaces

- Added `apps/public-proposal-cli/src/worker.ts`.
  - `installManagedWorker(root, runner): Promise<WorkerInstallation>`
  - `resolveManagedWorker(manifestPath?): Promise<string | null>`
  - `verifyWorkerProtocol(protocolOrExecutable, runner?)`
  - `resolveManagedWorkerFromManifestContents(contents)`
- Extended `apps/public-proposal-cli/src/contracts.ts`.
  - Added `WorkerInstallation = { executable; protocolVersion: "1.0.0"; sha256 }`.
  - Added required `worker` receipt field to `InstallManifest`.
- Updated `apps/public-proposal-cli/src/commands/setup.ts`.
  - Adds `<installRoot>/worker` to owned paths.
  - Installs managed worker before final doctor and receipt write.
  - Rolls back `worker`, `codex-skills`, `marketplace`, and `plugin` on setup failure.
  - Blocks invalid existing `installation.json` instead of ignoring it.
  - Verifies packaged worker `pyproject.toml` and `uv.lock` during package integrity checks.
- Updated `apps/public-proposal-cli/src/commands/doctor.ts`.
  - Verifies the worker from `installation.json` instead of `kpp worker doctor`.
  - Returns `PP_WORKER_PROTOCOL_MISSING` or `PP_WORKER_PROTOCOL_MISMATCH` from the protocol check.
- Added `apps/kpp-cli/src/managed-worker.ts`.
  - KPP-local manifest resolver to avoid a package dependency cycle.
  - Validates install root, owned paths, worker path containment, protocol version, and sha256 shape.
- Updated `apps/kpp-cli/src/commands/doctor.ts`.
  - Uses explicit `KPP_WORKER_PATH` when set, otherwise the Public Proposal installation manifest.
- Updated `apps/kpp-cli/src/commands/build.ts`.
  - Uses explicit worker override first, then managed manifest, then repository dev venv fallback.
  - Checks worker protocol before running the build bridge.
  - Preserves the repository `.venv/bin/python` path rather than resolving it to the Homebrew Python target.
- Updated `workers/docx-python/pyproject.toml` and `workers/docx-python/src/kpp_docx/main.py`.
  - Adds `kpp-docx-worker` console script for the existing `kpp_docx.main:main` entrypoint.
  - Adds `--protocol-version`, returning the existing protocol constant `1.0.0`.
- Added `scripts/sync_public_proposal_worker.mjs`.
  - Copies `workers/docx-python` into `apps/public-proposal-cli/worker` during build.
  - Excludes `.venv`, `.pytest_cache`, `__pycache__`, `.pyc`, `.DS_Store`, and tests.
- Added `apps/public-proposal-cli/test/worker.test.ts` and fixture manifest.
- Updated setup, doctor, uninstall/update, contract, KPP CLI, and release-flow tests for the worker receipt and resolver.

## Worker Path, Protocol, and Hash Behavior

- Managed installation path is `<installRoot>/worker`.
- Managed executable is `<installRoot>/worker/bin/python`.
- Source snapshot is copied to `<installRoot>/worker/source`.
- `uv sync --locked --no-dev` runs with:
  - `cwd = <installRoot>/worker/source`
  - `UV_PROJECT_ENVIRONMENT = <installRoot>/worker/.venv`
  - `UV_CACHE_DIR = <installRoot>/worker/.uv-cache`
  - `UV_PYTHON_INSTALL_DIR = <installRoot>/worker/.uv-python`
- The installed wrapper sets `PYTHONPATH` to the owned worker source and executes `<installRoot>/worker/.venv/bin/python`.
- Protocol is verified as exactly `1.0.0`.
- Worker receipt stores `sha256:<64 hex>` of the installed wrapper executable.
- `resolveManagedWorker` returns `null` for missing, malformed, wrong-version, wrong-owned-path, or outside-worker-root manifests.
- The resolver never returns a path outside `<installRoot>/worker`.
- Explicit `KPP_WORKER_PATH` / `--python` remains a controlled-test override in KPP; otherwise KPP resolves the managed manifest.

## Manifest and Owned-Path Changes

`installation.json` now includes:

```json
{
  "worker": {
    "executable": "<installRoot>/worker/bin/python",
    "protocolVersion": "1.0.0",
    "sha256": "sha256:<wrapper hash>"
  },
  "ownedPaths": [
    "<installRoot>/plugin",
    "<installRoot>/marketplace",
    "<installRoot>/codex-skills",
    "<installRoot>/worker"
  ]
}
```

Uninstall already allowed the worker root; setup validation now expects it as part of the canonical owned-path set.

## Commands and Output

```text
npm test -- apps/public-proposal-cli/test/worker.test.ts
```

Initial RED result:

```text
FAIL apps/public-proposal-cli/test/worker.test.ts
Error: Cannot find module '../src/worker.js'
```

Final result:

```text
Test Files  1 passed (1)
Tests  4 passed (4)
```

```text
npm test -- apps/kpp-cli/test/cli.test.ts
```

Initial RED result:

```text
passes worker protocol from the managed Public Proposal installation manifest
Received status: "warn"; detected.actual: null; detected.worker: null
```

Final result:

```text
Test Files  1 passed (1)
Tests  10 passed (10)
```

```text
npm test -- apps/public-proposal-cli/test/worker.test.ts apps/kpp-cli/test/cli.test.ts apps/kpp-cli/test/release-flow.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests  25 passed (25)
```

```text
npm test -- apps/public-proposal-cli/test/worker.test.ts apps/public-proposal-cli/test/setup.test.ts apps/public-proposal-cli/test/doctor.test.ts apps/kpp-cli/test/cli.test.ts apps/kpp-cli/test/release-flow.test.ts
```

Result:

```text
Test Files  5 passed (5)
Tests  41 passed (41)
```

```text
npm run typecheck
```

Result:

```text
tsc --noEmit -p tsconfig.base.json && npm run typecheck --workspace @longtable/public-proposal
@longtable/public-proposal@0.1.0 typecheck
tsc --noEmit -p tsconfig.json
```

Exit code: 0.

```text
npm run build
```

Result:

```text
@longtable/kpp-schemas@0.2.1 build
@longtable/kpp-core@0.2.1 build
@longtable/kpp-renderers@0.2.1 build
@longtable/kpp-audits@0.2.1 build
@longtable/kpp-cli@0.2.1 build
@longtable/public-proposal@0.1.0 build
node ../../scripts/sync_public_proposal_worker.mjs && tsc -p tsconfig.json
```

Exit code: 0.

```text
npm pack --workspace @longtable/public-proposal --dry-run
```

Result:

```text
worker/assets/Korean Public Proposal A4 v1.docx
worker/assets/PROVENANCE.md
worker/pyproject.toml
worker/src/kpp_docx/*.py
worker/uv.lock
dist/worker.js
total files: 86
package size: 28.0 MB
```

Exit code: 0.

Additional snapshot checks:

```text
find apps/public-proposal-cli/worker -type d \( -name .venv -o -name .pytest_cache -o -name __pycache__ \) -print
```

No output.

```text
rg -n "/Users/|/var/folders|\.venv|__pycache__|\.pytest_cache" apps/public-proposal-cli/worker
```

No matches.

## Commit

`d1ef850` - `feat: install and resolve managed KPP DOCX worker`

## Concerns

- KPP keeps the repository `.venv/bin/python` fallback for in-repository development and existing release-flow tests. Installed/default behavior resolves the managed manifest; explicit worker path remains a test override.
- `resolveManagedWorker` validates manifest structure and path containment, but does not hash-read the executable at resolution time because the required fixture resolver test uses a manifest-only path. Setup/install records the executable sha256, and doctor/build perform live protocol verification before use.

## Fix Round 1: Review HIGH Findings

Status: DONE

### Changes

- Added strict managed-worker verification before doctor/build execution.
  - Worker receipt hash must match `sha256:<64 lowercase hex>`.
  - Public Proposal doctor and KPP doctor/build compute the actual executable hash before protocol execution.
  - Managed worker root and executable are canonicalized with `realpath`.
  - A symlinked `worker/bin/python` that resolves outside canonical `<installRoot>/worker` is rejected with `PP_WORKER_INTEGRITY_FAILED`.
  - KPP executes the canonical managed-worker path after verification.
- Preserved explicit mismatch classification.
  - A present manifest with `workerProtocol` or `worker.protocolVersion` mismatch now reports `PP_WORKER_PROTOCOL_MISMATCH`.
  - A present invalid/tampered manifest no longer falls through to the repository `.venv` worker.
  - Only absent manifests return `null` and allow the repository development fallback.
  - Explicit `KPP_WORKER_PATH` remains an override and is not canonicalized through the managed-manifest path.
- Added Task 3 receipt migration.
  - Setup recognizes a valid legacy receipt with the old three owned paths and no `worker` field.
  - Migration installs only `<installRoot>/worker`, runs doctor against the upgraded receipt, and atomically replaces `installation.json`.
  - Migration rollback removes only the new worker root and any temporary receipt, preserving existing plugin, marketplace, and codex-skills paths.

### Regression Tests Added

- Public worker strict verification:
  - executable hash tampering rejects with `PP_WORKER_INTEGRITY_FAILED`;
  - in-root symlink escape rejects with `PP_WORKER_INTEGRITY_FAILED`.
- Public installer doctor:
  - manifest protocol mismatch reports `PP_WORKER_PROTOCOL_MISMATCH`;
  - wrapper hash drift reports `PP_WORKER_INTEGRITY_FAILED`.
- KPP doctor/build:
  - managed manifest protocol mismatch reports `PP_WORKER_PROTOCOL_MISMATCH` and does not fall back;
  - symlink escape is rejected before the external target executes.
- Setup:
  - valid Task 3 receipt migrates to include the worker root;
  - failed migration rolls back only the new worker root and preserves old owned paths.

### Commands and Output

```text
npm test -- apps/public-proposal-cli/test/worker.test.ts apps/public-proposal-cli/test/setup.test.ts apps/public-proposal-cli/test/doctor.test.ts apps/kpp-cli/test/cli.test.ts apps/kpp-cli/test/release-flow.test.ts
```

Result:

```text
Test Files  5 passed (5)
Tests  50 passed (50)
```

```text
npm run typecheck
```

Result:

```text
tsc --noEmit -p tsconfig.base.json && npm run typecheck --workspace @longtable/public-proposal
@longtable/public-proposal@0.1.0 typecheck
tsc --noEmit -p tsconfig.json
```

Exit code: 0.

```text
npm run build
```

Result:

```text
@longtable/kpp-schemas@0.2.1 build
@longtable/kpp-core@0.2.1 build
@longtable/kpp-renderers@0.2.1 build
@longtable/kpp-audits@0.2.1 build
@longtable/kpp-cli@0.2.1 build
@longtable/public-proposal@0.1.0 build
node ../../scripts/sync_public_proposal_worker.mjs && tsc -p tsconfig.json
```

Exit code: 0.

```text
npm pack --workspace @longtable/public-proposal --dry-run
```

Result:

```text
longtable-public-proposal-0.1.0.tgz
```

Exit code: 0.

```text
find apps/public-proposal-cli/worker -type d \( -name .venv -o -name .pytest_cache -o -name __pycache__ \) -print
```

No output.

```text
rg -n "/Users/|/var/folders|\.venv|__pycache__|\.pytest_cache" apps/public-proposal-cli/worker
```

No matches.

```text
git diff --check
```

Exit code: 0.

### Fix Commit

Committed in the fix-round changeset; final immutable HEAD is returned in the worker status.

### Remaining Concerns

- `resolveManagedWorker()` remains the compatibility/lightweight resolver and does not hash-read by itself; doctor/build now use strict verification paths before execution.
- Repository `.venv` fallback is still present only when no managed manifest exists, preserving development test behavior.

## Fix Round 2: Legacy Migration Atomicity

Status: DONE

### Changes

- Added `ManagedWorkerInstallOptions` to `installManagedWorker`.
  - Default behavior is unchanged: managed worker install updates an existing manifest when called normally.
  - Legacy migration calls `installWorker(..., { updateManifest: false })` so the old Task 3 receipt is not mutated before doctor and final atomic receipt replacement complete.
- Preserved normal setup, owned-path, worker protocol, hash, symlink, mismatch, and explicit `KPP_WORKER_PATH` behavior.

### Regression Test Added

- `preserves exact Task 3 receipt bytes after post-install migration failure and retries`
  - Simulates the old receipt-mutation path in the fake installer unless `updateManifest: false` is used.
  - Forces a post-install doctor failure with worker protocol `2.0.0`.
  - Verifies the exact original legacy receipt bytes remain.
  - Verifies old `plugin`, `marketplace`, and `codex-skills` paths remain.
  - Verifies the new worker root is rolled back.
  - Retries with protocol `1.0.0` and verifies migration succeeds.

### Commands and Output

```text
npm test -- apps/public-proposal-cli/test/setup.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  13 passed (13)
```

```text
npm test -- apps/public-proposal-cli/test/worker.test.ts apps/public-proposal-cli/test/setup.test.ts apps/public-proposal-cli/test/doctor.test.ts apps/kpp-cli/test/cli.test.ts apps/kpp-cli/test/release-flow.test.ts
```

Result:

```text
Test Files  5 passed (5)
Tests  51 passed (51)
```

```text
npm run typecheck
```

Result:

```text
tsc --noEmit -p tsconfig.base.json && npm run typecheck --workspace @longtable/public-proposal
@longtable/public-proposal@0.1.0 typecheck
tsc --noEmit -p tsconfig.json
```

Exit code: 0.

```text
npm run build
```

Result:

```text
@longtable/kpp-schemas@0.2.1 build
@longtable/kpp-core@0.2.1 build
@longtable/kpp-renderers@0.2.1 build
@longtable/kpp-audits@0.2.1 build
@longtable/kpp-cli@0.2.1 build
@longtable/public-proposal@0.1.0 build
node ../../scripts/sync_public_proposal_worker.mjs && tsc -p tsconfig.json
```

Exit code: 0.

```text
npm pack --workspace @longtable/public-proposal --dry-run
```

Result:

```text
longtable-public-proposal-0.1.0.tgz
total files: 86
```

Exit code: 0.

```text
find apps/public-proposal-cli/worker -type d \( -name .venv -o -name .pytest_cache -o -name __pycache__ \) -print
```

No output.

```text
rg -n "/Users/|/var/folders|\.venv|__pycache__|\.pytest_cache" apps/public-proposal-cli/worker
```

No matches.

```text
git diff --check
```

Exit code: 0.

### Fix Round 2 Commit

Committed in the fix-round-2 changeset; final immutable HEAD is returned in the worker status.
