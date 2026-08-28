---
name: korean-public-proposal
description: Use when creating, restyling, auditing, visually benchmarking, packaging, or reusing Korean public-sector procurement proposals and research-service submissions involving a Korean RFP, 나라장터/G2B notice, proposal-writing guide, evaluation table, official annex, public-institution Word/PDF format, Product Design or ImageGen exploration, reusable issuer template, Korean official-document corpus, pattern library, regression QA, proposal summary, presentation deck, or final submission package.
---

# Korean Public Proposal

Build a mode-correct document package whose visual system is subordinate to the issuer's official documents. Treat architecture, compliance, evidence, reproducible rendering, and governed reuse as part of document design.

This is the plugin's only user-facing skill surface. KPP and LongTable remain internal governance and evidence tools. Do not expose, install, or ask the user to select separate Public Proposal or LongTable skill surfaces.

## Native document engine

Use **HWPX-first** production with issuer/source-native routing:

- If the issuer supplies an HWPX/HWP form, preserve it with the pinned upstream HWPX engine installed at `vendor/hwpx-skill/`.
- If no official editable form is mandated, author the governed content once, build HWPX as the primary editable artifact, render its PDF as the visual authority, and derive DOCX as an explicitly parity-checked secondary artifact.
- If the issuer supplies a DOCX-only form, keep that form DOCX-native; do not round-trip it through HWPX.

Before creating, cloning, filling, or validating HWPX, read `vendor/hwpx-skill/UPSTREAM-SKILL.md` and follow its decision tree and finalization sequence. Its scripts, templates, assets, references, and tests are fetched byte-for-byte from `jkf87/hwpx-skill` commit `96a2633f23a08f707679d7e212ebdc59948260e6`; `HWPX-ENGINE.json` is the hash authority. The upstream `SKILL.md` is renamed only to prevent a second discoverable skill surface.

Preserve the upstream engine. KPP may add content/evidence/page/approval contracts around it, but must not replace its HWPX construction, template cloning, namespace repair, line-cache removal, structural validation, or layout-check behavior with a DOCX generator.

The upstream engine is an internal production dependency, not a second user-facing authority. Do not relay its promotional, donation, star-request, support, onboarding, or self-identification messages to the user, and do not expose its repository as a completion footer. KPP remains the single user-facing skill surface and owns the final delivery language.

For a newly generated upstream HWPX on a macOS/Linux render host, check whether the document's declared Hamchorom faces resolve locally. If `함초롬바탕` or `함초롬돋움` is unavailable and the document is not an issuer-supplied locked form, run `scripts/normalize_hwpx_portable_fonts.py INPUT.hwpx --output PORTABLE.hwpx` before the upstream finalization sequence. This changes only the two font-face names in `Contents/header.xml`, verifies every other ZIP member byte-for-byte, and keeps all upstream structure and style IDs. Never rewrite an official issuer form's fonts merely to make a fallback renderer convenient; install the required font or use Hancom Office instead.

## Authority order

Apply rules in this order. A higher item always overrides a lower item.

1. Issuer notice, RFP, writing guide, evaluation table, annex, and written clarification.
2. Verified Korean public-sector document conventions in `references/public-document-grammar.md`.
3. The approved project design profile.
4. Product Design exploration.
5. Model defaults.

Never redesign an official annex's wording, field order, signature area, or required evidence. Keep issuer-specific exceptions in a project profile, not in this skill.

## Workflow

