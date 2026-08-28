# HWPX Surface Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HWPX and project design authority enforceable build inputs, prevent generic DOCX drift, verify active installation lineage, and rebuild the three G-Solverthon DOCX files from the approved R05 visual grammar.

**Architecture:** Add an immutable design-authority contract to the KPP build boundary and derivative manifests. Keep the upstream HWPX snapshot byte-for-byte intact, use one governed content model for both outputs, and fail closed on absent authority, surface drift, or active-cache lineage mismatch. Keep the private R05 reference in the project package rather than the public npm/Git payload.

**Tech Stack:** TypeScript/Vitest, Python/Pydantic/python-docx, HWPX ZIP/XML tools, LibreOffice rendering, JSON manifests, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-28-hwpx-surface-authority.md`

## Global Constraints

- `korean-public-proposal` is the only user-facing skill surface.
- The pinned upstream HWPX snapshot at commit `96a2633f23a08f707679d7e212ebdc59948260e6` remains byte-for-byte unchanged.
- R05 is private `visual_language_only` project authority and is not published.
- No completion or release claim is allowed without all-page human visual review.
- Git, npm, plugin, install receipt, and active Codex cache must resolve one immutable release lineage.

---

### Task 1: Locked design-authority build boundary

**Files:**
- Modify: `apps/public-proposal-cli/worker/src/kpp_docx/build.py`
- Modify: `workers/docx-python/src/kpp_docx/build.py`
- Modify: `apps/kpp-cli/src/commands/build.ts`
- Modify: `tests/regression/pharmacy-fixture.ts`
- Modify: `tests/regression/complex-proposal-fixture.ts`
- Test: `workers/docx-python/tests/test_build.py`
- Test: `apps/kpp-cli/test/release-flow.test.ts`

**Interfaces:**
- Consumes: locked `design-authority.json`, design-lock receipt, template and surface profile.
- Produces: `DesignAuthorityRef` validation and manifest fields `designAuthorityId`, `designAuthoritySha256`, and `governedContentSha256`.

- [ ] **Step 1: Write a failing worker test** that builds without `designAuthority` and expects Pydantic validation failure, then builds with a hash-drifted authority and expects rejection.
- [ ] **Step 2: Run the focused worker tests** with `pytest workers/docx-python/tests/test_build.py -q`; confirm failure is caused by the missing contract.
- [ ] **Step 3: Add the minimal closed Pydantic model** for authority ID, source class, use boundary, source path/hash, rendered-page hashes, template asset ID, and surface profile ID; bind it into the output manifest.
- [ ] **Step 4: Write a failing CLI test** that supplies an authority not present in `design-lock.json` and expects `KPP_BUILD_DESIGN_AUTHORITY_UNBOUND`.
- [ ] **Step 5: Run the focused CLI test** and confirm the unbound authority currently reaches the worker or fails with the wrong code.
- [ ] **Step 6: Validate authority bytes and receipt binding** in `validateLockedBuildRequest`, including exact template/profile identity matching.
- [ ] **Step 7: Synchronize the managed worker snapshot** with `node scripts/sync_public_proposal_worker.mjs` and rerun focused tests.
- [ ] **Step 8: Commit** with `feat: bind builds to project design authority`.

### Task 2: Derivative visual-parity gate

**Files:**
- Create: `plugins/public-proposal/skills/korean-public-proposal/scripts/audit_derivative_parity.py`
- Test: `tests/integration/derivative-parity.test.ts`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/BUNDLE-MANIFEST.json`
- Modify: `scripts/sync_public_proposal_package_assets.mjs`

**Interfaces:**
- Consumes: authority manifest, HWPX/DOCX PDFs, page PNG manifests, HWPX/DOCX artifact manifests.
- Produces: `kpp-derivative-parity-1.0` receipt with `PASS`, `BLOCKED`, or `REVIEW_CANDIDATE` and per-surface findings.

- [ ] **Step 1: Write failing integration fixtures** for equal text/page count but different page pixels, missing required furniture, and absent HWPX render.
- [ ] **Step 2: Run `npx vitest run tests/integration/derivative-parity.test.ts`** and confirm the auditor is missing.
- [ ] **Step 3: Implement the minimal auditor** to recompute artifact/page hashes, page geometry, fonts, table/figure counts, required furniture, and normalized content bindings; never convert missing HWPX render into PASS.
- [ ] **Step 4: Rerun the focused test**, synchronize package assets, and validate both source and packaged skill bundles.
- [ ] **Step 5: Commit** with `feat: block cross-format surface drift`.

