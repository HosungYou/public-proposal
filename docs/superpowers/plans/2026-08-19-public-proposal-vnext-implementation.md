# Public Proposal vNext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public Proposal을 하나의 사용자 진입점으로 만들고, 별도 LongTable이 조건부 연구·데이터·근거 bundle을 제공하며, 긍정적 작성 원칙·대표 섹션 인간 승인·결정론적 도식 QA·KPP receipt가 연결되는 검증 가능한 vNext vertical slice를 구현한다.

**Architecture:** Public Proposal router는 사용자 요청을 proposal class, reader task, risk와 현재 Living Proposal Brief로 분류하고 필요한 역할만 호출한다. LongTable은 `@longtable/proposal-research-contracts`를 통해 Research Request를 받고 Evidence/Data Bundle을 반환하며, KPP만 프로젝트 상태·receipt·build·audit·approval·release를 변경한다. 작성 agent와 reviewer agent는 hash-bound packet과 구조화된 finding만 교환하고, Proposal Editor와 인간 대표 섹션 게이트가 정본 변경을 승인한다.

**Tech Stack:** Node.js `>=22 <27`, TypeScript 7, Zod 4, Commander 15, Vitest 4, npm workspaces, existing KPP core/audits/renderers, existing Python DOCX worker, Codex plugin manifests, LongTable TypeScript packages.

**Spec:**
- `docs/superpowers/specs/2026-08-19-public-proposal-vnext-design.md`
- `docs/superpowers/specs/2026-08-19-proposal-research-bridge-design.md`
- `docs/superpowers/specs/2026-08-19-proposal-living-brief-policy-design.md`
- `docs/superpowers/specs/2026-08-19-proposal-section-agent-workflow-design.md`
- `docs/superpowers/specs/2026-08-19-visual-evidence-compiler-design.md`
- `docs/superpowers/specs/2026-08-19-public-proposal-install-migration-eval-design.md`

## Global Constraints

- Preserve the current `@longtable/public-proposal@0.1.3`, `@longtable/kpp-cli@0.2.1`, and `@longtable/cli@0.1.72` behavior until the vNext beta gate passes.
- Keep the runtime floor at Node `>=22 <27`; all new package dependencies use exact versions and never `latest`, caret, or tilde ranges.
- Expose one Public Proposal user skill and two LongTable user skills (`LongTable`, `LongTable Research`); do not copy LongTable role skills into the Public Proposal top-level skill surface.
- Public Proposal owns routing and structured input; LongTable owns research execution and bundles; KPP owns state, receipts, build, audit, approval, and release; reviewers cannot write proposal source or receipts.
- Use the six positive Proposal Design Doctrine sentences for authoring packets; keep anti-patterns and rejected artifacts in reviewer fixtures only.
- Do not promote a document beyond `HUMAN_APPROVED` or `RELEASED` without named human approval; technical PASS is never submission readiness.
- Require human approval of three representative sections before full-document authoring.
- Keep raw source, normalized data, derived transformations, claims, and figures hash-linked; unsupported institution facts and wrong-institution transfers are zero-tolerance failures.
- LongTable is conditional: general procurement without an academic evidence slot must produce zero LongTable research invocations.
- Preserve `.longtable`, customer files, existing KPP projects, and externally owned LongTable installations during setup, update, adopt, rollback, and uninstall.
- Private KEITI and customer sources stay outside public npm/GitHub artifacts; public fixtures use synthetic or independently reconstructed data.
- Every task ends with a focused test, a typecheck/build where applicable, `git diff --check`, and a small commit that does not include unrelated worktree files.

---

## File Map and Ownership

| Unit | Files | Responsibility |
| --- | --- | --- |
| Shared research contracts | `packages/proposal-research-contracts/` | Pure Zod schemas, inferred types, canonical serialization, no network or KPP state |
| Proposal schemas | `packages/schemas/src/{living-brief,section-plan,review-finding,policy}.ts` | Persisted proposal brief, decisions, section plans, findings, and positive profiles |
| KPP state | `packages/core/src/{state-machine,brief-store,policy,section-workflow,research-bundle,run-store}.ts` | Locks, transitions, invalidation, receipt inputs, and immutable runs |
| Research CLI bridge | `apps/kpp-cli/src/commands/{research-request,research-import,adopt}.ts` and `apps/kpp-cli/src/research-bridge.ts` | Request creation, bundle validation/import, and legacy project adoption |
| Public Proposal router | `apps/public-proposal-cli/src/{router,agent-policy,section-authoring}.ts` and plugin skill copies | User-facing routing, trigger policy, and packet generation |
| LongTable adapter | LongTable canonical worktree `packages/longtable-scholar-research/src/proposal-bridge.ts`, `packages/longtable-research-search/src/proposal-bridge.ts`, `packages/longtable/src/personas.ts` | Executes the contract, assembles bundle, and routes internal research roles |
| Visual compiler | `packages/renderers/src/{visual-evidence-compiler,figure-specs}.ts`, `packages/audits/src/visual-evidence.ts` | Semantic figure IR, deterministic rendering, and independent QA |
| Installer | `apps/public-proposal-cli/src/{commands/setup,doctor,update,uninstall}.ts`, `src/contracts.ts`, plugin assets | Two-plugin registration, ownership, migration, rollback, and doctor |
| Evaluation/release | `fixtures/benchmarks/`, `scripts/verify_public_proposal_release.mjs`, `tests/e2e/`, `tests/integration/` | A/B/C benchmark, isolated fixtures, beta gate, and release evidence |

