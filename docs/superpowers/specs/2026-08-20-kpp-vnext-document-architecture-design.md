# KPP vNext Document Architecture Design

**Status:** Proposed for user review

**Date:** 2026-08-20

**Target releases:** `@longtable/public-proposal@0.2.0`; `@longtable/kpp-{cli,core,schemas,renderers,audits}@0.3.0`

**Migration:** Explicit only; no read-time or command-time silent migration

## 1. Problem and outcome

The current KPP pipeline reliably binds files and stage receipts, but it does not bind the qualities that make a proposal readable and decision-useful. A document can pass the existing checks while repeating the same surface on every page: navigation strip, 20.5-point title, short lead, shallow box diagram or table, and judgment band. Page roles are declared by the authoring input instead of being independently verified from the rendered artifact; visual-reference completeness is not a release-blocking general reference check; and figure checks reward presence more than semantic value.

This release makes document architecture a versioned, hash-bound contract. It must prevent title-per-page layouts, repeated surface topology, decorative diagrams, dangling references, and unreviewed machine-like Korean prose before release. It must also support public procurement, research-service, private-partnership, internal-decision, and document-restyle work without pretending that all five are procurement submissions.

## 2. Scope

### 2.1 In scope

- Add five explicit document modes and mode-specific release policies.
- Add a locked page-architecture manifest and derive rendered-page observations independently.
- Enforce title hierarchy and cross-page narrative continuity.
- Add general reference integrity and figure semantic-value contracts.
- Produce hash-bound audit receipts for architecture, references, repetition, figures, and Korean prose review.
- Require explicit project migration with backup and migration receipt.
- Update the canonical plugin skill and the bundled installer snapshot from one source.
- Add anonymized regression fixtures derived from the pharmacy-hackathon, gsolverthon, KEITI C11, and R08 failure/success patterns.
- Regenerate the pharmacy-hackathon proposal in `private_partnership` mode as the human approval exemplar.
- Publish all six packages to `latest` only after the user approves that rendered exemplar.

### 2.2 Out of scope

- Replacing issuer-supplied forms, legal quotations, or mandatory chapter numbering.
- Using generative-image quality as evidence of document quality.
- Automatically rewriting factual content during migration or `document_restyle`.
- Shipping source client documents, raw DOCX/PDF fixtures, personal data, or proprietary proposal text in npm packages.
- Unpublishing prior npm versions. Rollback uses a patch release or a `latest` dist-tag move to a known-good published version.

## 3. Approaches considered

### 3.1 Prompt-only skill revision

This is low effort but repeats the current failure: prose instructions can be diagnosed correctly and still be bypassed by a generator with a fixed `page_start()` template. It provides no migration, receipt, or release evidence.

### 3.2 Audit-only post-render lint

This can catch some repetition but finds structural problems after authoring and cannot express mode-specific intent or bind the intended architecture to the build. It also encourages threshold gaming.

### 3.3 Integrated contract, renderer, and release gates — selected

Add a mode policy and page-architecture contract before authoring, observe the rendered artifact independently, compare intent to observation, and bind the resulting audit receipts into release. This touches more packages but places each rule at the stage where it can be corrected and makes regressions testable.

## 4. Document modes

`DocumentMode` is independent of the existing `ProposalClass`. `ProposalClass` continues to answer whether research locks or procurement-specific evidence are required. `DocumentMode` controls page grammar, required decision surfaces, audits, and release artifacts.

| Mode | Primary reader decision | Required policy emphasis | Must not be assumed |
|---|---|---|---|
| `public_procurement` | Whether the bidder satisfies and outperforms the RFP | requirement-to-answer-to-proof traceability, evaluation crosswalk, delivery controls | that every page needs an evaluation question |
| `research_service` | Whether the research can produce credible, usable findings | research lock, methods, data/evidence, limitations, utilization | that a diagram substitutes for a method or source |
| `private_partnership` | Whether and how two parties should collaborate | mutual value, roles, operating model, options, conditions, next decision | procurement scoring or government-report ceremony |
| `internal_decision` | Which option an accountable owner should approve | decision, alternatives, trade-offs, risks, owner, approval record | external marketing language |
| `document_restyle` | Whether an existing document can be made clearer without changing facts | source-to-output content ledger, layout/accessibility, mutation report | new claims, altered numbers, or inferred commitments |