### Task 3: Active-cache release lineage doctor

**Files:**
- Modify: `apps/public-proposal-cli/src/contracts.ts`
- Modify: `apps/public-proposal-cli/src/commands/setup.ts`
- Modify: `apps/public-proposal-cli/src/commands/doctor.ts`
- Test: `apps/public-proposal-cli/test/doctor.test.ts`
- Test: `apps/public-proposal-cli/test/setup.test.ts`

**Interfaces:**
- Consumes: package Git SHA, package/plugin versions, install receipt hashes, configured cache root.
- Produces: blocking `PP_ACTIVE_CACHE_DRIFT` and `PP_RELEASE_LINEAGE_MISMATCH` doctor checks.

- [ ] **Step 1: Write failing doctor tests** for same-version installed/cache skill byte mismatch and npm/Git/plugin lineage mismatch.
- [ ] **Step 2: Run the focused doctor tests** and confirm both cases currently pass incorrectly.
- [ ] **Step 3: Extend the installation receipt and doctor dependencies** to locate and hash the active Codex cache skill without mutating it.
- [ ] **Step 4: Fail closed on mismatch**, while reporting each expected and actual identity.
- [ ] **Step 5: Rerun setup/doctor tests** and commit with `fix: fail doctor on active skill lineage drift`.

### Task 4: R05 private golden contract and three-document rebuild

**Files:**
- Create: `/Users/hosung/Work/contracts/2026-gsolverthon-enaction-kosme/design-authority.json`
- Create: `/Users/hosung/Work/contracts/2026-gsolverthon-enaction-kosme/r05-surface-contract.json`
- Replace: `/Users/hosung/Work/contracts/2026-gsolverthon-enaction-kosme/build_native_docx.py`
- Create: `/Users/hosung/Work/contracts/2026-gsolverthon-enaction-kosme/test_r05_inheritance.py`
- Produce: `/Users/hosung/Work/contracts/2026-gsolverthon-enaction-kosme/final-docx/*.docx`

**Interfaces:**
- Consumes: private R05 bytes/render evidence, approved source Markdown, accepted party/date/payment answers.
- Produces: quotation, statement of work, and draft contract with R05-bound manifests and rendered evidence.

- [ ] **Step 1: Write a failing project regression test** asserting the R05 authority hash, 20 mm geometry, Myungjo body family, cover rule/administrative furniture, Roman section grammar, native table minimums, and document-type-specific acceptance/payment/signature surfaces.
- [ ] **Step 2: Run the project test** against the current three DOCX files and record the expected failures.
- [ ] **Step 3: Distill R05 into a private template/profile** without copying its project facts into the new documents.
- [ ] **Step 4: Implement the same-authority builder** and regenerate all three DOCX files from the approved content.
- [ ] **Step 5: Run structural tests, render all pages, inspect contact sheets and zoomed tables/signature blocks**, then record human-review status without claiming approval on the user's behalf.

### Task 5: Version, package, and release gates

**Files:**
- Modify: workspace package versions and compatibility matrix to `0.3.0` where required.
- Modify: `README.md`, `docs/installation/INSTALL.md`, and release verification fixtures.
- Test: repository test/build/pack/release verification suites.

**Interfaces:**
- Consumes: verified commits from Tasks 1-4 and named human approval of rendered exemplars.
- Produces: immutable Git tag/commit, npm package, clean reinstall receipt, and doctor evidence.

- [ ] **Step 1: Update version fixtures and release identity to 0.3.0** only after the functional gates pass.
- [ ] **Step 2: Run `npm test`, `npm run typecheck`, `npm run build`, `npm run pack`, and `npm run verify:public-proposal`** and retain fresh logs.
- [ ] **Step 3: Run package dry-run inspection** and verify that no R05 private bytes or absolute project paths are included.
- [ ] **Step 4: Present rendered exemplars for named human approval.** Stop before publish if approval is absent.
- [ ] **Step 5: After approval, commit, push, merge, publish npm, install into a clean root, run doctor, and verify npm `latest` plus Git `main` resolve the same commit.**

