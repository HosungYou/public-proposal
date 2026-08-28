# Korean prose profile registry

Use this registry after `documentMode` and issuer authority are resolved, before drafting or Korean prose review. It governs register, information density, and rhetorical form; it does not authorize changing facts, annex wording, or evidence status.

## Design basis

The common base is the measured public-report grammar documented in `jkf87/hwpx-skill` at commit `96a2633f23a08f707679d7e212ebdc59948260e6`, especially `references/bogo-munche.md`. That corpus measured 15 local-government working documents and 2,288 lines. Its transferable findings are:

- one line carries one thought;
- headings are shorter than items, and items are shorter than details;
- public-report bullets normally end in a noun phrase or `~함/~있음`, not a narrative `~다` sentence;
- a parenthetical lead label is short, concrete, and selectively bold;
- a conclusion line contains one judgment directly supported by the preceding facts;
- rhetorical contrast, questions, exclamations, slogans, and unsupported deontic claims are absent or exceptional;
- dates, money, units, source notes, and qualifications follow stable administrative notation.

These are a base grammar, not a universal surface style. Full-sentence reasoning is necessary in procurement responses and research reports. Adapt the base by changing sentence completeness, paragraph depth, and evidence density while preserving its restraint, specificity, and one-thought discipline.

## Default routing

| `documentMode` | Default `proseProfile` | Reader task |
|---|---|---|
| `public_procurement` | `evaluator_proposal` | verify that a scored requirement is answered and proved |
| `research_service` | `research_analytic` | judge whether the question, method, evidence, and limitations are sound |
| `private_partnership` | `partnership_brief` | understand mutual value, operating roles, options, and the next decision |
| `internal_decision` | `executive_brief` | approve, reject, or amend a named decision |
| `document_restyle` | `official_form_locked` | confirm presentation changes without silent content mutation |

`public_bullet` is an explicit profile for a summary report, review memo, or other compact bullet-form public working document. `public_plan` is the longer-item variant for a work plan, annual implementation plan, or policy action plan. Either may override the default only when the issuer source or intended reader task supports that form. The user-designated 부산 약국 AI partnership R05 is the golden behavior sample for the restrained `partnership_brief`/`public_bullet` family, not a universal template or submission approval.

`press_release` is an explicit profile for a government press release. It is not a proposal voice and must not be selected merely because a document will be public.

## Shared invariants

All editable profiles follow these rules.

1. Preserve every fact, number, date, name, citation, locator, claim/proof ID, and status during prose review.
2. Put one material claim or judgment in one sentence, bullet, or conclusion line. Split a second rationale into a detail line or a following sentence.
3. Prefer concrete actors, actions, objects, conditions, and measures over abstract praise.
4. Use a short parenthetical lead label only when it improves scanning. The label summarizes the line; it does not add a slogan.
5. A conclusion must be inferable from adjacent evidence. Do not turn preference into `필요`, certainty, or obligation.
6. Keep qualifications and sources visible with `※`, `*`, a footnote, or the mode's citation system.
7. Avoid rhetorical `A가 아니라 B`, questions, exclamations, em-dash slogans, `~것이다`, repeated promotional adjectives, and noncommittal future language unless quoting a source. In evaluator and research prose, retain a contrast only when it defines a concrete responsibility, scope, control, or alternative; record it for contextual review rather than treating every contrast as a blocking slogan.
8. Allocate text to the reader's decision and the evaluation weight. Page count is not a reason to pad prose, and visual density is not a reason to delete necessary reasoning.
9. Tables and figures summarize, compare, or encode relationships. They do not replace the prose needed to explain causality, feasibility, limitations, or a decision.
10. Machine lint reports form risk only. It never certifies factual accuracy, research validity, content approval, or submission readiness.

## Profile contracts

### `public_bullet`

- Use `□ / ❍ / - / ⇒ / ※` or the issuer's equivalent hierarchy.
- Prefer noun or noun-phrase endings. Use `~함/~있음` for a completed fact or state; do not mechanically attach `~함` to every line.
- Keep a lead to one sentence, normally 40–120 Korean characters, ending in `~하고자 함.` when the document convention calls for a lead box.
- Treat 31 characters for an item, 48 for a detail, and 30 for a conclusion as corpus medians, not mandatory targets. Review items over 70 characters and conclusions over 60.
- End a fact bundle with one concise `⇒` judgment only when it adds an inference.
- Use parenthetical lead labels of roughly 2–14 characters selectively, especially for problems, directions, and expected effects.

### `public_plan`

- Inherit the nominal endings, restrained rhetoric, notation, and one-thought discipline of `public_bullet`.
- Allow a policy action item to carry actor, target, timing, and measure in one line. A 2025 central-government work-plan HWPX holdout measured item median 69 characters, 90th percentile 78, and maximum 83; review items over 90 rather than applying the compact-report 70-character threshold.
- Use a 120-character detail review threshold while still splitting independent actions or rationales.
- A lead box is optional and follows the verified plan template; do not force every plan section into `~하고자 함.`.
- Use this profile for work plans and implementation plans, not to make an evaluator proposal or research report denser.

### `press_release`