Each mode policy declares required page roles, allowed artifact classes, required audit slices, and release allowlists. The policy registry lives in core and is consumed by CLI, renderer, audits, and release; packages must not maintain divergent copies.

## 5. Versioned contracts

### 5.1 Project schema v2

`kpp.project.yaml` schema version `2.0.0` adds:

- `documentMode`: one of the five literals above.
- `modePolicyVersion`: initially `1.0.0`.
- `migrationHistory`: ordered migration receipt identifiers only; receipts hold file hashes and details.

All new downstream manifests carry `projectId`, `documentMode`, and `modePolicyVersion`. A mismatch is a hard error, not a warning.

### 5.2 Page architecture manifest

`content/page-architecture.json` is ordered and locked before content approval. It contains:

- document identity and mode fields;
- chapter and section hierarchy;
- one record per planned page;
- `pageId`, `chapterId`, `sectionId`, `pageRole`, and `surfaceTemplateId`;
- `titleScope`: `cover | chapter | section | surface | none`;
- `continuation`: boolean;
- `dominantSurface`: `narrative | table | figure | mixed | form`;
- optional `evaluationQuestion` and `directAnswer`, visible only when `surfaceVisibility` is `reader`;
- `claimIds`, `proofIds`, `referenceIds`, and `figureIds`;
- `continuityFromPageId` and `continuityToPageId` where the argument crosses pages;
- a documented issuer override when a mandatory form conflicts with the default hierarchy.

The existing page plan remains the production assignment list. The architecture manifest is the reader-facing structure and reference graph. Both are bound into the authoring bundle; they may not silently infer or overwrite one another.

### 5.3 Title hierarchy invariant

- A 20.5-point large title is permitted only on the cover or a genuine chapter opener.
- A continuation page must not render a large page title. Its strongest new heading is at most 12 points unless an issuer override identifies the mandatory source rule.
- Section and surface headings may appear where needed, but their size and spacing must preserve continuity with the prior page.
- Evaluation questions and direct answers are internal authoring fields by default. They appear on the reader surface only when the mode policy and page intent make them useful.
- Running headers identify document context; they do not restate the page title.

No rule requires one title, one subtitle, one lead, one figure/table, or one judgment band per page.

### 5.4 Render observation manifest

The renderer emits `render/page-observations.json` from the actual DOCX/PDF/page images. Each observation records measurable heading sizes, detected title blocks, surface family, text density, table/figure geometry, repeated region fingerprints, caption/figure links, and cross-page continuation markers. It never copies `pageRole` or title compliance from the planned manifest without observation.

Audits compare plan intent with render observations. A self-declared page role is insufficient evidence of compliance.

### 5.5 Reference manifest

`evidence/reference-manifest.json` generalizes source bindings beyond figures. Each record has:

- stable `referenceId` and class;
- local path or URI, locator, classification/rights state, and source SHA-256 when bytes are available;
- target claim, proof, page, figure, table, or quotation IDs;
- verification status and verification date;
- explicit external/unavailable state where hashing is impossible.

Every referenced ID must resolve, every available source hash must match, and every target must exist. Undeclared references and dangling `SRC-*` identifiers block release. Visual-source packets remain stricter figure-specific evidence and are linked from this manifest rather than replaced.

### 5.6 Figure semantic-value contract

Every non-decorative figure declares one primary intent:

- `data_evidence`: makes a sourced magnitude, distribution, comparison, or trend inspectable;
- `causal_mechanism`: shows a defensible relationship that prose alone obscures;
- `decision_tradeoff`: exposes alternatives, criteria, consequences, or thresholds;
- `operational_control`: makes owner, timing, handoff, state, or acceptance logic actionable.

It also declares the decision it changes, source/reference IDs, encoded variables or states, and the prose/table it does not merely duplicate. A figure fails when it restates adjacent prose, repeats an earlier topology without new decision content, has no inspectable evidence or operating implication, or uses decoration as proof. There is no fixed figure or table count.

Decorative assets are labeled `decorative`, have empty evidentiary claims, and are excluded from semantic-value credit.

## 6. Audit and receipt model

Technical audit emits independent, hash-bound reports and a composite receipt:

