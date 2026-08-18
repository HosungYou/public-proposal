# Product Design bridge for Korean public proposals

Use this bridge whenever Product Design, `product-design:ideate`, ImageGen, or image-based proposal exploration is requested.

## Required source packet

Create `visual-source-packet.json` before generation. Include:

1. The issuer's own notice, RFP, guide, annex, or public report page when available.
2. At least one additional Korean `official_template` page relevant to the same contract type.
3. At least one Korean `report_reference` page relevant to the same research or strategy document type.

For every reference record the URL/path, SHA-256, source class, selected pages, rendered local image paths, rights status, visual-inspection status, use boundary, and observed rules. `visual_inspected` is true only after a human or agent opened the rendered page.

Run `scripts/validate_visual_source_packet.py` before Product Design. Do not generate when the packet is blocked.

## Prompt contract

Attach the actual selected page images to every independent Product Design/ImageGen call. Include:

- A4 portrait composition target and intended page archetype.
- Issuer-mandated fields and project profile tokens.
- Observed Korean hierarchy, margins, density, table/figure grammar, numbering, caption, and grayscale behavior.
- The structural elements that may transfer and those that may not.
- A prohibition on generic consulting slides, SaaS cards, gradients, photographic collages, ornamental networks, invented logos, and fake data.
- A statement that the output is a composition board, not a final evidence-bearing page.

Do not claim a page was attached when only its URL or a text description was provided.

## Allowed outputs

- Cover composition without final labels or logos.
- Chapter-opener composition.
- Evaluator-answer page hierarchy.
- Table/figure placement and density study.
- Grayscale grouping and line/topology study.

## Prohibited final use

Never use stochastic output directly for Korean text, numbers, evidence IDs, official annexes, tables, charts, maps, schedules, RACI, risk gates, logos, signatures, seals, or claims. Rebuild the selected composition using Word-native components and deterministic renderers.

## Comparison gate

After deterministic rebuild, compare the candidate and its Korean reference pages at the same page size. Check hierarchy, density, margins, typography roles, table/figure grammar, grayscale, and evaluator reading order. Record differences and human approval in the round QA folder.