- Use complete factual sentences inside the `□/❍` hierarchy. Do not impose the nominal-ending rule used by compact review reports.
- Lead with the announcing institution, action, date, place, and public significance; follow with verified details, attendance or scale, and attributed quotations.
- A government press-release HWPX holdout measured first/second-level item median 95 characters and maximum 150; review items over 170 rather than using compact-report limits.
- Preserve direct quotations and their attribution. Treat rhetoric inside a verified quotation separately from unquoted institutional claims.
- Future language is allowed for a dated announced action, but it must identify the actor, action, timing, and status. It is not permission for unsupported promotional promises.
- Keep contact, attachment, and reference blocks outside body-prose density metrics where the source structure identifies them.

### `evaluator_proposal`

- Retain the base grammar's restraint, but use complete sentences where a causal chain, method, responsibility, or proof needs explanation.
- Start each scored response with a direct answer or commitment, then show `approach -> evidence -> control -> result/acceptance`.
- Use bullets for commitments, conditions, deliverables, and controls; use paragraphs for reasoning. Do not reduce the response to tables and fragments.
- Allocate section depth in proportion to evaluation weight, compliance risk, and proof burden. Record the allocation in the page architecture instead of imposing one global character quota.
- Replace `지원할 예정`, `할 수 있음`, and similar noncommittal wording with an owner, action, timing, acceptance criterion, or an explicitly pending status.
- A differentiator must identify a verifiable mechanism or asset; adjectives alone are not differentiation.

### `research_analytic`

- Use complete Korean sentences for research questions, methods, findings, interpretation, limitations, and recommendations.
- A complete analytical sentence may use either narrative endings or established public-research nominal endings such as `~있음/~함/~임`. Preserve the approved report's register consistently; do not convert endings mechanically.
- Keep the base grammar's one-thought discipline at sentence level; do not force analytical prose into nominal bullet endings.
- Separate observation, analysis, inference, and recommendation. Calibrate certainty to the evidence class and preserve counterevidence and limitations.
- Every material empirical claim requires a traceable source or project evidence locator. A citation cluster at the end of a long section does not establish claim-level traceability.
- Use bullets only for parallel research questions, variables, procedures, criteria, or enumerated limitations.
- Question marks are permitted in explicit research questions, evaluation criteria, survey instruments, and quoted sources. They remain inappropriate as unsupported rhetorical hooks.
- Recommendations state the evidence basis, affected actor, condition, and implementation implication. Do not present an analytical preference as a finding.

### `partnership_brief`

- Inherit the concise `public_bullet` rhythm while allowing short complete sentences where mutual value or operating logic would otherwise be ambiguous.
- Identify each party's contribution, benefit, burden, dependency, and decision. Avoid one-sided sales language.
- Put the proposed operating loop, exception path, owner, and next decision ahead of broad vision language.
- Use the R05 pattern of restrained parenthetical labels and limited bold emphasis: labels, chapter/section headings, and table headers may be bold; ordinary body claims and conclusions remain regular unless a verified issuer profile says otherwise.
- Distinguish confirmed facts, proposed terms, assumptions, and decisions requested.

### `executive_brief`

- Lead with the decision requested, recommended option, and decision deadline or trigger.
- Present alternatives, trade-offs, risk, cost, owner, and next action in descending decision relevance.
- Use concise bullets and conclusion lines, but retain enough full-sentence reasoning to make the recommendation auditable.
- Do not hide unresolved assumptions behind a polished summary. Put them next to the decision they affect.

### `official_form_locked`

- Preserve issuer wording, field order, labels, required declarations, and signature areas.
- Do not normalize the issuer's endings, punctuation, spacing, or terminology merely to satisfy another prose profile.
- Apply prose rules only to newly authored free-text fields, and record those fields as the audit scope.
- Use the content mutation ledger and source hash as authority; a style improvement never permits silent substantive change.

## Text-volume contract

Do not define quality as a fixed page or character count. Create a `ProseBudget` per section with:

- `readerQuestion` and `directAnswer`;
- `evaluationWeight` or decision importance when known;
- required claims, proof, qualifications, and citations;
- permitted surface mix: prose, bullets, table, figure;
- `minimumCoverage`, `targetDepth`, and `maximumUsefulDepth` stated as content obligations, with optional measured character estimates after the first render;
- the observed rendered density and the action taken when text is sparse, crowded, or table-dependent.

The first content budget is semantic. Calibrate character and page estimates from approved project exemplars and the issuer's current geometry; do not invent universal research-paragraph or proposal-page quotas.

## Review sequence

1. Resolve `documentMode`, `proseProfile`, issuer overrides, and protected text.
2. Draft against the reader question and `ProseBudget`.
3. Run `proposal_slop_lint.py` and `audit_prose_contract.py --profile PROFILE`.
4. Review every finding in context. A justified exception records locator, rationale, authority, and reviewer.
5. Compare the rendered result with the approved mode exemplar and inspect whether tables or figures displaced necessary prose.
6. Keep machine result, AI-assisted revision, Korean prose review, human content approval, and submission approval as separate receipts.

Run prose lint on the editable HWPX/DOCX/Markdown authoring source whenever available. The HWPX route reads top-level section paragraphs and excludes nested table/drawing text from prose counts; the DOCX route respects heading, lead, note, caption, numbering, and table boundaries. A flattened PDF text extraction loses these boundaries; use it for discovery or a bounded representative sample, not as a blocking whole-document prose receipt.

For evaluator and research profiles, the fragment-density warning uses paragraph-like units of at least 40 characters and excludes content under identified source/reference headings. The raw paragraph ratio remains visible for diagnosis, but cover labels, table-of-contents entries, and bibliography records must not determine a blocking or review result. `proposal_slop_lint.py` remains independently required because the profile audit does not replace placeholder and exact-repetition detection.
