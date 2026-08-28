# KPP vNext Document Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mode-aware, evidence-bound document architecture and release gates that prevent title-per-page and repeated-surface regressions, then publish the six coordinated KPP packages after human approval of a regenerated pharmacy-partnership exemplar.

**Architecture:** Keep `ProposalClass` for research/procurement classification and add a separate `DocumentMode` policy registry in core. Persist a hash-bound page-architecture/reference contract before authoring, observe the rendered DOCX/PDF independently, compose structured audit receipts, and require those receipts in release. Generate plugin and worker installer snapshots from canonical repository sources and verify parity.

**Tech Stack:** TypeScript 7, Zod 4, Commander 15, Vitest 4, YAML, Python/Pydantic DOCX worker, LibreOffice/PDF rasterization, npm workspaces, Codex plugin bundle manifests.

**Spec:** `docs/superpowers/specs/2026-08-20-kpp-vnext-document-architecture-design.md`

## Global Constraints

- `DocumentMode` has exactly `public_procurement`, `research_service`, `private_partnership`, `internal_decision`, and `document_restyle`.
- `ProposalClass` is not overloaded with `DocumentMode`.
- A 20.5-point large title is allowed only on the cover or genuine chapter opener; continuation-page strongest heading is at most 12 points unless a recorded issuer override applies.
- Evaluation questions/direct answers are internal fields by default and are reader-visible only when mode policy and page intent explicitly allow them.
- No fixed table/figure/page-surface count is used as a quality proxy.
- Figures receive semantic credit only for data evidence, causal mechanism, decision trade-off, or operational control; decorative and prose-restatement figures do not count.
- All references resolve; available source hashes match; undeclared or dangling references block release.
- Existing v1 projects are never silently migrated. `kpp migrate --apply` is the only write path for migration and emits a backup plus migration receipt.
- Raw historical DOCX/PDF files and personal/client data are not committed or packaged; fixtures are synthetic, anonymized, structured, and hash/provenance bounded.
- Canonical plugin source is `plugins/public-proposal`; canonical worker source is `workers/docx-python`; installer trees are generated snapshots with parity tests.
- Package versions are `@longtable/public-proposal@0.2.0` and five KPP packages at `0.3.0`.
- Never unpublish. Record previous dist-tags before publish; rollback is a dist-tag move or corrective patch.
- Stop before npm `latest`, GitHub push/tag/release, and publication until the user explicitly approves the rendered pharmacy exemplar.

---

### Task 1: Add v2 schemas and mode policy data contracts

**Files:**
- Create: `packages/schemas/src/document-mode.ts`
- Create: `packages/schemas/src/page-architecture.ts`
- Create: `packages/schemas/src/reference-manifest.ts`
- Modify: `packages/schemas/src/project.ts`
- Modify: `packages/schemas/src/page-plan.ts`
- Modify: `packages/schemas/src/receipt.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/test/schemas.test.ts`
- Test: `packages/schemas/test/document-architecture.test.ts`

**Interfaces:**
- Produce `DocumentModeSchema`, `DocumentMode`, `DOCUMENT_MODES`.
- Produce `PageTitleScopeSchema`, `PageSurfaceVisibilitySchema`, `PageArchitecturePageSchema`, and `PageArchitectureManifestSchema`.
- Produce `ReferenceClassSchema`, `ReferenceTargetSchema`, `ReferenceRecordSchema`, and `ReferenceManifestSchema`.
- Extend `ProjectSchema` with required v2 `documentMode`, `modePolicyVersion`, and `migrationHistory` while preserving `ProposalClass`.
- Extend receipts with optional `projectId`, `documentMode`, `modePolicyVersion`, and `receiptKind` fields without making valid v1 receipts parse as v2.

