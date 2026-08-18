# KPP Document Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate Word-native DOCX, deterministic figures, searchable PDF renders, and artifact-backed audits that reject C11 and accept the R08 reference.

**Architecture:** The TypeScript CLI sends versioned JSON requests to a Python worker. Figures are generated from typed data, while audits open the real DOCX/PDF/SVG artifacts and bind results to their hashes.

**Tech Stack:** Python 3.11-3.14, uv 0.6.16+, python-docx 1.2.0, lxml 6.1.1, pydantic 2.13.4, pytest 9.1.1, Node/TypeScript packages from the core plan, LibreOffice `soffice`.

**Spec:** `docs/superpowers/specs/2026-08-17-kpp-product-design.md`

## Global Constraints

- Final tables are Word-native; Gantt, RACI, charts, and frameworks are deterministic SVG/PNG.
- ImageGen candidates never carry final Korean text, numbers, evidence IDs, schedules, tables, or claims.
- Body typography and table geometry are mechanically audited against the locked profile.
- Audit output must be bound to exact artifact hashes; self-reported PASS values are invalid.
- C11 is a known-bad fixture and must remain blocked.

---

### Task 1: Python worker protocol and locked environment

**Files:**
- Create: `workers/docx-python/pyproject.toml`
- Create: `workers/docx-python/src/kpp_docx/protocol.py`
- Create: `workers/docx-python/src/kpp_docx/main.py`
- Create: `workers/docx-python/tests/test_protocol.py`

**Interfaces:**
- Consumes: newline-delimited JSON on stdin with `{ protocolVersion, command, input, output }`.
- Produces: one JSON response `{ ok, code, message, artifacts, findings }` on stdout.

- [ ] **Step 1: Write protocol validation tests**

```py
def test_rejects_unknown_protocol_version():
    request = {"protocolVersion": "9", "command": "build", "input": {}, "output": {}}
    with pytest.raises(ValidationError):
        WorkerRequest.model_validate(request)
```

- [ ] **Step 2: Run the protocol test and verify failure**

Run: `uv run --project workers/docx-python pytest workers/docx-python/tests/test_protocol.py -v`
Expected: FAIL because the worker package does not exist.

- [ ] **Step 3: Implement Pydantic request and response models**

Pin `python-docx==1.2.0`, `lxml==6.1.1`, `pydantic==2.13.4`, and `pytest==9.1.1`; generate `uv.lock`. Accept protocol version `1.0.0` only.

- [ ] **Step 4: Run tests and worker help**

Run: `uv sync --project workers/docx-python --locked && uv run --project workers/docx-python pytest -q && uv run --project workers/docx-python python -m kpp_docx.main --help`
Expected: PASS and help exits 0.

- [ ] **Step 5: Commit the worker contract**

```bash
git add workers/docx-python
git commit -m "feat: define KPP DOCX worker protocol"
```

### Task 2: Word-native builder and typography profile

**Files:**
- Create: `workers/docx-python/src/kpp_docx/build.py`
- Create: `workers/docx-python/src/kpp_docx/styles.py`
- Create: `workers/docx-python/src/kpp_docx/tables.py`
- Create: `workers/docx-python/tests/test_build.py`
- Copy: an approved, redistributable Korean public-proposal template asset to `workers/docx-python/assets/Korean Public Proposal A4 v1.docx`; record only its provenance hash and keep the source path environment-specific.

**Interfaces:**
- Consumes: `BuildRequest` containing the page plan, evidence ledger, content blocks, figure manifest, and locked surface profile.
- Produces: DOCX plus `build-manifest.json` recording page roles, template lineage, styles, tables, figures, and hashes.

- [ ] **Step 1: Write a DOCX XML test for paragraph and table geometry**

```py
def test_build_applies_body_and_table_contract(tmp_path):
    result = build_document(sample_request(tmp_path))
    xml = unzip_xml(result.docx, "word/document.xml")
    assert 'w:jc w:val="both"' in xml
    assert "w:tblCellMar" in xml
    assert "TableGrid" not in xml
```

- [ ] **Step 2: Run the build test and verify failure**

Run: `uv run --project workers/docx-python pytest workers/docx-python/tests/test_build.py -v`
Expected: FAIL because the builder is absent.

- [ ] **Step 3: Implement styles, fixed DXA tables, and manifest lineage**

Apply Noto Sans CJK KR to headings/navigation and Noto Serif CJK KR to analytical body. Encode 9.3pt body, 1.52 line height, justified alignment, and profile-defined character spacing in OOXML. Record each ordinary page's `pageRole` and `surfaceTemplateId` in the manifest.

- [ ] **Step 4: Run build tests and inspect generated OOXML**

