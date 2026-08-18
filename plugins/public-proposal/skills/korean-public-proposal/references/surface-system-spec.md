# Korean public-proposal surface system specification

Use this reference when an ordinary proposal page must look and behave like the approved A4 vector surface system. The machine authority is `assets/vector-surface-system/surface-tokens.json`; this document explains how to apply it.

## 1. Authority and inheritance

Apply `issuer rule -> approved project profile -> canonical surface tokens -> tool default`. Record every issuer override as a path, source locator, previous value, and replacement value. Never edit the canonical tokens to accommodate one issuer.

Figma, Word, HTML, SVG, and PDF are consumers of the same token file. Figma is not a second design authority. Do not round-trip unsynchronized Figma values back into the token file.

## 2. Page geometry

- Use A4 portrait, 210 x 297 mm.
- Use 14 mm top/bottom and 18 mm left/right content insets for the approved editorial surface. Use the issuer margins when specified.
- Use a 4 mm base grid. Align titles, table edges, chart plots, judgment bands, and footer labels to it.
- Keep the running header in a 9 mm zone and the page-number baseline 7 mm from the bottom.
- Target 65-82% printable-area occupancy on ordinary pages. Review below 60% or above 88%; split before shrinking type.

## 3. Typography and character spacing

Use Noto Sans CJK KR for navigation, headings, captions, tables, and labels. Use Noto Serif CJK KR for analytical body prose. If either is absent, resolve a licensed static font before drafting; do not accept silent font substitution.

| Role | Size | Line | Tracking | Weight |
|---|---:|---:|---:|---:|
| Page title | 20.5 pt | 1.12 | -0.045 em | 700 |
| Section | 12 pt | 1.22 | -0.025 em | 700 |
| Subsection | 9.2 pt | 1.25 | -0.015 em | 700 |
| Direct-answer thesis | 10.2 pt | 1.45 | default | 600 |
| Body | 9.3 pt | 1.52 | -0.004 em | 400 |
| Table | 7.9 pt | 1.32 | default | 400/700 |
| Caption | 8.5 pt | 1.30 | default | 700 |
| Source/note | 7.2 pt | 1.35 | default | 400 |

Use tracking as a measured role token, not per-line optical correction. Do not manually squeeze a heading to avoid a wrap; revise the wording or page architecture. Final evidence-bearing labels must be at least 8 pt at insertion size.

## 4. Paragraph system

- Body: justified, no first-line indent, 2.3 mm after, Korean word integrity on, widow/orphan control on.
- Direct answer: place once below the title; use a navy sans label and one substantive sentence.
- Section: 5 mm before and 2 mm after; keep with the following paragraph or surface.
- Subsection: 3.5 mm before and 1.4 mm after; keep with the next element.
- Avoid isolated one-line paragraphs, stacked slogans, excessive bold, and manual blank lines.
- Use `Ⅰ. -> 1. -> 가. -> 1) -> ①` unless the issuer supplies another hierarchy.

## 5. Table engineering

Build final text-heavy tables as Word-native tables with fixed grid geometry. Use 0.8 pt outer, 0.65 pt major, and 0.38 pt inner rules. Use 2 mm cell padding, or 1.6 x 1.4 mm only for governed compact tables. Use neutral header fill, no zebra striping, no shadow, and no rounded container.

Each table must include: sequential number, question-led title, unit or basis where relevant, source, interpretation boundary, and an action or conclusion after the table. Repeat header rows. Do not fix row heights. Express status with both word and color.

## 6. Graph and framework engineering

Select the semantic surface before styling:

| Need | Surface |
|---|---|
| trend and composition | stacked bar plus line |
| causal or research sequence | argument/work-package flow |
| selection | 2x2 matrix plus explicit gate |
| timing and ownership | Gantt plus RACI plus review gate |
| evaluator navigation | score-to-answer crosswalk |
| proof control | claim-proof-deliverable ledger |

Charts use zero-baseline value axes, units on every axis, direct labels where practical, no more than five legend items, and line/shape distinctions that survive grayscale. Lock all values, labels, connections, states, and sources in JSON/CSV. Render deterministic SVG and a 300 dpi PNG fallback. Compare the data lock to the render before insertion.

Frameworks use square nodes, straight or orthogonal connectors, 1.1 pt primary strokes, 0.55 pt secondary strokes, and explicit reading order. Every node carries a method, state, owner, evidence, threshold, or acceptance condition. Decorative icons, empty cards, free-floating bubbles, and ornamental networks are outside the system.

## 7. Box construction

Use boxes only for a semantic boundary: direct answer, judgment, gate, source note, or status. Default radius is 0 mm, shadow is none, and gradient is prohibited. Use 3 x 2.5 mm internal padding, 0.8 pt outer rule, white or neutral fill, and a 26 mm navy label band for judgment boxes. A box never exists only to fill space.

## 8. Eight page roles

1. `chapter_opener`: direct answer, linked evaluation, argument flow, judgment band.
2. `analysis_evidence`: chart, interpretation table, unit, basis date, source, boundary.
3. `literature_baseline`: synthesis table, evidence funnel, selection and transfer rules.
4. `research_method`: work-package flow, input-method-output-acceptance table.
5. `candidate_decision`: candidate frame, evidence state, risk, explicit human decision gate.
6. `roadmap_management`: Gantt, milestones, RACI, risks, report review gates.
7. `evaluation_crosswalk`: criterion, score, direct answer, page, claim, proof, status.
8. `evidence_ledger`: claim, proof, deliverable, acceptance, owner, status.

Do not force all roles onto one page. Assign one dominant reader task to each page and split when two dominant surfaces compete.

## 9. Figma bridge

Create Figma variables and component properties from `assets/vector-surface-system/figma-variable-map.json`. Use an A4 frame at 793.7008 x 1122.5197 px (96 dpi) only as a composition workspace; retain millimetres as the print authority. Build component sets named `KPP/Page`, `KPP/Table`, `KPP/Figure`, and `KPP/Box`.

Figma may test hierarchy, density, alignment, and component variants. Final Korean prose, evidence tables, scores, official forms, and data-bearing charts must be rebuilt from the approved document/data source. Export no text-bearing surface until it has passed the same-geometry reference comparison.

## 10. Production and QA

1. Copy the canonical token file into the numbered project package and add issuer overrides without changing the skill asset.
2. Assign every planned page one of the eight roles.
3. Build Word-native prose and tables; build data figures deterministically.
4. Render every page to PNG and compare at the same geometry with the approved reference.
5. Validate page size, fonts, tracking roles, paragraph rhythm, table rules, figure data, grayscale, occupancy, and status text.
6. Run `python scripts/validate_surface_system.py PROJECT/surface-tokens.json --check-fonts` before document QA. A substituted font is a failure, not a warning.
7. Promote only generic token or component improvements through a numbered round and human approval.

## Drift red flags

- more than one accent family;
- ad hoc font sizes or manually squeezed headings;
- rounded cards, shadows, gradient panels, or decorative icons;
- a table without its question, source, basis, and interpretation;
- color-only status or series distinction;
- a chart whose data cannot be reproduced from a lock file;
- Figma measurements treated as authoritative print dimensions;
- an ordinary page containing multiple unrelated dominant surfaces.