- [ ] **Step 1: Write failing schema tests.** Assert all five mode literals parse, an unknown mode fails, a continuation page cannot use `titleScope: "chapter"` without an issuer override, target/reference IDs are non-empty, and a v2 project without `documentMode` fails.
- [ ] **Step 2: Run the focused tests.** Run `npm test -- packages/schemas/test/document-architecture.test.ts packages/schemas/test/schemas.test.ts`. Expected: FAIL because the new schemas and fields do not exist.
- [ ] **Step 3: Implement the Zod contracts.** Keep identifiers trimmed and SHA-256 values lowercase hexadecimal. Keep architecture and reference manifests separate from the existing page-plan list.
- [ ] **Step 4: Re-run focused tests and typecheck.** Run `npm test -- packages/schemas/test/document-architecture.test.ts packages/schemas/test/schemas.test.ts` and `npm run typecheck --workspace @longtable/kpp-schemas`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/schemas && git commit -m "feat: add v2 document architecture schemas"`

### Task 2: Implement mode policy, v2 project initialization, and explicit migration

**Files:**
- Create: `packages/core/src/mode-policy.ts`
- Create: `packages/core/src/migration.ts`
- Modify: `packages/core/src/project-store.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/kpp-cli/src/commands/migrate.ts`
- Modify: `apps/kpp-cli/src/commands/init.ts`
- Modify: `apps/kpp-cli/src/main.ts`
- Test: `packages/core/test/mode-policy.test.ts`
- Test: `packages/core/test/migration.test.ts`
- Test: `apps/kpp-cli/test/cli.test.ts`

**Interfaces:**
- Produce `getDocumentModePolicy(mode: DocumentMode): DocumentModePolicy`.
- Produce `migrateProject(root: string, options: { readonly apply: boolean; readonly documentMode?: DocumentMode }): Promise<MigrationReport>`.
- `MigrationReport` contains migration ID, from/to schema versions, source/destination hashes, backup path when applied, decisions, warnings, and receipt path.
- Extend `ProjectInitialization` with `documentMode?: DocumentMode` and make new initialization write schema `2.0.0`, `modePolicyVersion: "1.0.0"`, and empty `migrationHistory`.
- Register `kpp migrate <root> [--to 2.0.0] [--document-mode private_partnership] [--apply] [--json]`; the option accepts each literal in `DOCUMENT_MODES`.

- [ ] **Step 1: Write failing policy tests.** Assert each mode has distinct required roles, surface families, audit slices, and artifact allowlist; assert `private_partnership` does not implicitly require procurement evaluation crosswalk.
- [ ] **Step 2: Write failing migration tests.** Assert dry-run does not write, apply creates a timestamped `.kpp-migrations/<id>/backup` copy and receipt, an ambiguous v1 project requires `--document-mode`, and `doctor`/normal commands do not mutate v1 files.
- [ ] **Step 3: Run focused tests to verify failure.** Run `npm test -- packages/core/test/mode-policy.test.ts packages/core/test/migration.test.ts apps/kpp-cli/test/cli.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement policy and migration.** Preserve all source/evidence bytes; create empty architecture/reference skeletons rather than inventing claims. Reject unknown schema versions and unsupported migration targets.
- [ ] **Step 5: Wire init and CLI.** Add `--document-mode` to init, keep the existing proposal-class option, and add a read-only migration diagnosis to doctor without invoking `--apply`.
- [ ] **Step 6: Run tests and typecheck.** Run `npm test -- packages/core/test/mode-policy.test.ts packages/core/test/migration.test.ts apps/kpp-cli/test/cli.test.ts` and `npm run typecheck --workspace @longtable/kpp-core`. Expected: PASS.
- [ ] **Step 7: Commit.** `git add packages/core apps/kpp-cli && git commit -m "feat: add mode policy and explicit project migration"`

### Task 3: Add architecture/reference validators and bind them to planning/build