Run: `uv run --project workers/docx-python pytest workers/docx-python/tests/test_build.py -v`
Expected: PASS and the test artifact opens through `python-docx` without repair.

- [ ] **Step 5: Commit the native document builder**

```bash
git add workers/docx-python
git commit -m "feat: build governed Word-native proposal documents"
```

### Task 3: Deterministic figure renderers

**Files:**
- Create: `packages/renderers/src/types.ts`
- Create: `packages/renderers/src/gantt.ts`
- Create: `packages/renderers/src/raci.ts`
- Create: `packages/renderers/src/framework.ts`
- Create: `packages/renderers/src/index.ts`
- Create: `packages/renderers/test/renderers.test.ts`

**Interfaces:**
- Consumes: typed `FigureSpec` records with `family`, `data`, `evidenceIds`, `caption`, and token hash.
- Produces: SVG, optional 300dpi PNG, and `figure-manifest.json` with renderer version and output hashes.

- [ ] **Step 1: Write structure tests for Gantt and framework SVG**

```ts
it("renders a gantt with axis rows bars and milestones", async () => {
  const svg = await renderFigure(sampleGantt);
  expect(svg).toContain('data-kpp-role="time-axis"');
  expect(svg).toContain('data-kpp-role="work-package-row"');
  expect(svg).toContain('data-kpp-role="duration-bar"');
  expect(svg).toContain('data-kpp-role="milestone"');
});
```

- [ ] **Step 2: Run renderer tests and verify failure**

Run: `npm test -- packages/renderers/test/renderers.test.ts`
Expected: FAIL because renderers are not implemented.

- [ ] **Step 3: Implement semantic SVG renderers**

Use `data-kpp-role` attributes for machine auditability. Reject unsupported family/data combinations and reject stochastic raster inputs for evidence-bearing families.

- [ ] **Step 4: Run renderer tests and deterministic hash test**

Run: `npm test -- packages/renderers/test/renderers.test.ts`
Expected: PASS and two renders of identical input have identical SHA-256.

- [ ] **Step 5: Commit figure renderers**

```bash
git add packages/renderers
git commit -m "feat: render deterministic proposal figures"
```

### Task 4: PDF renderer and page image extraction

**Files:**
- Create: `packages/core/src/os-adapters.ts`
- Create: `apps/kpp-cli/src/commands/render.ts`
- Create: `apps/kpp-cli/test/render.test.ts`

**Interfaces:**
- Consumes: built DOCX and macOS adapter resolving `/opt/homebrew/bin/soffice` or another verified executable.
- Produces: searchable PDF, one PNG per page, and `render.json` bound to DOCX/PDF hashes.

- [ ] **Step 1: Write a render test with a temporary DOCX**

```ts
it("renders PDF and numbered page images", async () => {
  const result = await renderProject(sampleProject);
  expect(result.pdfPages).toBe(result.pageImages.length);
  expect(result.searchableText).toContain("기관 연구제안서");
});
```

- [ ] **Step 2: Run the render test and verify failure**

Run: `npm test -- apps/kpp-cli/test/render.test.ts`
Expected: FAIL because the render command and adapter are absent.

- [ ] **Step 3: Implement safe process execution and artifact binding**

Invoke processes with argument arrays, never shell interpolation. Record executable path and version. Reject missing PDF, zero pages, missing page images, and nonextractable Korean text.

- [ ] **Step 4: Run the render test**

Run: `npm test -- apps/kpp-cli/test/render.test.ts`
Expected: PASS using the installed `soffice`.

- [ ] **Step 5: Commit rendering**

```bash
git add packages/core apps/kpp-cli
git commit -m "feat: render searchable proposal PDFs and page images"
```

### Task 5: Artifact-backed audit suite

**Files:**
- Create: `packages/audits/src/source.ts`
- Create: `packages/audits/src/content.ts`
- Create: `packages/audits/src/surface-lineage.ts`
- Create: `packages/audits/src/figure-family.ts`
- Create: `packages/audits/src/release.ts`
- Create: `workers/docx-python/src/kpp_docx/audit_geometry.py`
- Create: `packages/audits/test/audits.test.ts`
- Create: `workers/docx-python/tests/test_audit_geometry.py`

**Interfaces:**
- Consumes: real project files, DOCX/PDF/SVG, manifests, and receipts.
- Produces: `audit/audit.json` with stable rule codes, artifact hashes, findings, and status `PASS` or `BLOCKED`.

- [ ] **Step 1: Write failing tests for font, TableGrid, Gantt structure, and stale approval**

```ts
it("blocks a schedule figure without gantt roles", async () => {
  const result = await auditFigureFamily(nonGanttSchedule);
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: "KPP_DESIGN_GANTT_STRUCTURE"
  }));
});
```

