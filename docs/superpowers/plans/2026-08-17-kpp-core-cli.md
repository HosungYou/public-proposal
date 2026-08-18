# KPP Core and CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TypeScript state machine, schemas, receipt hashing, project initialization, source locking, and the `kpp` CLI commands through `plan`.

**Architecture:** An npm-workspace monorepo exposes a thin CLI over a model-independent core. Zod schemas validate every persisted object, and only the core can advance project state after verifying input and receipt hashes.

**Tech Stack:** Node 22-26, npm workspaces, TypeScript 7.0.2, Vitest 4.1.10, Zod 4.4.3, Commander 15.0.0, YAML 2.9.0.

**Spec:** `docs/superpowers/specs/2026-08-17-kpp-product-design.md`

## Global Constraints

- Product ID is `public-proposal`; CLI command is `kpp`; the current public package line is `0.2.0`.
- Customer documents remain local; the core makes no direct AI API calls.
- The v0.1 runtime is verified on macOS and keeps OS operations behind adapters.
- Every state change requires validated inputs and SHA-256-bound receipts.
- Critical unresolved facts are `blocked`; noncritical blanks are `pending_blank`.
- No command other than `release` may create a final submission directory.

---

### Task 1: Workspace and test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `apps/kpp-cli/package.json`
- Create: `apps/kpp-cli/tsconfig.json`
- Create: `packages/core/package.json`
- Create: `packages/schemas/package.json`
- Create: `tests/smoke/workspace.test.ts`

**Interfaces:**
- Consumes: Node and npm versions from the approved spec.
- Produces: npm scripts `build`, `test`, `typecheck`; workspace packages under the `@longtable/kpp-*` scope.

- [ ] **Step 1: Write the failing workspace smoke test**

```ts
import { describe, expect, it } from "vitest";
import root from "../../package.json";

describe("workspace", () => {
  it("declares the KPP workspaces", () => {
    expect(root.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(root.engines.node).toBe(">=22 <27");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing root manifest failure**

Run: `npm test -- tests/smoke/workspace.test.ts`
Expected: FAIL because `package.json` and the test runner configuration do not exist.

- [ ] **Step 3: Add the workspace manifests and pinned dependencies**

Use exact dev dependency versions `typescript@7.0.2`, `vitest@4.1.10`, and `tsx@4.23.12`; add `zod@4.4.3`, `commander@15.0.0`, and `yaml@2.9.0` to the owning packages. Set `private: true` on the monorepo root.

- [ ] **Step 4: Install, build, and run the smoke test**

Run: `npm install && npm run typecheck && npm test -- tests/smoke/workspace.test.ts`
Expected: all commands exit 0 and create `package-lock.json`.

- [ ] **Step 5: Commit the workspace foundation**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore apps packages tests
git commit -m "build: scaffold KPP TypeScript workspace"
```

### Task 2: Canonical schemas

**Files:**
- Create: `packages/schemas/src/project.ts`
- Create: `packages/schemas/src/receipt.ts`
- Create: `packages/schemas/src/evidence.ts`
- Create: `packages/schemas/src/index.ts`
- Create: `packages/schemas/test/schemas.test.ts`

**Interfaces:**
- Consumes: Zod 4.4.3.
- Produces: `ProjectSchema`, `ReceiptSchema`, `EvidenceItemSchema`, `ProjectState`, `EvidenceStatus`.

- [ ] **Step 1: Write schema tests for valid and invalid persisted data**

```ts
import { EvidenceItemSchema, ProjectSchema } from "../src/index.js";

it("rejects a verified claim without evidence ids", () => {
  expect(() => EvidenceItemSchema.parse({
    claimId: "C-1", status: "verified", evidenceIds: []
  })).toThrow();
});

it("accepts a new local project", () => {
  expect(ProjectSchema.parse({
    schemaVersion: "1.0.0", projectId: "sample", state: "INIT",
    issuerPack: null, approvalPolicy: "single_owner"
  }).state).toBe("INIT");
});
```

- [ ] **Step 2: Run the schema test and verify import failure**

Run: `npm test -- packages/schemas/test/schemas.test.ts`
Expected: FAIL because the schema exports do not exist.

- [ ] **Step 3: Implement discriminated evidence and state schemas**

Define the exact states `INIT`, `SOURCE_LOCKED`, `REQUIREMENTS_LOCKED`, `EVIDENCE_LOCKED`, `DESIGN_LOCKED`, `CONTENT_APPROVED`, `BUILT`, `RENDERED`, `AUDITED`, `HUMAN_APPROVED`, and `RELEASED`. Require nonempty `evidenceIds` for `verified` and `bounded`; permit empty values only for `pending_blank` and `blocked`.

- [ ] **Step 4: Run schema tests and typecheck**

Run: `npm test -- packages/schemas/test/schemas.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit schemas**

```bash
git add packages/schemas
git commit -m "feat: define KPP project and evidence schemas"
```

### Task 3: Hashing and immutable receipts

**Files:**
- Create: `packages/core/src/hash.ts`
- Create: `packages/core/src/receipts.ts`
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/test/receipts.test.ts`

**Interfaces:**
- Consumes: `ReceiptSchema`.
- Produces: `sha256File(path: string): Promise<string>`, `writeReceipt(input: ReceiptInput): Promise<Receipt>`, `verifyReceipt(path: string): Promise<ReceiptVerification>`.

- [ ] **Step 1: Write a test that invalidates a receipt after a file change**

```ts
it("invalidates a receipt when a bound file changes", async () => {
  await writeFile(input, "alpha");
  await writeReceipt({ stage: "SOURCE_LOCKED", files: [input], output: receipt });
  await writeFile(input, "beta");
  expect((await verifyReceipt(receipt)).valid).toBe(false);
});
```

