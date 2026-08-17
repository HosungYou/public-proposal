# KPP Content Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract reviewable RFP requirements, exchange structured authoring tasks with Codex, lint Korean proposal prose, select semantic figure families, and lock approved content before document building.

**Architecture:** Deterministic local extractors create candidate requirements and authoring bundles. Codex may fill only schema-constrained content slots; the CLI validates imports, evidence boundaries, prose rules, and human approvals before advancing to `CONTENT_APPROVED`.

**Tech Stack:** TypeScript, Zod, `pdftotext`/PDF text extraction adapter, Vitest, existing KPP core and schema packages.

**Spec:** `docs/superpowers/specs/2026-08-17-kpp-product-design.md`

## Global Constraints

- Automatically extracted requirements remain `pending` until a user confirms them.
- Codex output cannot create verified evidence or change project state directly.
- Undefined terms, unsupported numbers, difficult neologisms, and repetitive consulting prose block content approval.
- Figure family follows meaning; repeated generic cards are never a fallback for schedules, matrices, comparisons, or evidence chains.
- ImageGen is limited to validated topology studies and never supplies final evidence-bearing text or data.

---

### Task 1: Local RFP text extraction and candidate requirements

**Files:**
- Create: `packages/core/src/text-extraction.ts`
- Create: `packages/core/src/rfp-candidates.ts`
- Create: `packages/schemas/src/rfp-candidate.ts`
- Create: `packages/core/test/rfp-candidates.test.ts`

**Interfaces:**
- Consumes: locked PDF, DOCX, TXT, or issuer form source.
- Produces: `requirements/candidates.json` with source file hash, page or section locator, extracted text, category, confidence, and status `pending`.

- [ ] **Step 1: Write candidate extraction tests with page-linked fixtures**

```ts
it("extracts a page cap as pending with its source locator", async () => {
  const result = await extractRequirementCandidates(fixturePdf);
  expect(result).toContainEqual(expect.objectContaining({
    category: "page_limit", status: "pending", sourceLocator: "page:17"
  }));
});
```

- [ ] **Step 2: Run the test and verify missing extractor failure**

Run: `npm test -- packages/core/test/rfp-candidates.test.ts`
Expected: FAIL because extraction modules do not exist.

- [ ] **Step 3: Implement process-safe text extraction and conservative patterns**

Use OS adapters and argument arrays. Preserve text and locator provenance. Candidate rules may identify likely values but may not set `confirmed`.

- [ ] **Step 4: Run extraction tests and typecheck**