| Audit | Core question | Blocking examples |
|---|---|---|
| `page_architecture` | Does the rendered hierarchy match the locked architecture and mode policy? | large title on continuation page; copied declared role; missing continuity |
| `reference_integrity` | Do all references and targets resolve to verified sources/artifacts? | dangling ID; stale source hash; unbound visual source |
| `render_repetition` | Does the document vary surfaces according to content rather than a page template? | repeated title/lead/box/band topology; same region fingerprint across a run |
| `figure_value` | Does each evidentiary figure add data, causal, trade-off, or operational value? | adjacent-prose restatement; repeated topology; no changed decision |
| `korean_prose_review` | Has fact-preserving human-quality Korean review been completed and bound to the exact content? | free-form PASS; changed fact; missing reviewer scope/hash |

Each report returns structured findings with rule ID, severity, page/artifact locator, observed evidence, expected contract, and remediation. Release accepts only machine-validated receipt schemas whose input hashes match current artifacts. A string such as `PASS`, a checkbox, or an agent assertion is never sufficient.

The Korean prose receipt records input/output hashes, reviewer type, reviewed page/block IDs, excluded official-form/legal-quote ranges, and a fact-preservation result. It does not claim that legal or issuer text was rewritten.

## 7. Repetition and continuity detection

Repetition is evaluated as a sequence, not by a fixed global quota. The audit combines:

- normalized heading hierarchy and block order;
- page-region geometry fingerprints;
- surface-family runs;
- table/figure topology signatures;
- repeated lead and judgment-band language;
- continuity links and unresolved forward/back references.

A repeated surface is allowed when the content model requires it, such as a mandatory form or a genuinely comparable option matrix. The exception must be declared, mode-permitted, and linked to its reason. The audit blocks unexplained runs that recreate the same page skeleton, but it does not force cosmetic variation.

## 8. Explicit migration

No existing project is upgraded during `doctor`, `plan`, `build`, `audit`, or `release`.

`kpp migrate --project <path> --to 2.0.0` performs a dry run and reports required decisions. `--apply` is required to write. Application:

1. verifies the current project and receipt chain;
2. creates a timestamped backup beside the project metadata without deleting source artifacts;
3. requires an explicit `--document-mode` when it cannot be proven from existing metadata;
4. creates the v2 project metadata and architecture/reference skeletons without inventing claims or content;
5. writes a migration report and receipt with migration ID, from/to versions, source/destination hashes, backup path, decisions, and warnings;
6. leaves downstream approval/release stages blocked until the new manifests and audits are completed.

`doctor` diagnoses the required migration and prints the exact command. It never applies it. Unsupported or ambiguous migrations fail closed and preserve the original files.

## 9. Renderer and authoring behavior

Renderers consume semantic page roles and architecture rather than a universal page shell. Surface families include narrative continuation, evidence analysis, process/control, comparison/decision, schedule/ownership, and mandatory form. A family defines composition primitives, not a fixed page template.

The authoring skill must instruct agents to:

- structure an argument across pages before selecting surfaces;
- keep evaluation questions/direct answers internal unless reader value is explicit;
- choose figures only after naming their semantic intent and decision effect;
- preserve issuer requirements through recorded overrides;
- write natural Korean report prose before decoration;
- treat document QA, human prose review, approval, and release as separate gates.

The renderer rejects a page whose requested title scope conflicts with its continuation status or mode policy. It does not silently downgrade or resize the title.

## 10. Plugin and package source of truth

The canonical plugin source is `plugins/public-proposal`. The installer snapshot under `apps/public-proposal-cli/plugin` is generated and verified from that source. The canonical Python worker source is `workers/docx-python`; `apps/public-proposal-cli/worker` is its generated installer snapshot. Local skill installations, managed worker copies, and plugin cache copies are deployment outputs, never edited as canonical source.

A bundle verification step compares file lists and SHA-256 hashes for both duplicated trees and fails package verification on drift. The updated skill, references, scripts, schemas, governed worker files, and fixture findings must be included in the installer package dry-run before publish.

Package compatibility after release:

| Package family | Version |
|---|---|
| `@longtable/public-proposal` | `0.2.0` |
| `@longtable/kpp-cli` | `0.3.0` |
| `@longtable/kpp-core` | `0.3.0` |
| `@longtable/kpp-schemas` | `0.3.0` |
| `@longtable/kpp-renderers` | `0.3.0` |
| `@longtable/kpp-audits` | `0.3.0` |