---

### Task 1: Publish the Shared Proposal Research Contract

**Files:**
- Create: `packages/proposal-research-contracts/package.json`
- Create: `packages/proposal-research-contracts/tsconfig.json`
- Create: `packages/proposal-research-contracts/src/index.ts`
- Create: `packages/proposal-research-contracts/src/schemas.ts`
- Create: `packages/proposal-research-contracts/test/contracts.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: proposal class and identifier conventions from `packages/schemas/src/project.ts` and existing SHA-256 receipt conventions.
- Produces: `ProposalResearchRequestV1`, `EvidenceDataBundleV1`, `SourceRecordV1`, `NormalizedDatasetV1`, `TransformationLineageV1`, `ClaimCandidateV1`, `SemanticFigureSpecV1`, `ResearchGapV1`, `parseCanonicalJson(value)`, and `sha256Canonical(value)`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { EvidenceDataBundleV1Schema, ProposalResearchRequestV1Schema, sha256Canonical } from "../src/index.js";

describe("proposal research contracts", () => {
  it("accepts a request with explicit institution, field, source, and artifact boundaries", () => {
    const result = ProposalResearchRequestV1Schema.safeParse({
      schemaVersion: "proposal-research-request/v1",
      requestId: "req-1",
      projectId: "project-1",
      proposalClass: "research_service",
      requirementIds: ["req-1"],
      institution: { canonicalName: "기관 A", aliases: [], identifiers: { alio: "A" } },
      questions: [{ questionId: "q-1", text: "무엇을 비교하는가?", requiredDataFieldIds: ["field-1"] }],
      requiredData: [{ fieldId: "field-1", definition: "연도별 건수", period: "2021-2025", unit: "건", grain: "year", required: true, allowedSourceClasses: ["official"] }],
      sourcePriority: ["user_provided", "institution_official", "alio", "scholarly_fulltext"],
      targetArtifacts: ["claim", "figure"],
      budgets: { fullPass: 1, deltaPasses: 2 },
      privacyClass: "PUBLIC",
    });
    expect(result.success).toBe(true);
  });

  it("changes the canonical hash when a lineage field changes", () => {
    expect(sha256Canonical({ a: 1 })).not.toBe(sha256Canonical({ a: 2 }));
  });

  it("rejects a bundle with an untraceable figure point", () => {
    const result = EvidenceDataBundleV1Schema.safeParse({
      schemaVersion: "proposal-evidence-bundle/v1",
      bundleId: "bundle-1", requestId: "req-1", contractVersion: "1.0.0",
      files: [], sources: [], datasets: [], transformations: [], claims: [], figures: [{ figureId: "fig-1", dataIds: ["missing"] }], gaps: [], status: "complete",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- packages/proposal-research-contracts/test/contracts.test.ts`

Expected: FAIL because the workspace package and schemas do not yet exist.

- [ ] **Step 3: Implement strict schemas and canonical hashing**

Define every identifier, SHA-256, source class, privacy class, artifact target, data field, source, dataset, transformation, claim, figure, and gap as strict Zod objects. `sha256Canonical` must sort object keys recursively, preserve array order, UTF-8 encode the resulting JSON without a trailing newline, and return lowercase hexadecimal SHA-256. The package must not import `@longtable/kpp-core`, read files, spawn commands, or access the network.

- [ ] **Step 4: Register the workspace package and exact build surface**

Add `packages/proposal-research-contracts` to the root workspace and build/typecheck order. Pin its only runtime dependency to the repository's current Zod version. Export schemas and inferred types from `src/index.ts`, and expose `dist/index.js` plus declaration output in `package.json`.

- [ ] **Step 5: Run focused tests, typecheck, and package inspection**

Run: `npm test -- packages/proposal-research-contracts/test/contracts.test.ts && npm run typecheck && npm run build --workspace @longtable/proposal-research-contracts && npm pack --workspace @longtable/proposal-research-contracts --dry-run`

Expected: all contract tests pass, declarations build, and the dry-run contains only `dist`, `README.md`, and package metadata.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json packages/proposal-research-contracts
git commit -m "feat: add proposal research contract package"
```

### Task 2: Add Living Brief, Positive Policy, and vNext State

**Files:**
- Create: `packages/schemas/src/living-brief.ts`
- Create: `packages/schemas/src/section-plan.ts`
- Create: `packages/schemas/src/review-finding.ts`
- Create: `packages/schemas/src/policy.ts`
- Create: `packages/core/src/brief-store.ts`
- Create: `packages/core/src/policy.ts`
- Create: `packages/core/test/brief-policy.test.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/schemas/src/project.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/state-machine.ts`
- Modify: `packages/core/src/receipts.ts`
- Modify: `packages/core/test/state-machine.test.ts`

**Interfaces:**
- Consumes: `DecisionRecordV1`, `LivingProposalBriefV1`, `SectionPlanV1`, `ReviewerFindingV1` from the new schema modules and existing atomic JSON/receipt helpers.
- Produces: `lockLivingBrief(root, brief)`, `readLivingBrief(root)`, `recordDecisionAcceptance(input)`, `resolveDecisionScope(input)`, `diffBrief(previous, next)`, and state transitions through `BRIEF_LOCKED`, `RESEARCH_LOCKED`, `DESIGN_LOCKED`, `REPRESENTATIVE_REVIEW_REQUIRED`, and `REPRESENTATIVE_APPROVED`.

- [ ] **Step 1: Write failing state and policy tests**

```ts
it("does not treat a bare acceptance as approval of two decisions", async () => {
  const result = recordDecisionAcceptance({ turnText: "응", presentedDecisionIds: ["decision-1", "decision-2"] });
  expect(result.ok).toBe(false);
  expect(result.code).toBe("PP_DECISION_ACCEPTANCE_AMBIGUOUS");
});

