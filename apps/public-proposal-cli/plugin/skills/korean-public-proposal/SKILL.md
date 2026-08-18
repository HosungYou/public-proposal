---
name: korean-public-proposal
description: Use when creating, restyling, auditing, visually benchmarking, packaging, or reusing Korean public-sector procurement proposals and research-service submissions involving a Korean RFP, 나라장터/G2B notice, proposal-writing guide, evaluation table, official annex, public-institution Word/PDF format, Product Design or ImageGen exploration, reusable issuer template, Korean official-document corpus, pattern library, regression QA, proposal summary, presentation deck, or final submission package.
---

# Korean Public Proposal

Build a submission package whose visual system is subordinate to the issuer's official documents. Treat compliance, evidence, reproducible rendering, and governed reuse as part of document design.

## Authority order

Apply rules in this order. A higher item always overrides a lower item.

1. Issuer notice, RFP, writing guide, evaluation table, annex, and written clarification.
2. Verified Korean public-sector document conventions in `references/public-document-grammar.md`.
3. The approved project design profile.
4. Product Design exploration.
5. Model defaults.

Never redesign an official annex's wording, field order, signature area, or required evidence. Keep issuer-specific exceptions in a project profile, not in this skill.

## Workflow

1. Initialize or resolve the shared library and numbered project package using `references/learning-protocol.md`.
2. Acquire the authoritative notice, RFP, annexes, and clarifications. Record URLs, versions, dates, and SHA-256 values in `R00_SourceLock`.
3. Recover any prior project package, corpus manifest, rendered sample, and accepted candidate before searching again. Treat previous outputs as evidence, not canon.
4. Classify every external source as `actual_submission`, `official_template`, `evaluation_result`, or `report_reference`. Never describe a template or RFP as an actual or winning proposal.
5. When visually benchmarking more than one procurement, use `references/corpus-benchmark-protocol.md`. Deduplicate records, preserve missing values, and report frequency only as cohort evidence. A frequent pattern never overrides an issuer rule.
6. Extract submission files, qualifications, deadlines, page/file constraints, recommended structure, detailed evaluation questions, annex fields, and conflicts.
7. Create a compliance matrix before drafting. Mark every requirement `confirmed`, `pending`, `conflict`, or `blocked`.
8. Extract issuer visual grammar into `R01_IssuerVisualCanon`. Record page-level observations and use boundaries. Keep it as a candidate until source, rights, visual, content, and regression gates pass.
9. Resolve the document profile from issuer rules first. If unspecified, use `references/surface-system-spec.md` and its machine authority `assets/vector-surface-system/surface-tokens.json`, then apply `references/public-document-grammar.md`, `references/table-grammar.md`, `references/figure-grammar.md`, and `references/korean-report-visual-system.md`.
10. Before any Product Design or ImageGen exploration, build and validate the visual source packet described in `references/product-design-bridge.md`. Attach the actual rendered Korean reference pages to every generation; URLs and text descriptions alone do not count.
11. Build one authoritative qualitative proposal. Derive the summary and presentation only from a human-approved proposal. Keep qualification documents separate.
12. Assign every ordinary page one of the eight roles in `references/surface-system-spec.md`, then satisfy `references/page-contract.md`. Do not put every surface on one page. Do not create facts, performance claims, personnel claims, or numbers without a ledger entry.
13. Use Word-native tables. Generate text-bearing figures from structured data with deterministic scripts. Lock character spacing, paragraph rhythm, table geometry, chart grammar, box construction, strokes, colors, and fonts to `surface-tokens.json`. Product Design or Figma may consume the same tokens to define composition, hierarchy, density, and topology but may not become a second authority or produce final Korean labels, tables, scores, annexes, or evidence-bearing figures.
14. Run prose, structure, geometry, font, figure, render, PDF, evaluator-navigation, submission, and inherited-requirement regression checks. Convert verified failures into fixtures and enforced invariants using `references/incident-learning-protocol.md`.
15. Render every page to PNG and inspect it at print size. Do not deliver a DOCX that has not passed visual and evaluator-task review.
16. After completion, extract reusable candidates. Never promote project-only facts or patterns without explicit human approval.

## Word production

Use the `documents` and `korean-word-common` skills together. Copy `assets/Korean Public Proposal A4 v1.docx` when available. Use named styles, real numbering, fixed DXA table geometry, A4 portrait, and the project profile's exact tokens.

Default ordinary-page profile when the issuer is silent:

- A4 portrait; top/bottom 14 mm, left/right 18 mm; 4 mm base grid.
- Noto Sans CJK KR headings and navigation; Noto Serif CJK KR analytical body.
- Title 20.5 pt at -0.045 em; body 9.3 pt at 1.52 lines and -0.004 em; tables 7.9 pt at 1.32 lines.
- Hierarchy `Ⅰ. -> 1. -> 가. -> 1) -> ①`.
- White, black, gray, and one restrained navy accent.
- Square, shadowless boxes; zero radius; gradients prohibited by default.
- Single-column body; 65-82% content-area use on ordinary pages.

