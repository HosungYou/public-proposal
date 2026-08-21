# KPP Surface Verification Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the escaped table/SVG surface defects into a byte-bound, receipt-bound Korean public-proposal verification contract and prove it against a multi-surface research-service document fixture.

**Architecture:** Add a standalone Python `audit_surface_contract.py` to the canonical skill and plugin bundle. It parses DOCX OOXML, deterministic SVGs, and a hash-bound render manifest; it emits a structured audit receipt and fails closed on missing or stale inputs. Extend the legacy submission gate to require the receipt, and add self-contained complex positive/negative fixtures covering native tables, framework/Gantt/RACI SVGs, crosswalk/evidence-ledger pages, and render-hash tampering.

**Tech Stack:** Python 3.11+, python-docx, stdlib XML/ZIP/hashlib/json, pytest, Node/Vitest plugin parity tests, existing KPP worker/renderers, generated skill bundle manifest.

**Spec:** `docs/superpowers/specs/2026-08-20-kpp-vnext-document-architecture-design.md`, `~/.codex/skills/korean-public-proposal/references/surface-system-spec.md`, `~/.codex/skills/korean-public-proposal/references/incident-learning-protocol.md`

## Global Constraints

- Issuer rules and approved project profiles override the reusable default surface contract.
- A technical surface PASS is not human content, visual, or submission approval.
- The validator must inspect current bytes and hashes; it must not trust free-form status fields.
- The old pharmacy defect is a known-bad regression: missing table grammar, full-canvas SVG fill, and zebra body rows must block.
- Canonical skill, repository plugin source, packaged plugin, and bundle manifest must remain byte-parity synchronized.
- No NPM/GitHub/publish mutation occurs in this implementation pass.

### Task 1: Lock the surface-audit contract with RED fixtures

**Files:**
- Create: `/Users/hosung/.codex/skills/korean-public-proposal/tests/test_surface_contract.py`
- Create: `/Users/hosung/.codex/skills/korean-public-proposal/tests/fixtures/complex_surface_fixture.py`
- Modify: `/Users/hosung/.codex/skills/korean-public-proposal/tests/test_submission_gate_integrity.py`

**Interfaces:**
- Fixture helper produces a DOCX with three native tables, four deterministic SVG surface families, page PNGs, and a render manifest.
- Tests call the future `audit_surface_contract.py` CLI and assert structured finding codes, not visual prose.

- [x] Write positive and negative tests for table header/body fill, repeat header, alignment, line spacing, SVG outer-canvas fill, no-zebra rows, current file hashes, and all-page render bindings.
- [x] Add a complex research-service fixture with an evidence-ledger table, evaluation crosswalk table, roadmap/RACI table, framework SVG, Gantt SVG, RACI SVG, and decision-flow SVG.
- [x] Add mutations for missing header shading, full-canvas `#FCFCFA`, alternating body fills, stale figure hash, missing page PNG, and missing audit receipt in the submission gate.
- [x] Run the focused tests and record the expected RED failures in the evidence directory.

### Task 2: Implement the byte-bound surface validator

**Files:**
- Create: `/Users/hosung/.codex/skills/korean-public-proposal/scripts/audit_surface_contract.py`
- Modify: `/Users/hosung/.codex/skills/korean-public-proposal/scripts/validate_submission_gate.py`
- Modify: `/Users/hosung/.codex/skills/korean-public-proposal/SKILL.md`
- Modify: `/Users/hosung/.codex/skills/korean-public-proposal/references/qa-gates.md`
- Modify: `/Users/hosung/.codex/skills/korean-public-proposal/references/incident-learning-protocol.md`

**Interfaces:**
- CLI: `audit_surface_contract.py DOCX --contract CONTRACT.json --svg-dir DIR --render-manifest MANIFEST.json --out RECEIPT.json`.
- Receipt fields: `schemaVersion`, `status`, `docxSha256`, `renderManifestSha256`, `observations`, and `findings`; SVG/page hashes remain bound in the render manifest that the receipt audits.
- `validate_submission_gate.py` requires `qa.surface_audit_status == PASS`, a receipt path, and a matching receipt SHA-256 before `G5_render_qa` can pass.

- [x] Implement DOCX table inspection using OOXML (`w:shd`, `w:tblHeader`, `w:jc`, `w:spacing`) with configurable contract tokens.
- [x] Implement SVG inspection for full-canvas fills and semantic row fill uniformity without rejecting legitimate declared issuer exceptions.
- [x] Implement render-manifest existence/hash checks for DOCX, SVGs, and every page image; reject stale or missing bindings.
- [x] Emit deterministic finding codes and nonzero exit status for blockers.
- [x] Run Task 1 tests to GREEN, then refactor only while green.

### Task 3: Add repository-level complex-document effectiveness coverage

**Files:**
- Create: `/Users/hosung/dev/public-proposal/.worktrees/kpp-vnext/tests/integration/surface-contract.test.ts`
- Create: `/Users/hosung/dev/public-proposal/.worktrees/kpp-vnext/fixtures/valid/complex-research-service/README.md`
- Create: `/Users/hosung/dev/public-proposal/.worktrees/kpp-vnext/fixtures/known-bad/surface-contract/README.md`
- Modify: `/Users/hosung/dev/public-proposal/.worktrees/kpp-vnext/tests/plugin/korean-skill-bundle.test.ts`

**Interfaces:**
- The integration test invokes the bundled plugin validator, not only the canonical home-directory copy.
- The complex fixture must exercise at least four semantic surface families and two independent table roles.

- [x] Add a positive bundled-validator run against the complex research-service fixture.
- [x] Add mutation cases proving each escaped defect is blocked and valid pharmacy/private-partnership surfaces remain green.
- [x] Add a detection matrix to the test output/report: defect, expected code, observed code, and detection status.
- [x] Add source/plugin/package parity assertions for the new script and fixture contract.

### Task 4: Synchronize and verify all authorities

**Files:**
- Modify: `/Users/hosung/dev/public-proposal/.worktrees/kpp-vnext/plugins/public-proposal/skills/korean-public-proposal/**`
- Modify: `/Users/hosung/dev/public-proposal/.worktrees/kpp-vnext/apps/public-proposal-cli/plugin/skills/korean-public-proposal/**`
- Modify: `/Users/hosung/.codex/skills/korean-public-proposal/**`

- [x] Copy the canonical validator/docs/tests’ contract changes into repository source, refresh the packaged bundle, and update `BUNDLE-MANIFEST.json`.
- [x] Run canonical skill pytest, bundled validator tests, plugin parity, source/package bundle validation, and worker parity.
- [x] Run root typecheck/build/full Vitest and document exact counts.

### Task 5: Evidence, review, and release boundary

**Files:**
- Create: `.superpowers/sdd/2026-08-20-kpp-vnext-document-architecture/evidence/task-surface-contract-report.md`
- Create: `.superpowers/sdd/2026-08-20-kpp-vnext-document-architecture/evidence/task-surface-contract-detection-matrix.json`

- [x] Record RED and GREEN logs, positive/negative artifact hashes, and the detection matrix.
- [x] Re-render the complex document and inspect every page/contact sheet at print size.
- [x] Run an independent code/fixture review before claiming completion.
- [x] Leave NPM/GitHub/latest publication blocked until the corrected contract and human approval are explicitly accepted.