The compatibility matrix, worker protocol compatibility, lockfile, package manifests, plugin bundle manifest, and CLI diagnostic output must agree.

## 11. Regression fixtures and forward tests

Raw historical client documents are not committed or packaged. Each regression fixture contains synthetic Korean content, structured architecture/reference/figure inputs, expected findings, and a provenance note naming only the failure pattern plus a source-file hash held outside the package when permitted.

Required fixture families:

- pharmacy-hackathon negative: title-per-page and repeated topology; positive: private-partnership continuity and varied decision surfaces;
- gsolverthon negative: repeated shallow table/figure rhythm and page-contract language leaked to readers;
- KEITI C11 negative: visual authority and document-integrity regressions;
- R08 positive: accepted token hierarchy and page-role diversity;
- dangling reference, stale hash, decorative figure, prose-restatement figure, issuer override, and explicit migration cases.

Four independent forward-test roles produce review receipts during release preparation:

1. schema and reference integrity;
2. Korean narrative and page continuity;
3. figure semantic value and visual repetition;
4. installed npm package and final release gate.

Subagent counts are not evidence. Each role receipt must identify its scope, exact package/commit or artifact hashes, commands or inspection method, findings, unresolved risks, and verdict. The final release gate verifies receipt structure and artifact identity.

## 12. Pharmacy-hackathon approval exemplar

The existing proposal is regenerated in `private_partnership` mode from its fact-locked content. The redesign must:

- remove the universal nav → 20.5-point title → lead → caption → box/table → judgment-band page skeleton;
- use a large title only for the cover and genuine chapter openers;
- express mutual value, responsibilities, operating flow, alternatives/conditions, and next decisions;
- keep unconfirmed facts visibly unconfirmed;
- pass architecture, reference, repetition, figure-value, Korean prose, DOCX integrity, and rendered-page audits.

The user receives the rendered PDF and contact sheet plus audit summary. This human visual review is a separate blocking gate. No npm `latest` publish, GitHub release, or release tag occurs until the user explicitly approves this exemplar.

## 13. Release sequence and rollback

1. Implement and test on a feature worktree.
2. Run package build, typecheck, unit/integration tests, fixture regressions, plugin bundle verification, installer dry-run, and worker tests.
3. Install the packed artifacts into a clean temporary Codex home and run `doctor` plus the installed-package forward test.
4. Regenerate and audit the pharmacy exemplar.
5. Present the rendered exemplar to the user and stop for explicit approval.
6. After approval, merge/push the approved commit, publish all six exact versions, verify registry metadata and clean installs, move `latest`, create signed/annotated tags as repository policy permits, and create GitHub releases.
7. Record previous and new dist-tags, package integrity hashes, Git commit, release URLs, and forward-test receipts.

If a post-publish defect is found, do not unpublish. Move `latest` back to the recorded known-good version when compatible, or publish a corrective patch and point `latest` to it. Report any schema or project rollback limits explicitly; migrated projects retain their backups.

## 14. Acceptance criteria

The implementation is complete only when all of the following are true:

- v1 projects are never silently migrated and v2 projects require an explicit document mode.
- All five modes initialize, plan, build, render, audit, and release according to their own policy.
- A continuation page with a 20.5-point title fails with a page locator and rule ID.
- The known pharmacy/gsolverthon repeated skeleton fails; the redesigned pharmacy fixture passes.
- A decorative or prose-restatement diagram receives no semantic-value credit and blocks evidentiary use.
- Dangling, stale, or unbound references block release.
- Page-role compliance is derived from render observations rather than trusted from the page plan.
- Korean prose review is fact-preserving, scoped, hash-bound, and independently gated.
- Canonical plugin source, installer snapshot, clean installation, and local installed skill are hash-consistent.
- All six package versions and compatibility declarations agree.
- The user approves the regenerated pharmacy render before any `latest` publication.
- Registry, clean-install, Git tag, GitHub release, and rollback metadata are verified after publication.

## 15. Security, privacy, and failure behavior

- Fixture generation strips personal, client-confidential, and proprietary content; package tests use only synthetic text and structured findings.
- Migration and release fail closed on unknown schema versions, mismatched hashes, ambiguous mode, missing receipts, or unsupported artifact classes.
- Commands print actionable remediation without exposing source document contents.
- Build and audit never mutate locked source/evidence files.
- External publication remains a deliberate operator action after all local and human gates pass.