it("requires representative approval before content approval", async () => {
  await expect(advanceProject(root, "CONTENT_APPROVED")).rejects.toMatchObject({ code: "KPP_STATE_INVALID_TRANSITION" });
});

it("locks a brief with its doctrine, active decisions, and input hash", async () => {
  const receipt = await lockLivingBrief(root, validBrief);
  expect(receipt.stage).toBe("BRIEF_LOCKED");
  expect(receipt.inputs).toContainEqual(expect.objectContaining({ name: "brief" }));
});
```

- [ ] **Step 2: Run the tests and verify the expected failures**

Run: `npm test -- packages/core/test/brief-policy.test.ts packages/core/test/state-machine.test.ts`

Expected: FAIL because the new schemas, lock functions, and states are not implemented.

- [ ] **Step 3: Implement strict brief and decision schemas**

Implement the exact fields from the approved spec. `DecisionRecordV1.scope` is `global | proposal_family | project | document | temporary`; statuses are `active | superseded | expired`. A short `응`, `수용`, or `제안대로` may bind only to one immediately presented decision ID. `diffBrief` must report only `confirmed`, `changed`, `stillOpen`, `invalidatedDownstream`, and `nextHumanGate`.

- [ ] **Step 4: Extend the state machine without weakening legacy receipts**

Add the new states in order while retaining legacy `EVIDENCE_LOCKED` compatibility through an explicit migration adapter. Add receipt filenames for `brief-lock.json`, `research-bundle-lock.json`, `design-lock.json`, `representative-review.json`, and `representative-approval.json`. Verify predecessor receipt hashes exactly as the existing chain does, and invalidate only the earliest affected stage when a brief, source, bundle, or section hash changes.

- [ ] **Step 5: Implement positive policy resolution**

Implement authority order `issuer rule -> explicit current project decision -> approved proposal-family profile -> approved reference pattern -> plugin default`. Reject issuer conflicts unless the current project contains an explicit exception. Never auto-promote project decisions to family or global scope; require a human-approved promotion receipt.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- packages/core/test/brief-policy.test.ts packages/core/test/state-machine.test.ts packages/schemas/test/schemas.test.ts && npm run typecheck`

Expected: all new state/policy tests and existing schema/state tests pass, with no receipt-chain regression.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas packages/core
git commit -m "feat: add living brief and positive proposal policy"
```

### Task 3: Implement the Research Bridge and LongTable Handoff

**Files:**
- Create: `apps/kpp-cli/src/research-bridge.ts`
- Create: `apps/kpp-cli/src/commands/research-request.ts`
- Create: `apps/kpp-cli/src/commands/research-import.ts`
- Create: `apps/kpp-cli/test/research-bridge.test.ts`
- Modify: `apps/kpp-cli/src/main.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/research-lock.ts`
- Modify: `tests/integration/content-to-build.test.ts`
- Companion LongTable worktree (fresh branch from canonical upstream): `packages/longtable-scholar-research/src/proposal-bridge.ts`, `packages/longtable-research-search/src/proposal-bridge.ts`, `packages/longtable/src/personas.ts`, `packages/longtable-mcp/src/server.ts`, and their package tests.

**Interfaces:**
- Consumes: `ProposalResearchRequestV1` and the existing KPP research-lock import boundary.
- Produces: `createResearchRequest(root, options)`, `routeResearch(input)`, `importEvidenceBundle(root, bundlePath)`, `validateBundleLineage(bundle)`, and LongTable `runProposalResearch(request): Promise<EvidenceDataBundleV1>`.

- [ ] **Step 1: Write failing request/import tests**

```ts
it("routes an academic request to LongTable and records the bundle hash", async () => {
  const request = await createResearchRequest(root, validRequestOptions);
  expect(request.sourcePriority[0]).toBe("user_provided");
  const imported = await importEvidenceBundle(root, fixturePath);
  expect(imported.bundleHash).toMatch(/^[a-f0-9]{64}$/);
  expect(imported.researchReceiptHash).toMatch(/^[a-f0-9]{64}$/);
});

it("runs no LongTable call for ordinary general procurement", async () => {
  const result = await routeResearch({ proposalClass: "general_procurement", academicEvidence: false });
  expect(result.invocations).toEqual([]);
});