Treat these as one governed profile. Do not mix the old sans-only office profile into ordinary analytical pages. Preserve issuer annexes exactly, even when they use a different font or geometry.

## Product Design boundary

When Product Design is explicitly invoked, read `product-design:index` and route visual alternatives to `product-design:ideate`. Follow its three-option and selection workflow, but first satisfy this skill's source-packet gate.

Provide actual issuer pages, at least two additional verified Korean official/report reference pages, structured figure data, and the approved profile as attached inputs. Use Product Design only to explore A4 composition, hierarchy, density, grouping, and topology. Match Korean public-document grammar visible in the attached pages; do not invent a generic SaaS, consulting-deck, or global-corporate style.

Product Design and ImageGen outputs are composition candidates. Do not place stochastic Korean text, numbers, evidence IDs, logos, official forms, tables, charts, maps, RACI, schedules, or annexes directly in the final proposal. Rebuild the selected direction with Word-native components or deterministic SVG/PNG renderers and compare it with the attached Korean reference pages.

When Figma is used, create variables and component sets from `assets/vector-surface-system/figma-variable-map.json`. Use millimetres and `surface-tokens.json` as print authority; Figma is a synchronized consumer. Never write ad hoc Figma measurements back into the canonical token asset. Use Figma for page-role variants and same-geometry comparison, then rebuild the approved design in the authoritative Word/data pipeline.

Final figures must pass all conditions in `references/figure-grammar.md`. Tables must follow `references/table-grammar.md`.

For a conceptual, theoretical, synthesized, or project-specific research framework, read `references/academic-framework-grammar.md` before Product Design or ImageGen. Lock the research logic first; stochastic output may explore composition but never define evidence-bearing relationships.

## Required gates

Run:

```bash
python scripts/proposal_learning.py regress --root PROJECT --round-id ROUND_ID
python scripts/validate_visual_source_packet.py visual-source-packet.json --out visual-source-gate.json
python scripts/validate_surface_system.py surface-tokens.json --check-fonts
python scripts/proposal_slop_lint.py proposal.docx --out slop.json
python scripts/audit_public_proposal.py proposal.docx --profile project-profile.json --out audit.json
python scripts/audit_docx_integrity.py proposal.docx --expected-min-figures MIN --figure-ledger figure-ledger.json --allowed-font "Noto Sans CJK KR" --allowed-font "Noto Serif CJK KR" --out docx-integrity.json
python scripts/validate_submission_gate.py package.json --out gate.json
```

Then run the canonical DOCX renderer from the `documents` skill and inspect all pages. A package is not submission-ready until every gate in `references/qa-gates.md` passes and a submission owner approves it.

## Resources

- `references/public-document-grammar.md`: Korean public-document layout and typography.
- `references/surface-system-spec.md`: exact A4 geometry, typography, tracking, paragraph, table, chart, box, page-role, Figma, and drift rules.
- `references/table-grammar.md`: native Word table rules and allowed table types.
- `references/figure-grammar.md`: structured-data figure types and final-use conditions.
- `references/academic-framework-grammar.md`: academic provenance classes, LongTable research lock, and ImageGen routing.
- `references/korean-report-visual-system.md`: semantic table, framework, matrix, chart, and page contracts for reusable Korean report surfaces.
- `references/qa-gates.md`: compliance and submission gates.
- `references/learning-protocol.md`: shared library, numbered rounds, promotion, and regression rules.
- `references/incident-learning-protocol.md`: production-incident records, fixtures, invariants, and human-governed promotion.
- `references/product-design-bridge.md`: Korean visual-reference packet and Product Design/ImageGen boundary.
- `references/page-contract.md`: evaluator-centered page completion and navigation rules.
- `references/corpus-benchmark-protocol.md`: recent-source corpus coding, deduplication, frequency, and transfer boundaries.
- `scripts/proposal_learning.py`: project package and reusable pattern lifecycle controller.
- `scripts/validate_visual_source_packet.py`: source classification, attachment, rights, and ImageGen-boundary gate.
- `scripts/audit_public_proposal.py`: DOCX geometry/style/table audit.
- `scripts/audit_docx_integrity.py`: drawing, caption, media relationship, ledger, extent, and font-allowlist blocker.
- `scripts/render_flow_figure.py`: deterministic flow-figure renderer.
- `scripts/proposal_slop_lint.py`: placeholder, repetition, and AI-writing-pattern lint.
- `scripts/validate_submission_gate.py`: package-level gate evaluator.
- `scripts/validate_surface_system.py`: canonical surface-token drift validator.
- `assets/vector-surface-system/surface-tokens.json`: machine authority for the approved vector surface.
- `assets/vector-surface-system/figma-variable-map.json`: one-way Figma variable and component mapping.
- `assets/vector-surface-system/a4-vector-surface.css`: reproducible A4 HTML/PDF component implementation of the tokens.
- `assets/`: A4 template, surface tokens, and approved font assets.
