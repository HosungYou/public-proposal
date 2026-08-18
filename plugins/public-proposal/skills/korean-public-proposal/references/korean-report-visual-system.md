# Korean report visual system

Use this protocol after the issuer rules and project design profile have been resolved. It standardizes the ordinary internal pages of Korean public-sector proposals without turning a reference screenshot into submission evidence.

## Visual roles

| Reader task | Surface | Required semantics |
|---|---|---|
| Exact lookup | native table | unit, basis date, grouped header where needed, source, status |
| Position, structure, or causality | framework | labeled direction, connector meaning, selected position, implication |
| Classification or choice | 2x2 matrix | named axes, high/low anchors, selected cell, selection basis |
| Trend plus composition | stacked bar plus line | zero-based value axis, units on both axes, direct values, non-color distinction |
| Evaluation traceability | evidence table | claim, evidence ID, current status, source or acceptance gate |

Do not use a row of generic cards when the content expresses a process, hierarchy, comparison, matrix, or evidence chain. Choose the semantic surface first.

## Page contract

An ordinary analytical page should contain:

1. a running header and section title;
2. one supported claim, not a slogan;
3. an evaluation locator or requirement reference;
4. one dominant table, framework, matrix, or chart;
5. a short interpretation stating what the evaluator should conclude;
6. a claim-to-evidence table when the page makes scored claims;
7. figure/table number, title, source, basis date, and page number.

Keep the palette to black, white, neutrals, and one approved issuer/project accent. Color must not be the only distinction. Use a single Korean font family and preserve the project profile's exact point sizes.

### Evaluator-rail analytical page

Use a two-zone page when an evaluator must read evidence and its decision boundary together:

| Zone | Required content |
|---|---|
| main evidence column | section title, one claim, evidence-bearing chart/table/framework, interpretation, source and basis date |
| evaluator annotation rail | evaluation question, claim status, evidence ID, use boundary, unresolved verification question |

Keep the rail narrow and visually subordinate. It may summarize an evidence state; it must not introduce a new fact. Build the table and text as Word-native components. Insert only charts and complex frameworks as deterministic rendered assets. If the page becomes too tall, split the analysis across pages instead of shrinking body text or allowing a table to spill alone.

Treat the selected screenshot as a geometry target. Render the final DOCX page, place it beside the reference in a same-geometry comparison, inspect title scale, content density, rail width, chart legibility, source placement, and page balance, then iterate. Preserve issuer rules and verified content even when that prevents pixel identity.

## Structured-input contract

Every renderer input must declare:

```json
{
  "status": "verified_evidence | composition_candidate | visual_reference_only",
  "proposal_evidence": false,
  "source": {"label": "...", "verification": "..."},
  "claim_id": "...",
  "evidence_ids": ["..."]
}
```

Only `verified_evidence` inputs with `proposal_evidence=true` may carry facts into the authoritative proposal. Product Design, ImageGen, screenshots, example reports, and user-supplied crops may define composition and visual grammar, but not final Korean text, numbers, or claims.

## Deterministic output

- Render text-bearing figures from JSON/CSV with a deterministic local renderer.
- Produce SVG plus 300 dpi PNG; validate final insertion size at 8 pt or larger.
- Use Word-native tables for final tables. Use rendered assets for charts and complex frameworks.
- Lock font paths, page geometry, palette, stroke widths, units, and label positions in tokens.
- Run the renderer twice and compare hashes for deterministic PNG output.
- Compare the selected reference and rebuilt output at the same geometry; inspect cropping, spacing, font roles, borders, and source placement.
- Never report a numeric similarity threshold unless the comparison method and result are recorded. Treat `99.9%` as a governed target, not a claim.

## Reuse and promotion

Store each accepted system as a numbered round. Promote only the generic tokens, semantic roles, renderer tests, and QA rules. Keep issuer names, project claims, values, logos, and evidence IDs in the project package. A new procurement must inherit the generic protocol, then re-resolve issuer rules and fonts before rendering.
