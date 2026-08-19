# Public-proposal figure grammar

## Permitted figure families

1. Institutional baseline map.
2. Research and evidence workflow.
3. Evidence or readiness matrix.
4. Priority distribution with confidence and risk gates.
5. Multi-track roadmap with dependencies and exit criteria.
6. Governance or RACI relationship map.

Every figure must answer one question. The title states the question or conclusion. Nodes carry an operational definition, evidence item, threshold, score, owner, or decision state.

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

## Visual Evidence Compiler vNext

- Compile the six beta relationships—time trend, comparison, composition, requirement matrix, process, and research framework—from `SemanticFigureSpecV1`, declared datasets, and approved governed references.
- A governed reference records storage class, rights status, source SHA-256, page locator, transfer boundary, reference family, and explicit approval. Private source pages remain project-private; only extracted patterns or synthetic canonical fixtures may be reusable.
- The canonical IR owns final Korean labels, values, scale, nodes, edges, captions, data IDs, source IDs, and claim IDs. Candidate generation may explore two or three distinct reading strategies, but generated pixels never supply final facts or text.
- The same semantic input, data, approved references, and renderer version must produce identical SVG bytes and hashes. Locked rasterization may derive PNG for DOCX placement, and its bytes must remain linked to the canonical SVG hash.
- Every plotted point, cell, node, and edge must retain raw locator, source hash, data ID, and claim IDs. Never accept a visual-only provenance statement.
- Compiler output is `not_authorized` to self-approve. Independent audit and human approval are separate gates.

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
10. Time-trend lines have at least eight temporal observations; otherwise use an honest fallback form.
11. Units, denominators, scale, caption sources, and section callout agree with the bound datasets.
12. Automated QA checks collision, clipping, contrast, grayscale, A4 footprint, repeated geometry, and hash-linked lineage.
13. `human_approved` requires two independent reviewers to approve meaning, trustworthiness, document fit, and send-ready usability in final A4 page context.

If any gate fails, do not place the figure in the proposal. Simplify or reconstruct it.