**Files:**
- Create: `packages/core/src/page-architecture.ts`
- Create: `packages/core/src/reference-integrity.ts`
- Modify: `packages/core/src/authoring-bundle.ts`
- Modify: `apps/kpp-cli/src/commands/plan.ts`
- Modify: `apps/kpp-cli/src/commands/build.ts`
- Test: `packages/core/test/page-architecture.test.ts`
- Test: `packages/core/test/reference-integrity.test.ts`
- Test: `apps/kpp-cli/test/plan.test.ts`

**Interfaces:**
- Produce `validatePageArchitecture(manifest, pagePlan, policy): ValidationResult` with rule IDs for title scope, continuity, mode mismatch, duplicate page IDs, and unresolved claim/figure/proof IDs.
- Produce `validateReferenceManifest(manifest, architecture, evidence): ValidationResult` with rule IDs for dangling IDs, stale hashes, undeclared targets, unavailable-source declarations, and issuer-override validity.
- `ValidationResult` is structured (`status`, `findings[]`), never a free-form string.

- [ ] **Step 1: Write failing validator tests.** Cover a valid five-page mixed architecture, 20.5-point continuation title, missing continuity link, dangling `SRC-004`, stale source hash, and a permitted issuer override.
- [ ] **Step 2: Run focused tests.** Run `npm test -- packages/core/test/page-architecture.test.ts packages/core/test/reference-integrity.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement validators.** Validate architecture against the selected mode policy and page-plan IDs; validate references against file bytes and architecture targets without mutating locked artifacts.
- [ ] **Step 4: Wire plan/build.** `plan` writes `content/page-architecture.json` and `evidence/reference-manifest.json` only when input is valid; `build` refuses missing or mismatched manifests and binds their hashes into the build manifest.
- [ ] **Step 5: Run integration tests.** Run `npm test -- apps/kpp-cli/test/plan.test.ts tests/integration/content-to-build.test.ts` and `npm run typecheck --workspace @longtable/kpp-cli`. Expected: PASS.
- [ ] **Step 6: Commit.** `git add packages/core apps/kpp-cli && git commit -m "feat: bind page architecture and reference integrity"`

### Task 4: Enforce title hierarchy in the DOCX build and emit render observations

**Files:**
- Create: `packages/audits/src/page-architecture.ts`
- Create: `packages/audits/src/render-observations.ts`
- Modify: `packages/audits/src/content.ts`
- Modify: `packages/audits/src/index.ts`
- Modify: `workers/docx-python/src/kpp_docx/build.py`
- Modify: `workers/docx-python/src/kpp_docx/audit_geometry.py`
- Mirror through generator: `apps/public-proposal-cli/worker/...`
- Test: `packages/audits/test/page-architecture.test.ts`
- Test: `packages/audits/test/render-observations.test.ts`
- Test: `workers/docx-python/tests/test_build.py`
- Test: `workers/docx-python/tests/test_audit_geometry.py`

**Interfaces:**
- Produce `RenderPageObservation` and `RenderObservationManifest` with measured heading sizes, title blocks, surface family, region fingerprints, geometry, and continuation markers.
- Produce `auditRenderedPageArchitecture(input): AuditSlice` that compares measured observations with the locked architecture; it must not copy planned roles as evidence.
- Worker build validation rejects an explicit continuation page title above 12pt unless `issuerOverride` is present and mode-permitted.

- [ ] **Step 1: Write failing tests.** Add synthetic observations for a compliant cover/chapter/continuation sequence and a continuation page at 20.5pt. Add a worker test that rejects a continuation heading without an override.
- [ ] **Step 2: Run tests to verify failure.** Run `npm test -- packages/audits/test/page-architecture.test.ts packages/audits/test/render-observations.test.ts` and `python3 -m pytest workers/docx-python/tests/test_build.py workers/docx-python/tests/test_audit_geometry.py`. Expected: FAIL.
- [ ] **Step 3: Implement observation extraction.** Record source artifact hashes and stable page locators. Keep title measurements independent from the page-plan declaration.
- [ ] **Step 4: Implement worker contract and audit slice.** Emit a deterministic observation manifest and findings such as `KPP_PAGE_TITLE_CONTINUATION_LARGE` with page number, measured size, expected maximum, and override status.
- [ ] **Step 5: Synchronize the managed worker snapshot and run all worker/audit tests.** Run `node scripts/sync_public_proposal_worker.mjs`, the focused tests, and `npm run typecheck --workspace @longtable/kpp-audits`. Expected: PASS and identical worker source hashes.
- [ ] **Step 6: Commit.** `git add packages/audits workers/docx-python apps/public-proposal-cli/worker scripts && git commit -m "feat: audit rendered page architecture and title hierarchy"`

### Task 5: Add semantic figure-value and topology-repetition audits

**Files:**
- Create: `packages/audits/src/figure-value.ts`
- Modify: `packages/audits/src/figure-family.ts`
- Modify: `packages/audits/src/repetition.ts`
- Modify: `packages/audits/src/index.ts`
- Modify: `packages/renderers/src/types.ts`
- Modify: `packages/renderers/src/index.ts`
- Test: `packages/audits/test/figure-value.test.ts`
- Test: `packages/audits/test/repetition.test.ts`
- Test: `packages/renderers/test/renderers.test.ts`

**Interfaces:**
- Add `FigureSemanticValueIntentSchema` with `data_evidence`, `causal_mechanism`, `decision_tradeoff`, and `operational_control` plus `decorative`.
- Extend semantic figure input with `semanticValueIntent`, `decisionEffect`, and `nonDuplicateOf`.
- Produce `auditFigureSemanticValue(figures, neighboringBlocks): AuditSlice` and `auditSurfaceRepetition(observations): AuditSlice`.

- [ ] **Step 1: Write failing tests.** Assert a sourced comparison earns value, an owner/timing/acceptance RACI earns operational value, a decorative figure earns zero, a prose-restatement figure blocks, and two identical topology signatures across a run block unless an explicit permitted exception exists.
- [ ] **Step 2: Run focused tests.** Run `npm test -- packages/audits/test/figure-value.test.ts packages/audits/test/repetition.test.ts packages/renderers/test/renderers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement semantic contract and audit.** Keep renderer determinism and SVG accessibility metadata; add topology signatures from family, ordered labels, role/state counts, and encoded variables rather than pixel comparison.
- [ ] **Step 4: Compose the slices.** `auditProposal` must include semantic-value and surface-repetition slices and bind their input artifact hashes.
- [ ] **Step 5: Run tests and typecheck.** Run the focused tests, `npm run typecheck --workspace @longtable/kpp-renderers`, and `npm run typecheck --workspace @longtable/kpp-audits`. Expected: PASS.
- [ ] **Step 6: Commit.** `git add packages/audits packages/renderers && git commit -m "feat: gate figure semantic value and repeated surfaces"`