it("requires a valid official source or an explicit unresolved gap", async () => {
  await expect(importEvidenceBundle(root, unsupportedInstitutionFixture)).rejects.toMatchObject({ code: "PP_REQUIRED_DATA_GAP" });
});
```

- [ ] **Step 2: Run focused tests to capture RED**

Run: `npm test -- apps/kpp-cli/test/research-bridge.test.ts tests/integration/content-to-build.test.ts`

Expected: FAIL because no request command, bundle validator, or public-proposal contract handoff exists.

- [ ] **Step 3: Implement KPP request and bundle validation**

Build requests from locked requirements, institution identity, required fields, target claims/figures, source priority, and `{ fullPass: 1, deltaPasses: 2 }`. Validate file hashes, source authority, entity identity, time/unit/grain compatibility, transformation lineage, open critical gaps, and scholarly handoff requirements. Import only `SUCCEEDED` bundles and bind the exact bundle/research-lock hash into content approval inputs.

- [ ] **Step 4: Implement the LongTable adapter on a fresh canonical branch**

Do not modify the dirty `LongTable-critical-interview-removal` checkout in place. In a fresh LongTable worktree, add the adapter at the paths listed above. Route internal roles `Institutional Source Scout`, `Entity Resolver`, `Data Extractor`, `Data Quality Auditor`, `Indicator Operationalizer`, `Evidence Synthesizer`, `Figure Specification Agent`, and `Interpretation Critic` behind one accountable synthesis. Return raw, normalized, derived, claim, figure, gap, and handoff files with hashes. Keep `SECRET` and restricted proof out of the bundle.

- [ ] **Step 5: Add bounded search and data-operation policies**

Permit only formatting, sums, averages, explicit-denominator ratios, growth rates, and official-category aggregation automatically. Require reviewer approval for comparison selection, period bucketing, multi-source joins, and interpretation drafts. Require human approval for maturity scores, arbitrary weighted indices, causality, forecasts, targets, and institutional rankings. After one full pass, request only missing fields in at most two delta passes; repeated unresolved gaps create a researcher checkpoint.

- [ ] **Step 6: Expose KPP CLI commands and migration-safe import**

Add `kpp research-request <root> --requirements <path> --json` and `kpp research-import <root> --bundle <path> --json`. Preserve the legacy `research-lock --handoff` path and map old handoffs to the new bundle adapter without rewriting `.longtable` files.

- [ ] **Step 7: Run both repositories' focused tests and integration checks**

Run in KPP: `npm test -- apps/kpp-cli/test/research-bridge.test.ts packages/core/test/research-lock.test.ts tests/integration/content-to-build.test.ts && npm run typecheck`.

Run in LongTable fresh worktree: `npm test`, then `npm run typecheck`. The current LongTable repository's `npm test` script builds all workspaces and runs its smoke suite; the implementation must add a proposal-bridge smoke fixture so this command exercises the new handoff.

Expected: official-source fixture imports, academic/policy research locks, conditional general procurement, and zero-invocation ordinary procurement all pass.

- [ ] **Step 8: Commit each repository independently**

```bash
# KPP
git add apps/kpp-cli packages/core tests/integration
git commit -m "feat: add proposal research bridge"

# LongTable fresh worktree
git add packages/longtable-scholar-research packages/longtable-research-search packages/longtable packages/longtable-mcp
git commit -m "feat: add public proposal research handoff"
```

### Task 4: Add Section-Centered Authoring and Automatic Reviewer Routing

**Files:**
- Create: `apps/public-proposal-cli/src/agent-policy.ts`
- Create: `apps/public-proposal-cli/src/section-authoring.ts`
- Create: `apps/public-proposal-cli/test/agent-policy.test.ts`
- Create: `apps/public-proposal-cli/test/section-authoring.test.ts`
- Modify: `apps/public-proposal-cli/src/main.ts`
- Modify: `apps/public-proposal-cli/plugin/skills/public-proposal/SKILL.md`
- Modify: `plugins/public-proposal/skills/public-proposal/SKILL.md`
- Modify: `apps/kpp-cli/src/commands/export-authoring.ts`
- Modify: `apps/kpp-cli/src/commands/import-authoring.ts`
- Modify: `packages/schemas/src/authoring-bundle.ts`

**Interfaces:**
- Consumes: `LivingProposalBriefV1`, `SectionPlanV1`, `ReviewerFindingV1`, research bundle IDs, and proposal class/risk.
- Produces: `selectAgentProfile(input)`, `buildAgentPacket(input)`, `createSectionPlan(input)`, `mergeApprovedPatch(source, patch)`, `adjudicate(input)`, `authorFullDocument(root)`, and `approveRepresentativeSections(root, approvals)`.

- [ ] **Step 1: Write failing routing and gate tests**

```ts
it("selects only compliance and architect for quick ordinary procurement", () => {
  const plan = selectAgentProfile({ proposalClass: "general_procurement", risk: "low", hasFigure: false, representative: false });
  expect(plan.roles).toEqual(["Proposal Architect", "RFP/Compliance Reviewer"]);
  expect(plan.longtable).toBe(false);
});

it("requires two independent editorial findings before a prose hold", () => {
  const decision = adjudicate({ findings: [proseFinding("section-1"), evaluatorFinding("section-1")] });
  expect(decision.status).toBe("EDITORIAL_REVIEW_REQUIRED");
});