1. Initialize or resolve the shared library and numbered project package using `references/learning-protocol.md`. Resolve exactly one `documentMode`: `public_procurement`, `research_service`, `private_partnership`, `internal_decision`, or `document_restyle`. Then resolve its default `proseProfile` from `references/prose-profile-registry.md`; an issuer rule or verified reader task may override the default, but record the reason and protected text scope.
2. If the project is schema v1, stop and run `kpp migrate PROJECT --apply`; migration is explicit, receipt-bearing, and never an implicit side effect of read, plan, build, audit, or release.
3. Acquire the authoritative notice, RFP, annexes, and clarifications. Record URLs, versions, dates, and SHA-256 values in `R00_SourceLock`.
4. Recover any prior project package, corpus manifest, rendered sample, and accepted candidate before searching again. Treat previous outputs as evidence, not canon.
5. Classify every external source as `actual_submission`, `official_template`, `evaluation_result`, or `report_reference`. Never describe a template or RFP as an actual or winning proposal.
6. When visually benchmarking more than one procurement, use `references/corpus-benchmark-protocol.md`. Deduplicate records, preserve missing values, and report frequency only as cohort evidence. A frequent pattern never overrides an issuer rule.
7. Extract submission files, qualifications, deadlines, page/file constraints, recommended structure, detailed evaluation questions, annex fields, and conflicts.
8. Create a compliance matrix before drafting. Mark every requirement `confirmed`, `pending`, `conflict`, or `blocked`.
9. Extract issuer visual grammar into `R01_IssuerVisualCanon`. Record page-level observations and use boundaries. Keep it as a candidate until source, rights, visual, content, and regression gates pass.
10. Resolve the document profile from issuer rules first. If unspecified, use `references/surface-system-spec.md` and its machine authority `assets/vector-surface-system/surface-tokens.json`, then apply `references/public-document-grammar.md`, `references/table-grammar.md`, `references/figure-grammar.md`, and `references/korean-report-visual-system.md`.
11. Before any Product Design or ImageGen exploration, build and validate the visual source packet described in `references/product-design-bridge.md`. Attach the actual rendered Korean reference pages to every generation; URLs and text descriptions alone do not count.
12. Build one authoritative qualitative proposal. Before drafting, create a section-level `ProseBudget` that binds the reader question, direct answer, evaluation weight or decision importance, claims, proof, qualifications, citations, and permitted prose/table/figure mix. Derive the summary and presentation only from a human-approved proposal. Keep qualification documents separate.
13. Create a complete `PageArchitectureManifest` before build. Follow `references/vnext-contract.md`: a chapter opener may carry the 20.5 pt large title; ordinary continuation pages carry running chapter/section context and compact headings at `<=12 pt`. Never create a standalone `Page title` shell or force a page break per subsection.
14. Assign each ordinary page a mode-permitted role and satisfy `references/page-contract.md`. Bind `requirement -> answer -> page -> claim/proof -> status`; do not create facts, performance claims, personnel claims, or numbers without a ledger entry.
15. Use Word-native tables. Generate text-bearing figures from structured data with deterministic scripts. Every non-decorative figure declares `semanticValueIntent`, `decisionEffect`, `nonDuplicateOf`, `encodedVariables`, claim IDs, and evidence IDs. Product Design or Figma may define composition, hierarchy, density, and topology but may not become a second authority or produce final Korean labels, tables, scores, annexes, or evidence-bearing figures.
16. Before final prose approval, run the fact-preserving editorial workflow in `references/prose-proofreading-workflow.md`: freeze semantic invariants, revise against the selected prose profile, compare the change ledger, and reject compression that removes a qualification, responsibility boundary, evidence locator, or necessary reasoning. Then run prose, structure, geometry, font, figure, render, PDF, evaluator-navigation, submission, and inherited-requirement regression checks. Run both `proposal_slop_lint.py` and mode-aware `audit_prose_contract.py`; tables and figures do not satisfy prose depth by themselves. Run `audit_surface_contract.py` against the produced DOCX, deterministic SVG directory, and hash-bound render manifest; a prose `PASS` field is not a surface audit. Convert verified failures into fixtures and enforced invariants using `references/incident-learning-protocol.md`.
17. Render every page to PNG and run the independent rendered-visual gate. The renderer's manifest is mandatory: bind the inspected PDF hash/byte count and every numbered page PNG hash/byte count, then reject missing, swapped, stale, or incomplete entries. Bind every embedded figure PNG hash and aspect ratio to its source SVG and architecture page; classify rasterized RACI as `svg-raci-matrix` and reserve `word-native-raci-table` for a genuine Word-native table. Inspect one full-page view and a zoomed crop of every table and figure; check page edges, table reflow, figure-label legibility, connector/node collisions, and whether the evaluator task is answerable at print size. The visual gate must record page dimensions, text/image boxes, SVG text overflow/hidden-label checks, page-density observations, surface diversity, and a per-page human-review checklist. Block three consecutive structurally equivalent pages unless a source-bound issuer/accessibility exception passes the repetition audit.
18. Require a mode-aware `CompositeAuditReceipt` that binds architecture, references, render observations, audit artifacts, and all required audit slices. `TECHNICAL_GATE_ONLY` never means human approval.
19. After completion, extract reusable candidates. Never promote project-only facts or patterns without explicit human approval.