### Task 6: Generalize audit receipts and mode-aware release enforcement

**Files:**
- Create: `packages/schemas/src/audit-receipt.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/audits/src/index.ts`
- Modify: `packages/audits/src/release.ts`
- Modify: `apps/kpp-cli/src/commands/audit.ts`
- Modify: `apps/kpp-cli/src/commands/release.ts`
- Test: `packages/audits/test/release.test.ts`
- Test: `packages/audits/test/audit-receipt.test.ts`
- Test: `apps/kpp-cli/test/release.test.ts`

**Interfaces:**
- Produce `AuditSliceReceiptSchema` and `CompositeAuditReceiptSchema` with `projectId`, `documentMode`, input hashes, rule findings, reviewer scope, and exact artifact bindings.
- `auditProposal` returns five independent slices: `page_architecture`, `reference_integrity`, `render_repetition`, `figure_value`, and `korean_prose_review`, plus existing DOCX/render/lineage slices.
- `auditReleaseReadiness` consumes the mode policy and requires architecture/reference/observation/audit artifacts in the final receipt allowlist.

- [ ] **Step 1: Write failing tests.** Cover free-form PASS rejection, missing slice rejection, mode mismatch, stale input hash, artifact outside a mode allowlist, and a valid private-partnership release chain.
- [ ] **Step 2: Run focused tests to verify failure.** Run `npm test -- packages/audits/test/audit-receipt.test.ts packages/audits/test/release.test.ts apps/kpp-cli/test/release.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement structured receipts.** Preserve existing receipt-chain semantics and add rule-level findings, input hashes, and mode identity. Keep human approval separate from technical audit.
- [ ] **Step 4: Wire CLI audit/release.** Add architecture/reference/observation options or project defaults, reject premature approval/release receipts, and replace hard-coded artifact patterns with mode policy allowlists.
- [ ] **Step 5: Run package tests and typecheck.** Run focused tests, `npm test -- packages/audits packages/core apps/kpp-cli`, and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** `git add packages/schemas packages/audits apps/kpp-cli && git commit -m "feat: enforce mode-aware audit receipts at release"`

### Task 7: Update the canonical skill, references, plugin snapshot, and worker parity checks

**Files:**
- Modify: `/Users/hosung/.codex/skills/korean-public-proposal/SKILL.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/SKILL.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/references/figure-grammar.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/references/incident-learning-protocol.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/references/korean-report-visual-system.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/references/page-contract.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/references/public-document-grammar.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/references/qa-gates.md`
- Modify: `plugins/public-proposal/skills/korean-public-proposal/references/surface-system-spec.md`
- Modify: `scripts/sync_public_proposal_package_assets.mjs`
- Modify: `scripts/sync_public_proposal_worker.mjs`
- Modify: `tests/plugin/korean-skill-bundle.test.ts`
- Create: `tests/plugin/source-snapshot-parity.test.ts`
- Modify: `apps/public-proposal-cli/README.md`

**Interfaces:**
- The canonical skill must state the title hierarchy, semantic-value gate, five modes, explicit migration, fact-preserving Korean prose receipt, and release stop before human exemplar approval.
- Sync scripts must copy from canonical plugin/worker sources and fail if generated snapshots differ after copy.
- Parity tests compare file lists and SHA-256 values for plugin source/package snapshot and worker source/installer snapshot.

- [ ] **Step 1: Write failing parity tests.** Mutate a temporary source skill/worker file and assert parity detects drift; assert the sync operation repairs only the generated snapshot.
- [ ] **Step 2: Run plugin tests to verify failure.** Run `npm test -- tests/plugin/korean-skill-bundle.test.ts tests/plugin/source-snapshot-parity.test.ts`. Expected: FAIL for the new parity cases.
- [ ] **Step 3: Update the canonical skill and references.** Remove universal per-page title/template language; make the contract mode-aware and evidence/release bound. Keep official forms and legal quotations outside prose rewriting.
- [ ] **Step 4: Implement snapshot parity and sync.** Use existing bundle validator and manifest generation; include generated plugin/worker hashes in release verification output.
- [ ] **Step 5: Run sync, tests, and skill validation.** Run `node scripts/sync_public_proposal_package_assets.mjs`, `node scripts/sync_public_proposal_worker.mjs`, `npm test -- tests/plugin`, and `python3 scripts/validate_korean_skill_bundle.py apps/public-proposal-cli/plugin`. Expected: PASS.
- [ ] **Step 6: Commit.** `git add /Users/hosung/.codex/skills/korean-public-proposal plugins scripts tests/plugin apps/public-proposal-cli && git commit -m "feat: synchronize vNext proposal skill and installer snapshots"`

### Task 8: Add anonymized regression fixtures and pharmacy private-partnership exemplar

**Files:**
- Create: `fixtures/known-bad/pharmacy-repeated-surface/fixture.json`
- Create: `fixtures/known-bad/gsolverthon-repeated-contract/fixture.json`
- Create: `fixtures/valid/pharmacy-private-partnership/fixture.json`
- Create: `fixtures/known-bad/dangling-reference/fixture.json`
- Create: `fixtures/known-bad/prose-restatement-figure/fixture.json`
- Create: `fixtures/valid/private-partnership-decision/fixture.json`
- Modify: `tests/regression/fixture-harness.ts`
- Create: `tests/regression/pharmacy-architecture.test.ts`
- Create: `tests/regression/mode-matrix.test.ts`
- Modify: `tests/regression/c11.test.ts`
- Modify: `tests/regression/r08.test.ts`
- Modify: `Work/Enaction Labs/부산_서구약사회_AI해커톤_협력제안/build_external_redesign.py` only in the approved exemplar worktree after its output contract is mapped

**Interfaces:**
- Fixture inputs contain synthetic Korean text, architecture/reference/figure manifests, expected rule IDs, and provenance labels; no raw client files.
- `fixture-harness.ts` materializes temporary copies and never modifies canonical fixtures.
- Pharmacy exemplar output is a real rendered PDF/contact sheet plus architecture/audit reports, stored outside npm package contents.

- [ ] **Step 1: Write failing regression tests.** Assert known-bad pharmacy/gsolverthon fixtures fail for repeated title/surface rules, C11 remains blocked, R08 remains valid, and the valid private-partnership fixture passes without procurement crosswalk.
- [ ] **Step 2: Run regression tests to verify failure.** Run `npm test -- tests/regression/pharmacy-architecture.test.ts tests/regression/mode-matrix.test.ts tests/regression/c11.test.ts tests/regression/r08.test.ts`. Expected: FAIL because the new fixtures/contracts are absent.
- [ ] **Step 3: Add synthetic fixtures and harness anonymization.** Preserve page/claim/figure IDs and expected findings; replace institution/person names with neutral labels; record only source pattern and structured hash metadata.
- [ ] **Step 4: Regenerate pharmacy exemplar.** Use `private_partnership` mode, remove the universal page skeleton, use large titles only for cover/chapter openers, and make value/roles/operation/options/next-decision surfaces explicit.
- [ ] **Step 5: Run full regression and render checks.** Run focused regression tests, DOCX geometry checks, PDF/page-image rendering, and contact-sheet inspection. Expected: known-bad blocked, valid fixtures PASS, exemplar artifact paths and hashes recorded.
- [ ] **Step 6: Commit code/fixtures only; keep raw rendered client artifacts outside git.** `git add fixtures tests/regression Work/Enaction\ Labs/부산_서구약사회_AI해커톤_협력제안/build_external_redesign.py && git commit -m "test: add anonymized architecture regression fixtures"`

### Task 9: Version packages and run clean-build/install verification

**Files:**
- Modify: `apps/public-proposal-cli/package.json`
- Modify: `apps/kpp-cli/package.json`
- Modify: `packages/schemas/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/renderers/package.json`
- Modify: `packages/audits/package.json`
- Modify: root lockfile and compatibility documentation generated by the repository scripts
- Modify: `apps/public-proposal-cli/plugin/.codex-plugin/plugin.json`
- Modify: `apps/public-proposal-cli/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json`
- Test: `tests/e2e/public-proposal-install.test.ts`
- Test: `scripts/verify_public_proposal_release.mjs`

**Interfaces:**
- Publish versions exactly `0.2.0` for installer and `0.3.0` for five KPP packages.
- All internal dependency ranges, worker protocol, plugin version, bundle manifest, and clean-install diagnostics agree.

- [ ] **Step 1: Add failing version-matrix assertions.** Assert six package versions and all internal dependency edges match the target matrix; assert stale plugin/worker versions fail verification.
- [ ] **Step 2: Run the matrix test to verify failure.** Run `npm test -- tests/e2e/public-proposal-install.test.ts` and `node scripts/verify_public_proposal_release.mjs`. Expected: FAIL against current versions.
- [ ] **Step 3: Bump versions and regenerate generated manifests.** Update package dependencies together, run both sync scripts, and preserve package-lock integrity.
- [ ] **Step 4: Build, pack, and install cleanly.** Run `npm run build`, `npm run typecheck`, `npm test`, `npm run pack`, install each packed package into a temporary clean prefix, run installer setup/doctor, then run the installed-package forward-test role.
- [ ] **Step 5: Verify registry preconditions without publishing.** Run `npm view` for all six names and record existing `latest`/`beta` values plus package tarball integrity; do not mutate registry state.
- [ ] **Step 6: Commit.** `git add package.json package-lock.json apps packages scripts tests && git commit -m "release: prepare KPP vNext package matrix"`

### Task 10: Final technical gate and user-facing rendered exemplar approval stop

**Files:**
- Create: `artifacts/release/kpp-vnext-forward-test-receipt.json` outside the package tarballs
- Create: `artifacts/release/pharmacy-private-partnership-render-summary.json` outside git if it contains client-derived paths
- Modify: `scripts/verify_public_proposal_release.mjs`

- [ ] **Step 1: Run the four independent forward-test roles.** Record structured receipts for schema/reference integrity, Korean narrative/page continuity, figure value/repetition, and installed npm final gate. Include commit/artifact hashes and unresolved risks.
- [ ] **Step 2: Run repository verification.** Run `npm run build`, `npm run typecheck`, `npm test`, `npm run verify:public-proposal`, the Python worker suite, plugin validation, clean-install doctor, and the pharmacy render/audit suite.
- [ ] **Step 3: Inspect release artifacts.** Confirm architecture/reference/observation/audit/prose receipts are hash-bound, no raw historical documents are packaged, and all mode/version/parity checks pass.
- [ ] **Step 4: Present the pharmacy PDF/contact sheet and audit summary to the user.** Stop here. Do not push, tag, create a GitHub release, publish npm, or move `latest` until the user explicitly approves the rendered exemplar.

### Task 11: Post-approval GitHub and npm publication with rollback evidence

**Files:**
- Create: `artifacts/release/npm-prepublish-dist-tags.json`
- Create: `artifacts/release/npm-postpublish-verification.json`
- Create: `artifacts/release/github-release-receipt.json`
- Modify: `docs/README.md` or package release notes with the published versions and migration command

**Interfaces:**
- Publication inputs are the exact approved commit and six packed artifacts; no rebuild from an uncommitted tree is permitted.
- Receipts record previous/new dist-tags, package integrity hashes, commit SHA, tag names, GitHub release URLs, clean-install results, and rollback command.

- [ ] **Step 1: Reconfirm user approval and clean tree.** Verify the approval receipt refers to the exact pharmacy render hashes and `git status --short` is empty.
- [ ] **Step 2: Record registry state.** Run `npm view @longtable/public-proposal dist-tags version --json`, `npm view @longtable/kpp-cli dist-tags version --json`, `npm view @longtable/kpp-core dist-tags version --json`, `npm view @longtable/kpp-schemas dist-tags version --json`, `npm view @longtable/kpp-renderers dist-tags version --json`, and `npm view @longtable/kpp-audits dist-tags version --json`; save the output before mutation.
- [ ] **Step 3: Push and tag approved commit.** Push the feature branch/merge commit to GitHub main only under the previously approved repository workflow, create coordinated tags, and verify remote commit identity.
- [ ] **Step 4: Publish exact versions.** Publish each package with `npm publish --access public`, verify `npm view` version/integrity, and move/confirm `latest` only after all six are available.
- [ ] **Step 5: Create GitHub releases and verify clean install.** Create releases for the coordinated tags, install from the registry in a fresh temporary prefix, run `doctor`, and run the installed forward-test receipt.
- [ ] **Step 6: Record rollback evidence.** Save previous dist-tags and the non-destructive rollback command; never unpublish. Commit only release receipts/documentation if repository policy requires it.