it("blocks full authoring until all three representative roles are approved", async () => {
  await expect(authorFullDocument(root)).rejects.toMatchObject({ code: "PP_REPRESENTATIVE_APPROVAL_REQUIRED" });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- apps/public-proposal-cli/test/agent-policy.test.ts apps/public-proposal-cli/test/section-authoring.test.ts`

Expected: FAIL because routing, section plans, and representative approval are not implemented.

- [ ] **Step 3: Implement the positive authoring packet and trigger matrix**

Provide the six doctrine sentences, reader tasks, section purpose, allowed claim/evidence IDs, open decisions, two or three approved references, and family profile to the writer. Add triggers for compliance/architect on every proposal; methods/evidence for research or policy; institutional data for institution facts; prose/evaluator for representatives; visual for figures/tables; privacy for qualification/PII; and fresh-context submission review at release. Cap concurrency at 3/6/10 for quick/standard/deep, rebuttals at one, automatic section revisions at two, and agent runs per stage at twelve.

- [ ] **Step 4: Separate section authoring from page metadata**

Persist `SectionPlanV1` with purpose, reader tasks, requirements, claims, evidence, argument moves, visual needs, open decisions, and representative role. Keep page breaks, page IDs, and evaluator-answer metadata out of the new authoring response; preserve the legacy adapter for v0.1.3 inputs.

- [ ] **Step 5: Implement read-only packets, findings, and adjudication**

Include input hash, allowed purpose, redacted context, output directory, and security class in every packet. Reviewer output must contain `findingId`, artifact hash, target, authority class, severity, reader impact, evidence, patch proposal, confidence, and dependencies. Only Proposal Editor can apply a patch. One directed cross-review and one rebuttal are allowed before an adjudication receipt records accept, modify, or reject.

- [ ] **Step 6: Implement representative human gate and recovery**

Generate problem, method, and execution representative sections with rendered page context. Require independent prose, evaluator, compliance, evidence, and visual findings, then named human approval for all three. Quarantine partial/timeout runs and invalidate only findings whose input hash changed.

- [ ] **Step 7: Update both plugin skill copies and run focused tests**

The two `public-proposal/SKILL.md` copies must describe one user surface, automatic routing, positive doctrine, and the human gate. They must not expose LongTable legacy role skills. Run: `npm test -- apps/public-proposal-cli/test/agent-policy.test.ts apps/public-proposal-cli/test/section-authoring.test.ts apps/kpp-cli/test/authoring-bundle.test.ts tests/plugin/korean-skill-bundle.test.ts && npm run typecheck`.

- [ ] **Step 8: Commit**

```bash
git add apps/public-proposal-cli apps/kpp-cli/src/commands/{export-authoring,import-authoring}.ts packages/schemas/src/authoring-bundle.ts plugins/public-proposal/skills/public-proposal apps/public-proposal-cli/plugin/skills/public-proposal
git commit -m "feat: add section authoring and automatic review routing"
```

### Task 5: Implement the Visual Evidence Compiler and Independent QA

**Files:**
- Create: `packages/renderers/src/visual-evidence-compiler.ts`
- Create: `packages/renderers/src/figure-specs.ts`
- Create: `packages/renderers/test/visual-evidence-compiler.test.ts`
- Create: `packages/audits/src/visual-evidence.ts`
- Create: `packages/audits/test/visual-evidence.test.ts`
- Modify: `packages/renderers/src/index.ts`
- Modify: `packages/renderers/src/types.ts`
- Modify: `packages/schemas/src/figure-spec.ts`
- Modify: `packages/audits/src/index.ts`
- Modify: `apps/kpp-cli/src/commands/audit.ts`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/references/figure-grammar.md`
- Modify: `apps/public-proposal-cli/plugin/skills/korean-public-proposal/references/figure-grammar.md`

**Interfaces:**
- Consumes: evidence bundle data IDs, `SemanticFigureSpecV1`, approved reference bindings, and renderer version.
- Produces: `compileFigure(spec, data, references): Promise<FigureArtifact>`, `auditFigureSemantics(input): FigureAuditReport`, and byte-stable SVG/PNG artifacts with source/data/claim lineage.

- [ ] **Step 1: Write failing deterministic and QA tests**

```ts
it("renders the same spec and data to the same SVG hash", async () => {
  const first = await compileFigure(validSpec, validData, validReferences);
  const second = await compileFigure(validSpec, validData, validReferences);
  expect(first.sha256).toBe(second.sha256);
});

it("blocks a line chart with fewer than eight temporal observations", () => {
  const report = auditFigureSemantics({ ...validFigure, data: shortSeries });
  expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_SAMPLE_INSUFFICIENT" }));
});

it("blocks a plotted point without raw-source lineage", () => {
  const report = auditFigureSemantics({ ...validFigure, lineage: [] });
  expect(report.status).toBe("BLOCKED");
});
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- packages/renderers/test/visual-evidence-compiler.test.ts packages/audits/test/visual-evidence.test.ts`

Expected: FAIL because vNext semantic fields, compiler, and independent audit do not exist.

- [ ] **Step 3: Extend the semantic figure schema without breaking legacy families**

Add analytical question, reader task, supported takeaway, data IDs, relationship, minimum data conditions, uncertainty, source caption, target surface, reference family, renderer version, and human approval status. Keep legacy Gantt/RACI/matrix/framework mappings valid and reject intent/data-shape/family/renderer mismatches.

- [ ] **Step 4: Implement the canonical intermediate representation and six beta families**

Render time trend, comparison, composition, requirement matrix, process, and research framework from declarative data. Candidate topology generation may return two or three logically distinct specs, but final labels, Korean text, values, scale, node/edge relationships, captions, and evidence IDs must come from the structured spec. Use deterministic SVG/PNG output with stable ordering and renderer version in the artifact hash.

- [ ] **Step 5: Implement governed references and independent audit**

Accept private source references, extracted visual patterns, or public synthetic fixtures with rights, source hash, page locator, and transfer boundary. Audit source/data mismatch, units, denominators, scale, sample sufficiency, label collision, clipping, contrast, grayscale, A4 footprint, caption, section callout, repeated geometry, and lineage. The compiler cannot approve its own final figure.

- [ ] **Step 6: Add human representative Figure approval**

Render each representative figure in final A4 page context and require pairwise human approval for meaning, trustworthiness, document fit, and send-ready usability before `human_approved` and KPP figure lock.

- [ ] **Step 7: Run visual, audit, and existing regression suites**

Run: `npm test -- packages/renderers/test/visual-evidence-compiler.test.ts packages/audits/test/visual-evidence.test.ts packages/core/test/figure-planner.test.ts packages/audits/test/audits.test.ts && npm run typecheck && git diff --check`.

Expected: new determinism/lineage tests and existing figure-family/audit tests pass; known bad C11 fixtures remain blocked.

- [ ] **Step 8: Commit**

```bash
git add packages/renderers packages/audits packages/schemas/src/figure-spec.ts apps/kpp-cli/src/commands/audit.ts plugins/public-proposal/skills/korean-public-proposal/references/figure-grammar.md apps/public-proposal-cli/plugin/skills/korean-public-proposal/references/figure-grammar.md
git commit -m "feat: add deterministic visual evidence compiler"
```

### Task 6: Add Adopt and Lossless Legacy Migration

**Files:**
- Create: `apps/kpp-cli/src/commands/adopt.ts`
- Create: `packages/core/src/adoption.ts`
- Create: `packages/core/test/adoption.test.ts`
- Create: `tests/integration/adopt.test.ts`
- Modify: `apps/kpp-cli/src/main.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/public-proposal-cli/src/commands/update.ts`
- Modify: `apps/public-proposal-cli/src/commands/setup.ts`
- Modify: `apps/public-proposal-cli/src/commands/uninstall.ts`
- Modify: `apps/public-proposal-cli/src/contracts.ts`

**Interfaces:**
- Consumes: an existing project directory, source packet, working master, ledgers, `.longtable` run metadata, and existing installer manifest.
- Produces: `adoptProject(input): Promise<AdoptionReport>`, `UNMANAGED_DRAFT` project state, source/claim/figure ledger bindings, and idempotent migration receipts.

- [ ] **Step 1: Write failing preservation and adoption tests**

```ts
it("adopts an existing draft without creating content approval", async () => {
  const result = await adoptProject({ root: legacyRoot, outputRoot: projectRoot });
  expect(result.state).toBe("UNMANAGED_DRAFT");
  expect(await exists(join(projectRoot, "content-approval.json"))).toBe(false);
});

it("preserves external LongTable registration and customer files during update", async () => {
  await runSetupWithExternalLongTable();
  await runUpdate({ apply: true });
  expect(await readFile(externalLongTableMarker)).toBe(original);
  expect(await readFile(customerFile)).toBe(originalCustomerBytes);
});

it("can retry a partially completed migration without duplicating registration", async () => {
  await expect(runUpdate({ apply: true })).rejects.toMatchObject({ code: "PP_SETUP_ROLLBACK_FAILED" });
  const retry = await runUpdate({ apply: true });
  expect(retry.manifest?.codexRegistrations).toEqual(expectedOwnership);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- packages/core/test/adoption.test.ts tests/integration/adopt.test.ts apps/public-proposal-cli/test/uninstall-update.test.ts`

Expected: FAIL because `adopt`, explicit ownership reconciliation, and new state are not implemented.

- [ ] **Step 3: Implement lossless adopt**

Identify RFP/source packet/working master candidates, import claim/evidence/figure ledgers, link old LongTable runs, mark source-less content provisional, create a Living Brief candidate and decision diff, and stop at `UNMANAGED_DRAFT`. Never infer human approval or release state.

- [ ] **Step 4: Harden installer ownership and registration reconciliation**

Record exact plugin/marketplace source and path ownership. On update, snapshot receipt, registration, and owned-file hashes; add only missing registrations; validate LongTable doctor; remove only Public Proposal-owned legacy role copies; atomically write the new receipt. On failure, compensate only additions from the current invocation. On uninstall, deregister only source-verified owned entries, preserve unrelated registrations, restore registration on cleanup failure, and fail closed if restoration fails.

- [ ] **Step 5: Add migration commands and documentation contract**

Expose `kpp adopt <root> --source <path> --master <path> --json`, and document user/project scope conflict, external ownership, `.longtable` preservation, and retry behavior in root README, package README, and `docs/INSTALL.md`.

- [ ] **Step 6: Run tests, typecheck, build, and commit**

Run: `npm test -- packages/core/test/adoption.test.ts tests/integration/adopt.test.ts apps/public-proposal-cli/test/setup.test.ts apps/public-proposal-cli/test/uninstall-update.test.ts apps/public-proposal-cli/test/doctor.test.ts && npm run typecheck && npm run build && git diff --check`.

```bash
git add apps/kpp-cli apps/public-proposal-cli packages/core tests/integration README.md apps/public-proposal-cli/README.md docs/INSTALL.md
git commit -m "feat: add lossless project adoption and migration"
```

### Task 7: Install the Two-Plugin Surface and Remove Legacy Top-Level Skills

**Files:**
- Modify: `apps/public-proposal-cli/plugin/.codex-plugin/plugin.json`
- Modify: `apps/public-proposal-cli/marketplace/marketplace.json`
- Modify: `apps/public-proposal-cli/plugin/skills/public-proposal/SKILL.md`
- Modify: `apps/public-proposal-cli/plugin/skills/korean-public-proposal/SKILL.md`
- Modify: `apps/public-proposal-cli/marketplace/plugin/skills/`
- Modify: `plugins/public-proposal/.codex-plugin/plugin.json`
- Modify: `plugins/public-proposal/marketplace/marketplace.json`
- Modify: `plugins/public-proposal/skills/public-proposal/SKILL.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/SKILL.md`
- Create: LongTable canonical plugin manifest and skill surface in its fresh worktree: `.codex-plugin/plugin.json`, marketplace entry, `skills/longtable/SKILL.md`, `skills/longtable-research/SKILL.md`.
- Modify: `apps/public-proposal-cli/src/commands/doctor.ts`
- Modify: `apps/public-proposal-cli/test/doctor.test.ts`
- Modify: `tests/plugin/korean-skill-bundle.test.ts`

**Interfaces:**
- Consumes: installer ownership model from Task 6 and LongTable contract package from Task 1/3.
- Produces: clean install that registers `public-proposal@public-proposal` and `longtable@longtable`, with visible user surfaces `Public Proposal`, `LongTable`, and `LongTable Research` only.

- [ ] **Step 1: Write failing clean-install and surface tests**

```ts
it("installs two independent Codex registrations from one setup invocation", async () => {
  const result = await runSetupInCleanHome();
  expect(result.manifest?.codexRegistrations).toEqual({ pluginAdded: true, marketplaceAdded: true });
  expect(await codexSkills()).toEqual(["korean-public-proposal", "public-proposal", "longtable", "longtable-research"]);
});

it("does not expose LongTable legacy role names as installed user skills", async () => {
  expect(await installedSkillNames()).not.toContain("longtable-theory");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- apps/public-proposal-cli/test/doctor.test.ts tests/plugin/korean-skill-bundle.test.ts tests/e2e/public-proposal-install.test.ts`

Expected: FAIL until the LongTable plugin registration, discovery checks, and new surface are packaged.

- [ ] **Step 3: Package the independent plugin manifests and exact skill copies**

Public Proposal plugin contains one user-facing `public-proposal` skill and the Korean proposal skill. LongTable plugin contains only `longtable` and `longtable-research` user-facing skills; role lenses remain internal. Setup must register each plugin independently and never duplicate LongTable role files under Public Proposal.

- [ ] **Step 4: Strengthen doctor and release manifest checks**

Doctor must verify both plugin manifests, marketplace source paths, exact skill discovery, contract package version, KPP/LongTable versions, worker, runtime, and legacy conflicts as separate checks. A technical pass must not be reported as effectiveness or release readiness.

- [ ] **Step 5: Run isolated clean-home tests and commit**

Run: `npm test -- apps/public-proposal-cli/test/doctor.test.ts tests/plugin/korean-skill-bundle.test.ts tests/e2e/public-proposal-install.test.ts && npm run typecheck && npm run build && git diff --check`.

```bash
git add apps/public-proposal-cli plugins/public-proposal tests/plugin tests/e2e
git commit -m "feat: install Public Proposal and LongTable as independent plugins"
```

### Task 8: Build the Three-Arm Effectiveness Benchmark

**Files:**
- Create: `fixtures/benchmarks/research-service/manifest.json`
- Create: `fixtures/benchmarks/policy-research/manifest.json`
- Create: `fixtures/benchmarks/general-procurement/manifest.json`
- Create: `fixtures/benchmarks/shared/synthetic-sources/institutions.json`
- Create: `fixtures/benchmarks/shared/synthetic-sources/requirements.json`
- Create: `fixtures/benchmarks/shared/synthetic-sources/series.csv`
- Create: `tests/benchmark/proposal-effectiveness.test.ts`
- Create: `scripts/run_proposal_benchmark.mjs`
- Create: `scripts/score_proposal_benchmark.mjs`
- Modify: `scripts/verify_public_proposal_release.mjs`
- Modify: `tests/e2e/public-proposal-install.test.ts`
- Modify: `README.md`
- Create: `docs/BENCHMARKING.md`

**Interfaces:**
- Consumes: current 0.1.3 workflow, vNext router, conditional research bridge, structured reviewer agents, and synthetic fixtures.
- Produces: raw arm outputs, anonymized evaluator packets, scores, cost report, and `effectivenessValidated` status.

- [ ] **Step 1: Write failing benchmark contract tests**

```ts
it("uses identical input and bounded budgets for all arms", async () => {
  const report = await runBenchmark({ fixture: "research-service", arms: ["A", "B", "C"], seeds: [1, 2, 3] });
  expect(new Set(report.arms.map((arm) => arm.inputHash)).size).toBe(1);
  expect(report.arms.every((arm) => arm.timeBudgetMinutes === 45)).toBe(true);
});

it("keeps unsupported institution claims at zero in a passing arm", () => {
  expect(scoreArm(validArm).unsupportedInstitutionClaims).toBe(0);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/benchmark/proposal-effectiveness.test.ts`

Expected: FAIL because benchmark fixtures, runner, and score schema do not exist.

- [ ] **Step 3: Create synthetic, source-traceable benchmark packets**

Provide three fixed classes: institution-data research service, academic/policy research, and ordinary general procurement/document restyle. Each packet declares reader tasks, requirements, source hashes, permitted data operations, target claims, and target figure questions. Keep real KEITI and customer material in private benchmark storage only.

- [ ] **Step 4: Implement A/B/C runner with blind output IDs**

Arm A uses the current 0.1.3 flow, Arm B uses vNext with conditional LongTable, and Arm C adds structured reviewer agents. Fix model capability tier, input, time/token/tool-call budgets, and seeds. Run problem/method/execution representatives first; expand only passing arms to full documents.

- [ ] **Step 5: Implement scoring and human evaluation packet**

Score requirement direct-answer coverage, supported-claim precision, unsupported institution claims, source/page traceability, evaluator usefulness, Korean naturalness, research/operations logic, send-ready rate, human revision burden, wall time, tool calls, duplicate artifacts, and unused research. Collect blind Owner, Procurement, and Research/Editorial pairwise judgments. AI scores are calibration only.

- [ ] **Step 6: Enforce promotion thresholds**

Require composite human improvement of at least 10%, no core-dimension regression of 5 percentage points or more, zero wrong-institution transfer, zero unsupported institution claim, 100% mandatory claim traceability, 100% figure lineage, wall time increase no greater than 25%, and zero LongTable invocation for the no-research fixture.

- [ ] **Step 7: Run benchmark, preserve raw evidence, and commit**

Run: `node scripts/run_proposal_benchmark.mjs --fixture-set fixtures/benchmarks --out .artifacts/benchmark && node scripts/score_proposal_benchmark.mjs --input .artifacts/benchmark --output .artifacts/benchmark/report.json && npm test -- tests/benchmark/proposal-effectiveness.test.ts`.

Do not commit private output or evaluator identity. Commit only synthetic fixtures, schemas, runner, scorer, and documentation.

```bash
git add fixtures/benchmarks tests/benchmark scripts/run_proposal_benchmark.mjs scripts/score_proposal_benchmark.mjs scripts/verify_public_proposal_release.mjs tests/e2e README.md docs/BENCHMARKING.md
git commit -m "test: add Public Proposal effectiveness benchmark"
```

### Task 9: Beta Release Gate and Documentation

**Files:**
- Modify: `scripts/verify_public_proposal_release.mjs`
- Modify: `tests/e2e/public-proposal-install.test.ts`
- Modify: `README.md`
- Modify: `apps/public-proposal-cli/README.md`
- Modify: `docs/INSTALL.md`
- Create: `docs/VNEXT-BETA.md`
- Create: `.artifacts/public-proposal-vnext-beta-gate.md` as a local, untracked release report.

**Interfaces:**
- Consumes: all previous task artifacts, release report fields, and benchmark report.
- Produces: `makeReleaseReport(input)`, `runReleaseGate(input)`, and separate `localArtifactVerified`, `registryAvailable`, `effectivenessValidated`, and `releaseReady` results; beta dist-tag recommendation; no premature `latest` promotion.

- [ ] **Step 1: Write failing release-gate assertions**

```ts
it("does not call a local artifact release-ready when npm visibility is unavailable", () => {
  expect(makeReleaseReport({ localArtifactVerified: true, registryAvailable: false, effectivenessValidated: true }).releaseReady).toBe(false);
});

it("fails the gate when the general-procurement fixture invokes LongTable", () => {
  expect(runReleaseGate({ researchInvocations: { generalProcurement: 1 } })).toMatchObject({ ok: false, code: "PP_UNEXPECTED_RESEARCH_INVOCATION" });
});
```

- [ ] **Step 2: Run the gate tests and verify RED**

Run: `npm test -- tests/e2e/public-proposal-install.test.ts tests/benchmark/proposal-effectiveness.test.ts`

Expected: FAIL until the release report and two-plugin discovery checks include vNext and benchmark fields.

- [ ] **Step 3: Integrate clean-install, migration, benchmark, and package checks**

The release verifier must run npm clean install, build/typecheck, focused tests, full serial tests, Python tests, tarball integrity, npx dry-run, isolated setup/doctor/uninstall, legacy preservation, conditional research cases, and benchmark report validation. Keep the existing known C11 timeout as a separately reported test result; never silently omit it.

- [ ] **Step 4: Publish beta documentation and command matrix**

Document `npx --yes @longtable/public-proposal setup --provider codex`, `doctor --json`, `update`, `adopt`, and `uninstall`; show that one invocation installs two independent plugins; state global Codex marketplace selector conflicts; distinguish local tarball verification from registry visibility; and describe the three representative-section human gate and research triggers.

- [ ] **Step 5: Run the complete bounded gate**

Run: `npm run verify:public-proposal`.

Expected: the report exits 0 only for local verification, sets `releaseReady: false` when npm registry or human effectiveness evidence is absent, and includes all raw report paths. Run `npm run typecheck`, `npm run build`, `npm test`, and `git diff --check` separately before claiming beta readiness.

- [ ] **Step 6: Commit the release gate and finish with a fresh-context review**

```bash
git add scripts/verify_public_proposal_release.mjs tests/e2e README.md apps/public-proposal-cli/README.md docs/INSTALL.md docs/VNEXT-BETA.md
git commit -m "test: gate Public Proposal vNext beta release"
```

Use a fresh context to inspect the final branch, read the release report, verify no private fixture entered the package, and confirm that `latest` is not promoted before registry visibility and effectiveness validation.

## Completion Checklist

- [ ] Shared contract package builds, validates, and is pinned by both repositories.
- [ ] Living Brief and positive policy prevent cross-thread regression without a growing generator denylist.
- [ ] KPP state and receipts require brief, research, design, representative review, representative approval, and human approval in order.
- [ ] LongTable returns one traceable evidence/data bundle with bounded search and explicit human-boundary transformations.
- [ ] Public Proposal automatically routes only needed roles and reviewers cannot mutate source or receipts.
- [ ] Visual Evidence Compiler renders six figure families deterministically and independent QA catches lineage, semantics, and print failures.
- [ ] `adopt`, update, rollback, and uninstall preserve external LongTable and customer artifacts.
- [ ] One setup invocation registers independent Public Proposal and LongTable plugins with no legacy role-skill clutter.
- [ ] Three-arm benchmark demonstrates reader usefulness and revision-burden improvement before beta promotion.
- [ ] Release report separates artifact verification, registry availability, effectiveness validation, and release readiness.