- [ ] **Step 2: Run the receipt test and verify missing implementation failure**

Run: `npm test -- packages/core/test/receipts.test.ts`
Expected: FAIL because receipt functions do not exist.

- [ ] **Step 3: Implement SHA-256 binding and atomic receipt writes**

Write to the target receipt path with a `.tmp` suffix, fsync, and rename. Include `schemaVersion`, `stage`, `createdAt`, `toolVersion`, sorted file records, input receipt hashes, and `result`.

- [ ] **Step 4: Run receipt tests**

Run: `npm test -- packages/core/test/receipts.test.ts`
Expected: PASS, including mutation invalidation.

- [ ] **Step 5: Commit receipt authority**

```bash
git add packages/core
git commit -m "feat: bind stage receipts to artifact hashes"
```

### Task 4: State transition engine

**Files:**
- Create: `packages/core/src/state-machine.ts`
- Create: `packages/core/src/project-store.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/state-machine.test.ts`

**Interfaces:**
- Consumes: verified receipts and `ProjectSchema`.
- Produces: `allowedNext(state: ProjectState): ProjectState[]`, `advanceProject(root: string, target: ProjectState): Promise<ProjectRecord>`.

- [ ] **Step 1: Write tests that reject skipped and stale transitions**

```ts
it("cannot skip from INIT to BUILT", async () => {
  await expect(advanceProject(root, "BUILT")).rejects.toMatchObject({
    code: "KPP_STATE_INVALID_TRANSITION"
  });
});
```

- [ ] **Step 2: Run the state test and verify failure**

Run: `npm test -- packages/core/test/state-machine.test.ts`
Expected: FAIL because the state engine does not exist.

- [ ] **Step 3: Implement the ordered transition table and receipt checks**

Only permit adjacent forward transitions. Permit invalidation back to the earliest affected stage when a bound input changes; never permit direct user assignment of `state`.

- [ ] **Step 4: Run state and receipt tests together**

Run: `npm test -- packages/core/test/state-machine.test.ts packages/core/test/receipts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit state authority**

```bash
git add packages/core
git commit -m "feat: enforce KPP project state transitions"
```

### Task 5: CLI doctor, init, and status

**Files:**
- Create: `apps/kpp-cli/src/main.ts`
- Create: `apps/kpp-cli/src/output.ts`
- Create: `apps/kpp-cli/src/commands/doctor.ts`
- Create: `apps/kpp-cli/src/commands/init.ts`
- Create: `apps/kpp-cli/src/commands/status.ts`
- Create: `apps/kpp-cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `@kpp/core` project store and state engine.
- Produces: executable `kpp`, stable JSON envelope `{ ok, code, message, data }`.

- [ ] **Step 1: Write CLI integration tests**

```ts
it("initializes a project and reports INIT", async () => {
  await run(["init", root, "--json"]);
  const status = JSON.parse(await run(["status", root, "--json"]));
  expect(status.data.state).toBe("INIT");
});
```

- [ ] **Step 2: Run the CLI test and verify missing executable failure**

Run: `npm test -- apps/kpp-cli/test/cli.test.ts`
Expected: FAIL because `main.ts` and commands do not exist.

- [ ] **Step 3: Implement doctor, init, status, and JSON errors**

`doctor` checks Node, Python, `soffice`, font paths, writable temp storage, and worker protocol compatibility without installing anything. `init` creates the approved project directory structure and `kpp.project.yaml` atomically.

- [ ] **Step 4: Run CLI tests and a real doctor command**

Run: `npm test -- apps/kpp-cli/test/cli.test.ts && npm run build && node apps/kpp-cli/dist/main.js doctor --json`
Expected: tests PASS; doctor reports macOS, Python 3.14.6, and `/opt/homebrew/bin/soffice` in this environment.

- [ ] **Step 5: Commit CLI foundation**

```bash
git add apps/kpp-cli
git commit -m "feat: add KPP doctor init and status commands"
```

### Task 6: Source lock, requirement plan, and evidence lock

**Files:**
- Create: `apps/kpp-cli/src/commands/ingest.ts`
- Create: `apps/kpp-cli/src/commands/plan.ts`
- Create: `packages/schemas/src/requirements.ts`
- Create: `packages/schemas/src/page-plan.ts`
- Create: `apps/kpp-cli/test/planning-flow.test.ts`

**Interfaces:**
- Consumes: source files and user-confirmed requirement JSON.
- Produces: `sources/manifest.json`, `requirements/requirements.json`, `content/page-plan.json`, `evidence/evidence-ledger.json`, and receipts through `EVIDENCE_LOCKED`.

- [ ] **Step 1: Write the end-to-end planning test**

```ts
it("locks copied sources and blocks a critical missing claim", async () => {
  await run(["ingest", root, rfpPath, "--json"]);
  await run(["plan", root, "--requirements", requirementsPath, "--json"]);
  const ledger = JSON.parse(await readFile(join(root, "evidence/evidence-ledger.json"), "utf8"));
  expect(ledger.claims[0].status).toBe("blocked");
});
```

- [ ] **Step 2: Run the flow test and verify missing command failure**

Run: `npm test -- apps/kpp-cli/test/planning-flow.test.ts`
Expected: FAIL because ingest and plan are not registered.

- [ ] **Step 3: Implement copied source locking and deterministic planning inputs**

Do not infer confirmed requirements. Accept parser output only as `pending`; require a user-confirmed requirements file before `REQUIREMENTS_LOCKED`. Generate page records with `pageRole`, `surfaceTemplateId`, `claimIds`, and `figureSpecs`.

- [ ] **Step 4: Run all core and CLI tests**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit the planning spine**

```bash
git add apps/kpp-cli packages/schemas
git commit -m "feat: lock sources requirements and evidence plans"
```