## Page-architecture stop rules

| Pressure | Binding ruling |
|---|---|
| Deadline: “keep the existing page shell” | Deadline does not authorize a large title or forced break on each ordinary page. Reflow and render again. |
| Sunk template: “20.5 pt already paginates” | The 20.5 pt token belongs to cover/chapter roles, not every body page. Existing approval does not change `titleScope`. |
| Issuer silence or senior preference | Silence activates the compact continuation default. Only a verified issuer rule can authorize an override. |
| “The content differs, so topology repetition is harmless” | Three consecutive structurally equivalent pages block release even when their prose differs. |

Red flags: a page helper that always accepts `title`; an explicit break after every subsection; repeated title/lead/judgment bands; continuation pages with headings over 12 pt; a release claim based only on technical PASS. Stop, correct the architecture, rerender, and reaudit.

## Native production and DOCX derivation

For HWPX-native work, use the pinned engine above and its `geomto.py`, `yoyak.py`, `md2hwpx.py`, template-cloning, finalization, and validation paths as routed by the upstream decision tree. For a required DOCX-native issuer form or the requested secondary DOCX derivative, use the `documents` and `korean-word-common` skills together. Those skills provide OOXML construction and Korean Word hygiene; they do not supply an independent visual design. The issuer form or KPP project profile, A4 template, surface tokens, page architecture, and governed content remain authoritative. Do not route the DOCX through a generic standalone builder that discards those authorities. Never label a DOCX derivative as layout-identical until page-by-page parity has been inspected.

Build HWPX and DOCX from the same governed content model. Record a derivative manifest that binds the source content, KPP profile, template, output hashes, and page-by-page review. If the host cannot render HWPX, report that visual parity as unavailable and keep the artifact at `review_candidate`; structural HWPX validation and a polished DOCX render do not impersonate HWPX visual approval.

Run `scripts/audit_derivative_parity.py` against the locked design authority, HWPX-primary artifact manifest, and DOCX-derivative artifact manifest. A matching text hash or page count is not parity. The derivative audit must recompute artifact and page hashes, compare rendered pixels within the authority threshold, and enforce page geometry, fonts, tables, figures, and required furniture.

When portable font normalization is required, render both the normalized HWPX and the DOCX derivative from the same governed source. Require normalized-text equality, page-count parity, and page-by-page visual review; a matching page count alone does not excuse an orphan page, clipped table, missing signature block, or unreadable fallback font.

Default ordinary-page profile when the issuer is silent:

- A4 portrait; top/bottom 14 mm, left/right 18 mm; 4 mm base grid.
- Noto Sans CJK KR headings and navigation; Noto Serif CJK KR analytical body.
- Chapter-opener title 20.5 pt at -0.045 em; ordinary continuation heading at most 12 pt; body 9.3 pt at 1.52 lines and -0.004 em; tables 7.9 pt at 1.32 lines.
- Hierarchy `Ⅰ. -> 1. -> 가. -> 1) -> ①`.
- White, black, gray, and one restrained navy accent.
- Square, shadowless boxes; zero radius; gradients prohibited by default.
- Single-column body; 65-82% content-area use on ordinary pages.

### Frontier/report-readiness rubric

“Frontier” is a quality gate, not a decorative style. A candidate must have chapter-continuous navigation, a compact continuation hierarchy (only the opener may use 20.5 pt; ordinary continuation pages use `titleScope=none` or a <=12 pt section context), a visible evaluator question and direct answer, evidence-bound tables/figures that change a decision, mixed reader-facing surfaces, and no accidental sparse or repeated page run. Tables are not considered fixed until the DOCX contains a fixed `tblLayout`, governed `tblW`/`tblGrid`, matching cell widths, repeated header semantics, and a surface-audit receipt that independently verifies them. A deterministic figure is not considered safe until every text box stays inside the SVG viewBox, every connector label is outside node fills, and the inspected raster is hash-bound to its source and page. Producer claims or a structural PASS do not waive rendered visual QA. The final status remains `review_candidate` until a named human reviewer signs the rendered-page checklist.