- [ ] **Step 2: Run TypeScript and Python audit tests and verify failure**

Run: `npm test -- packages/audits/test/audits.test.ts && uv run --project workers/docx-python pytest workers/docx-python/tests/test_audit_geometry.py -v`
Expected: FAIL because audit implementations are missing.

- [ ] **Step 3: Implement direct artifact inspection**

Read DOCX ZIP XML for paragraph spacing, tracking, justification, fonts, table widths, `tcMar`, borders, drawings, captions, and relationships. Read SVG semantic roles and hashes. Never accept status booleans that are not backed by a verified receipt.

- [ ] **Step 4: Run audit tests and full typecheck**

Run: `npm test -- packages/audits/test/audits.test.ts && uv run --project workers/docx-python pytest -q && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit audits**

```bash
git add packages/audits workers/docx-python
git commit -m "feat: audit real proposal artifacts and visual lineage"
```

### Task 6: C11 and R08 regression fixtures

**Files:**
- Copy: C11 incident, DOCX, manifests, and selected rendered pages to `fixtures/known-bad/c11/`
- Copy: sanitized R08 tokens and approved reference surfaces to `fixtures/valid/r08-reference/`
- Create: `tests/regression/c11.test.ts`
- Create: `tests/regression/r08.test.ts`
- Create: `fixtures/PROVENANCE.md`

**Interfaces:**
- Consumes: approved project evidence at the exact paths named in the spec.
- Produces: sanitized, hashed fixtures with explicit `project_only` and `visual_reference_only` boundaries.

- [ ] **Step 1: Write expected-outcome regression tests**

```ts
it("blocks C11 for the recorded escaped gates", async () => {
  const result = await auditFixture("fixtures/known-bad/c11");
  expect(result.status).toBe("BLOCKED");
  expect(result.codes).toEqual(expect.arrayContaining([
    "KPP_DESIGN_SURFACE_LINEAGE",
    "KPP_DESIGN_GANTT_STRUCTURE",
    "KPP_DOCX_PARAGRAPH_GEOMETRY",
    "KPP_DOCX_TABLE_GEOMETRY"
  ]));
});
```

- [ ] **Step 2: Run regression tests and verify fixture absence failure**

Run: `npm test -- tests/regression/c11.test.ts tests/regression/r08.test.ts`
Expected: FAIL because fixtures are not present.

- [ ] **Step 3: Copy only required fixtures and record provenance and SHA-256**

Do not copy customer-sensitive claims beyond what is required to reproduce geometry. Preserve the C11 incident record and R08 visual authority hashes.

- [ ] **Step 4: Run all Node and Python tests**

Run: `npm test && npm run typecheck && uv run --project workers/docx-python pytest -q`
Expected: C11 test PASS by observing `BLOCKED`; R08 test PASS by observing `PASS`.

- [ ] **Step 5: Commit regression evidence**

```bash
git add fixtures tests/regression
git commit -m "test: lock C11 failure and R08 visual authority"
```

### Task 7: Build, audit, approval, and release commands

**Files:**
- Create: `apps/kpp-cli/src/commands/build.ts`
- Create: `apps/kpp-cli/src/commands/audit.ts`
- Create: `apps/kpp-cli/src/commands/approve.ts`
- Create: `apps/kpp-cli/src/commands/release.ts`
- Create: `apps/kpp-cli/test/release-flow.test.ts`

**Interfaces:**
- Consumes: locked project through `CONTENT_APPROVED`, Python worker, renderers, and audits.
- Produces: DOCX, PDF, approval receipt, and immutable `release/` package.

- [ ] **Step 1: Write a release flow test and mutation test**

```ts
it("revokes approval after the PDF changes", async () => {
  await approveProject(root, "Hosung");
  await appendFile(pdf, "mutation");
  await expect(releaseProject(root)).rejects.toMatchObject({
    code: "KPP_RELEASE_APPROVAL_STALE"
  });
});
```

- [ ] **Step 2: Run the release test and verify missing commands failure**

Run: `npm test -- apps/kpp-cli/test/release-flow.test.ts`
Expected: FAIL because commands are absent.

- [ ] **Step 3: Implement command orchestration and atomic release copy**

Require adjacent state transitions and verified receipts. Copy only manifest-listed submission files into a new versioned release directory, then write `release.json` last.

- [ ] **Step 4: Run the complete product test suite**

Run: `npm test && npm run typecheck && npm run build && uv run --project workers/docx-python pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit the end-to-end document pipeline**

```bash
git add apps/kpp-cli
git commit -m "feat: build approve and release verified proposals"
```