Run: `npm test -- packages/core/test/rfp-candidates.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit local RFP extraction**

```bash
git add packages/core packages/schemas
git commit -m "feat: extract reviewable RFP requirement candidates"
```

### Task 2: Requirement confirmation and conflict ledger

**Files:**
- Create: `apps/kpp-cli/src/commands/requirements.ts`
- Create: `packages/core/src/requirement-lock.ts`
- Create: `apps/kpp-cli/test/requirements.test.ts`

**Interfaces:**
- Consumes: candidate requirements plus explicit user decisions.
- Produces: confirmed `requirements/requirements.json`, conflicts, compliance matrix, and `requirements-lock.json`.

- [ ] **Step 1: Write tests for pending and conflicting rules**

```ts
it("refuses to lock an unresolved page-limit conflict", async () => {
  await expect(lockRequirements(root, conflictingDecisions)).rejects.toMatchObject({
    code: "KPP_INPUT_REQUIREMENT_CONFLICT"
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- apps/kpp-cli/test/requirements.test.ts`
Expected: FAIL because confirmation commands do not exist.

- [ ] **Step 3: Implement explicit confirm, reject, conflict, and no-rule decisions**

Require a source locator and human decision record for every mandatory submission constraint. Preserve issuer precedence over cohort conventions.

- [ ] **Step 4: Run requirement tests**

Run: `npm test -- apps/kpp-cli/test/requirements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit requirement locking**

```bash
git add apps/kpp-cli packages/core
git commit -m "feat: confirm and lock proposal requirements"
```

### Task 3: Model-independent authoring bundle exchange

**Files:**
- Create: `packages/schemas/src/authoring-bundle.ts`
- Create: `packages/core/src/authoring-bundle.ts`
- Create: `apps/kpp-cli/src/commands/export-authoring.ts`
- Create: `apps/kpp-cli/src/commands/import-authoring.ts`
- Create: `apps/kpp-cli/test/authoring-bundle.test.ts`

**Interfaces:**
- Consumes: locked requirements, evidence ledger, page plan, issuer profile, and approved terminology.
- Produces: `content/authoring-request.json` and validated `content/authoring-response.json`.

- [ ] **Step 1: Write tests that reject model output exceeding evidence scope**

```ts
it("rejects a new numeric claim absent from the evidence ledger", async () => {
  await expect(importAuthoring(root, responseWithInventedNumber)).rejects.toMatchObject({
    code: "KPP_EVIDENCE_UNBOUND_CLAIM"
  });
});
```

- [ ] **Step 2: Run the authoring test and verify failure**

Run: `npm test -- apps/kpp-cli/test/authoring-bundle.test.ts`
Expected: FAIL because export and import commands are absent.

- [ ] **Step 3: Implement schema-constrained export and import**

Each content block carries `pageId`, `claimIds`, allowed evidence IDs, terminology, length budget, required evaluator answer, and permitted blank fields. Imported text cannot add IDs or verified status.

- [ ] **Step 4: Run authoring tests and typecheck**

Run: `npm test -- apps/kpp-cli/test/authoring-bundle.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit the model adapter boundary**

```bash
git add packages apps/kpp-cli
git commit -m "feat: exchange evidence-bounded authoring bundles"
```

### Task 4: Korean proposal prose lint and approval

**Files:**
- Create: `packages/audits/src/korean-prose.ts`
- Create: `packages/audits/src/repetition.ts`
- Create: `apps/kpp-cli/src/commands/content.ts`
- Create: `packages/audits/test/korean-prose.test.ts`

**Interfaces:**
- Consumes: imported content blocks and project terminology glossary.
- Produces: prose findings and `content-approval.json` only after zero blockers and explicit human approval.

- [ ] **Step 1: Write lint tests for undefined terms and repetition**

```ts
it("blocks an undefined project-specific English acronym", () => {
  const result = lintKoreanProse("AXI 기반의 성과를 측정한다.", glossary);
  expect(result.codes).toContain("KPP_CONTENT_UNDEFINED_TERM");
});
```

- [ ] **Step 2: Run prose tests and verify missing lint failure**

Run: `npm test -- packages/audits/test/korean-prose.test.ts`
Expected: FAIL because lint modules do not exist.

- [ ] **Step 3: Implement deterministic lint rules and approval receipt**

Detect undefined acronyms, banned vague promises, repeated sentence fingerprints, placeholder phrases, and unsupported numerical tokens. Treat style warnings separately from evidence blockers.

- [ ] **Step 4: Run prose and authoring tests**

Run: `npm test -- packages/audits/test/korean-prose.test.ts apps/kpp-cli/test/authoring-bundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit prose governance**

```bash
git add packages/audits apps/kpp-cli
git commit -m "feat: govern Korean proposal prose approval"
```

### Task 5: Semantic figure planner and ImageGen gate

**Files:**
- Create: `packages/core/src/figure-planner.ts`
- Create: `packages/schemas/src/figure-spec.ts`
- Create: `packages/core/src/visual-source-gate.ts`
- Create: `packages/core/test/figure-planner.test.ts`

**Interfaces:**
- Consumes: page intent, data shape, decision task, evidence IDs, and validated visual source packet.
- Produces: typed `FigureSpec` with family and deterministic renderer, or a blocked topology-study request.

- [ ] **Step 1: Write semantic routing tests**

```ts
it("routes milestones to gantt and rejects generic cards", () => {
  expect(planFigure({ intent: "schedule", hasTimeAxis: true }).family).toBe("gantt");
  expect(() => planFigure({ intent: "schedule", requestedFamily: "generic-cards" }))
    .toThrowError(/KPP_DESIGN_FIGURE_FAMILY/);
});
```

- [ ] **Step 2: Run the planner test and verify failure**

Run: `npm test -- packages/core/test/figure-planner.test.ts`
Expected: FAIL because figure planning is absent.

- [ ] **Step 3: Implement semantic routing and topology-study prerequisites**

Require real attached Korean reference pages, rights status, inspected hashes, locked research logic, and `directFinalUse: false` before emitting an ImageGen topology study request.

- [ ] **Step 4: Run figure planning tests**

Run: `npm test -- packages/core/test/figure-planner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit semantic figure planning**

```bash
git add packages/core packages/schemas
git commit -m "feat: select evidence-safe semantic figure families"
```

### Task 6: Content-to-build integration fixture

**Files:**
- Create: `fixtures/valid/minimal-research-proposal/`
- Create: `tests/integration/content-to-build.test.ts`

**Interfaces:**
- Consumes: source lock, confirmed requirements, evidence, Codex-style authoring response, content approval, design profile, and figure specs.
- Produces: a project at `CONTENT_APPROVED` ready for the document pipeline.

- [ ] **Step 1: Write the integration test**

```ts
it("advances a sourced research proposal to CONTENT_APPROVED", async () => {
  const result = await runContentFixture("fixtures/valid/minimal-research-proposal");
  expect(result.state).toBe("CONTENT_APPROVED");
  expect(result.blockers).toEqual([]);
});
```

- [ ] **Step 2: Run the integration test and verify fixture absence failure**

Run: `npm test -- tests/integration/content-to-build.test.ts`
Expected: FAIL because the fixture is absent.

- [ ] **Step 3: Build a sanitized fixture with one table, one Gantt, and pending blanks**

Use synthetic organization facts and clearly labeled sample evidence. Include one noncritical `pending_blank` and no critical `blocked` claim.

- [ ] **Step 4: Run all content and core tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit the generation spine**

```bash
git add fixtures/valid/minimal-research-proposal tests/integration
git commit -m "test: verify source-bounded content generation flow"
```