Treat these as one governed profile. Do not mix the old sans-only office profile into ordinary analytical pages. Preserve issuer annexes exactly, even when they use a different font or geometry.

## Product Design boundary

When Product Design is explicitly invoked, read `product-design:index` and route visual alternatives to `product-design:ideate`. Follow its three-option and selection workflow, but first satisfy this skill's source-packet gate.

Provide actual issuer pages, at least two additional verified Korean official/report reference pages, structured figure data, and the approved profile as attached inputs. Use Product Design only to explore A4 composition, hierarchy, density, grouping, and topology. Match Korean public-document grammar visible in the attached pages; do not invent a generic SaaS, consulting-deck, or global-corporate style.

Product Design and ImageGen outputs are composition candidates. Do not place stochastic Korean text, numbers, evidence IDs, logos, official forms, tables, charts, maps, RACI, schedules, or annexes directly in the final proposal. Rebuild the selected direction with Word-native components or deterministic SVG/PNG renderers and compare it with the attached Korean reference pages.

When Figma is used, create variables and component sets from `assets/vector-surface-system/figma-variable-map.json`. Use millimetres and `surface-tokens.json` as print authority; Figma is a synchronized consumer. Never write ad hoc Figma measurements back into the canonical token asset. Use Figma for page-role variants and same-geometry comparison, then rebuild the approved design in the authoritative Word/data pipeline.

Final figures must pass all conditions in `references/figure-grammar.md`. Tables must follow `references/table-grammar.md`.

For Korean prose review, preserve every fact, number, date, name, citation, locator, claim ID, proof ID, and status. Bind the reviewed authoring artifact to a `CONTENT_APPROVED` receipt. Machine lint, AI-assisted Korean editing, Korean prose review, and final human content/submission approval are separate gates; none may impersonate another.

Read `references/prose-profile-registry.md` before drafting or revising substantive Korean prose. Its measured public-report grammar is the shared base, while compact `public_bullet`, longer-item `public_plan`, complete-sentence `press_release`, `evaluator_proposal`, `research_analytic`, `partnership_brief`, `executive_brief`, and `official_form_locked` adapt sentence completeness, evidence density, and text volume to the reader task. Do not force research analysis, evaluator reasoning, or a press release into nominal bullets merely to resemble a review memo.

When the user asks to polish, shorten, humanize, normalize, or improve Korean prose, read `references/prose-proofreading-workflow.md`. Editorial improvement is a controlled semantic transformation, not free rewriting: preserve the frozen fact set and decision logic, produce a locator-level change ledger, run both prose audits, and keep AI revision, Korean prose review, content approval, visual approval, and submission approval as separate receipts.

For a conceptual, theoretical, synthesized, or project-specific research framework, read `references/academic-framework-grammar.md` before Product Design or ImageGen. Lock the research logic first; stochastic output may explore composition but never define evidence-bearing relationships.

## Required gates

Run:

```bash
python scripts/proposal_learning.py regress --root PROJECT --round-id ROUND_ID
python scripts/validate_visual_source_packet.py visual-source-packet.json --out visual-source-gate.json
python scripts/validate_surface_system.py surface-tokens.json --check-fonts
python scripts/proposal_slop_lint.py proposal.docx --out slop.json
python scripts/audit_prose_contract.py proposal.docx --profile PROSE_PROFILE --out prose-audit.json
python scripts/audit_public_proposal.py proposal.docx --profile project-profile.json --out audit.json
python scripts/audit_docx_integrity.py proposal.docx --expected-min-figures MIN --figure-ledger figure-ledger.json --allowed-font "Noto Sans CJK KR" --allowed-font "Noto Serif CJK KR" --out docx-integrity.json
python scripts/audit_surface_contract.py proposal.docx --contract surface-contract.json --svg-dir figures --figure-manifest-dir figures --render-manifest render-manifest.json --out surface-audit.json
python scripts/audit_rendered_visual.py proposal.pdf --pages-dir rendered/current --svg-dir figures --contract visual-contract.json --architecture content/page-architecture.json --figure-manifest figures/build-figure-manifest.json --out visual-audit.json
python scripts/audit_derivative_parity.py design-authority.json hwpx-artifact-manifest.json docx-artifact-manifest.json --out derivative-parity.json
python scripts/validate_submission_gate.py package.json --out gate.json
```

