# Public-proposal figure grammar

## Permitted figure families

1. Institutional baseline map.
2. Research and evidence workflow.
3. Evidence or readiness matrix.
4. Priority distribution with confidence and risk gates.
5. Multi-track roadmap with dependencies and exit criteria.
6. Governance or RACI relationship map.

Every figure must answer one question. The title states the question or conclusion. Nodes carry an operational definition, evidence item, threshold, score, owner, or decision state.

Every non-decorative figure also declares `semanticValueIntent`, `decisionEffect`, `nonDuplicateOf`, `encodedVariables`, claim IDs, and evidence IDs. It must add a decision-relevant relationship or value not already supplied by neighboring prose/table content. `decorative` is explicit, carries no evidentiary bindings, and cannot serve as proof.

For conceptual or research frameworks, first classify the figure and lock its research logic using `academic-framework-grammar.md`.

## Production boundary

- Product Design may define hierarchy, density, grouping, topology, and grayscale grammar.
- Use the font, color, stroke, connector, and label-size values in `assets/vector-surface-system/surface-tokens.json`; issuer/project overrides must be declared.
- Lock nodes, connections, labels, values, evidence IDs, and states in JSON or YAML.
- Render text-bearing figures deterministically from the locked data.
- Use SVG for line, matrix, and dependency figures where the document toolchain preserves it. Otherwise use a 300 dpi PNG.
- Use line type, weight, numbering, and grayscale before color.
- Use square nodes by default, zero radius, no shadow, straight or orthogonal connectors, 1.1 pt primary connections, and 0.55 pt secondary connections.
- Do not use generated logos, decorative icons, empty quadrants, unlabeled bubbles, generic people, landscapes, or ornamental networks.
- Do not use ImageGen for charts, Gantt, RACI, evidence matrices, tables, or simple structured flows. Use it only for topology exploration permitted by `academic-framework-grammar.md`, then rebuild deterministically.
- When editing DOCX prose, never assign text to a run that contains `w:drawing`, `w:pict`, `w:object`, or equation XML. Preserve the non-text children and verify drawing counts before and after mutation.

## Final-use gates

1. Every label and number matches the locked input.
2. No missing, reversed, or ambiguous connections.
3. At least 300 dpi or vector quality.
4. Legible in grayscale and at print size.
5. Text is equivalent to at least 8 pt at insertion size.
6. Includes figure number, question-led title, source, date, and interpretation boundary.
7. A human compares the render with the input and approves it.
8. Caption count, drawing-object count, figure-ledger count, and visible rendered-figure count agree.
9. No orphan image relationship, orphan media file, or zero-size drawing remains.
10. The semantic-value and non-decorative repetition audits pass against the receipt-bound neighboring content.

If any gate fails, do not place the figure in the proposal. Simplify or reconstruct it.
