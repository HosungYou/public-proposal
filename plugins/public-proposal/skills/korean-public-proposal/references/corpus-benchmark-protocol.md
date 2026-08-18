# Korean public-proposal corpus benchmark protocol

Use this protocol when the task asks to learn from many Korean public procurements or reports. The corpus supports comparison and reuse; it cannot create an issuer requirement.

## Evidence classes

- `official_template`: issuer RFP, writing guide, prescribed cover, annex, or official example.
- `official_notice`: procurement notice or G2B submission instruction.
- `official_pre_spec`: pre-disclosure or draft specification; never treat it as the final bid instruction.
- `report_reference`: public final/research/policy report used only for editorial and visual language.
- `actual_submission`: bidder-authored proposal whose public provenance is verified. Do not use this label for RFPs, forms, reports, or evaluation results.

Every record also declares `use_boundary`, such as `structure_only`, `submission_procedure_only`, or `visual_language_only`.

## Collection and deduplication

1. Define the date window and cohort before searching.
2. Prefer direct official issuer or G2B files. Retain landing URL, direct file URL, publication/notice date, bid number, local path, SHA-256, selected pages, and inspection status.
3. Deduplicate first by normalized bid number, then exact file hash, canonical URL, and finally issuer plus title. Preserve a list of duplicate record IDs.
4. Keep RFP, notice, annex, and report as separate evidence objects when they answer different questions; group them under one procurement only for cohort counts.
5. Never count repeated clauses or multiple renders of one source as multiple procurements.

## Field coding

For each format field use exactly one state:

- `explicit`: the inspected source states or supplies the rule.
- `no_explicit_rule`: the relevant inspected section expressly lacks the rule or the review located none.
- `unknown`: the source or relevant page was not available or not inspected sufficiently.

Do not collapse `unknown` into `no`. Record mandatory, recommended, conditional, and conflicting wording separately. A page-limit or form conflict is a clarification blocker, not a value to normalize.

Minimum fields: fixed cover, paper/orientation, margins, font/points, line spacing, heading hierarchy, prescribed TOC, evaluation crosswalk, pagination, anonymity, page cap, file groups/formats/size, presentation cap, annex count, and exact page citations.

## Frequency and transfer

- Report raw and unique counts, deduplication rule, denominator, `explicit`, `no_explicit_rule`, and `unknown` for every frequency.
- Frequency describes the sampled cohort only. It is neither law nor a default issuer rule.
- Transfer priority is: controlling issuer rule -> same-issuer recurring pattern -> applicable contract-type cohort -> public-report editorial grammar -> approved project preference.
- Exact cover geometry, type sizes, margins, page caps, file caps, anonymity lists, and presentation duration remain notice-scoped unless the controlling source for the current bid states them.
- Use `report_reference` only for human editorial grammar: restrained cover, hierarchy, density, document-native tables, captions/sources, grayscale resilience, and conservative page furniture.

## Representative packet

Select a small, inspectable packet rather than attaching the entire corpus:

1. current issuer/RFP pages;
2. one same-issuer or same-contract official format page;
3. one cross-agency format variant showing a materially different rule;
4. one or two public-report pages for ordinary body, table/figure, and roadmap grammar.

Attach rendered page images, not only URLs or extracted text. Product Design may explore their composition, but final text-bearing pages must be rebuilt deterministically.

## Promotion

Store corpus findings as versioned candidates with source IDs and the date window. Promote a reusable pattern only after rights, page inspection, regression, and human approval. A completed proposal becomes a new evidence record; it never silently retrains or overwrites the base skill.