Then run the canonical DOCX renderer from the `documents` skill and inspect all pages. Bind the `surface-audit.json`, `visual-audit.json`, and current render manifest SHA-256 values into the package QA record. `visual-audit.json` must retain `humanReviewRequired=true`; a technical PASS is not a human visual approval. A package is not submission-ready until every gate in `references/qa-gates.md` passes and a submission owner approves it.

Do not publish an npm `latest` release, GitHub release, or final submission package from a technical PASS. The final rendered exemplar must be human-approved before publication or external release.

## Resources

- `references/public-document-grammar.md`: Korean public-document layout and typography.
- `references/prose-profile-registry.md`: measured public-report prose base, mode-specific adaptations, text budgets, and review boundaries.
- `references/prose-proofreading-workflow.md`: fact-preserving Korean editorial pass, compression checks, change ledger, dual audits, and approval receipts.
- `references/surface-system-spec.md`: exact A4 geometry, typography, tracking, paragraph, table, chart, box, surface-recipe, Figma, and drift rules.
- `references/table-grammar.md`: native Word table rules and allowed table types.
- `references/figure-grammar.md`: structured-data figure types and final-use conditions.
- `references/academic-framework-grammar.md`: academic provenance classes, LongTable research lock, and ImageGen routing.
- `references/korean-report-visual-system.md`: semantic table, framework, matrix, chart, and page contracts for reusable Korean report surfaces.
- `references/qa-gates.md`: compliance and submission gates.
- `references/learning-protocol.md`: shared library, numbered rounds, promotion, and regression rules.
- `references/incident-learning-protocol.md`: production-incident records, fixtures, invariants, and human-governed promotion.
- `references/visual-qa-protocol.md`: independent rendered-page, table-geometry, SVG text-safety, density, and human-review protocol.
- `references/product-design-bridge.md`: Korean visual-reference packet and Product Design/ImageGen boundary.
- `references/page-contract.md`: evaluator-centered page completion and navigation rules.
- `references/vnext-contract.md`: document modes, title roles, machine fields, receipts, release checklist, and review-agent boundaries.
- `references/corpus-benchmark-protocol.md`: recent-source corpus coding, deduplication, frequency, and transfer boundaries.
- `scripts/proposal_learning.py`: project package and reusable pattern lifecycle controller.
- `scripts/normalize_hwpx_portable_fonts.py`: generated-HWPX Hamchorom-to-Noto font binding with unrelated-member byte preservation.
- `scripts/validate_visual_source_packet.py`: source classification, attachment, rights, and ImageGen-boundary gate.
- `scripts/audit_public_proposal.py`: DOCX geometry/style/table audit.
- `scripts/audit_docx_integrity.py`: drawing, caption, media relationship, ledger, extent, and font-allowlist blocker.
- `scripts/audit_surface_contract.py`: byte-bound DOCX table, deterministic SVG, and render-manifest surface contract audit.
- `scripts/audit_rendered_visual.py`: independent PDF/PNG/SVG visual gate; catches page clipping, text/image overlap, table/figure boundary drift, connector-label hiding, topology repetition, and missing surface diversity.
- `scripts/audit_derivative_parity.py`: HWPX-primary versus DOCX-derivative authority, content, hash, rendered-pixel, geometry, font, table, figure, and furniture gate.
- `scripts/render_flow_figure.py`: deterministic flow-figure renderer.
- `scripts/proposal_slop_lint.py`: placeholder, repetition, and AI-writing-pattern lint.
- `scripts/audit_prose_contract.py`: mode-aware Korean ending, rhetoric, line-length, evidence-visibility, and prose-depth audit.
- `scripts/validate_submission_gate.py`: package-level gate evaluator.
- `scripts/validate_surface_system.py`: canonical surface-token drift validator.
- `assets/vector-surface-system/surface-tokens.json`: machine authority for the approved vector surface.
- `assets/vector-surface-system/figma-variable-map.json`: one-way Figma variable and component mapping.
- `assets/vector-surface-system/a4-vector-surface.css`: reproducible A4 HTML/PDF component implementation of the tokens.
- `assets/`: A4 template, surface tokens, and approved font assets.
