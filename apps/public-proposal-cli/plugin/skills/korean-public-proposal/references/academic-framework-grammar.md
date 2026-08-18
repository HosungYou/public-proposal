# Academic framework grammar

Use this protocol when a proposal needs a conceptual framework, research logic, institutional baseline, candidate-selection model, roadmap, or governance figure.

## Framework classes

Classify every framework before drawing it.

1. `reproduced model`: reproduce one published model without changing its constructs or relationships; cite the source and page.
2. `adapted model`: modify a published model; cite the source and record every added, removed, or renamed element.
3. `synthesized analytical framework`: combine constructs or relationships from multiple sources; map every node and edge to evidence and state the synthesis rule.
4. `project working hypothesis`: propose a project-specific relationship that will be tested after contract start; label it provisional and state the validation and rejection conditions.

Do not call a decorative diagram, generic process, or ImageGen output an academic framework.

## Research lock before visual exploration

Lock the following in JSON or YAML before drawing:

- research question and evaluator task;
- construct, operational definition, unit of analysis, and scope;
- node and edge IDs;
- source/evidence IDs and locators;
- direction, mechanism, threshold, decision state, and uncertainty;
- method used to validate, revise, or reject the relationship;
- owner and human approval state.

Use LongTable `lt review` to challenge the strongest missing evidence, unsupported connection, construct ambiguity, and validation gap. LongTable reviews research logic; this Skill validates proposal composition and file integrity.

## ImageGen routing

Use ImageGen only when the locked logic permits more than one reasonable topology and a composition comparison would help. It may explore hierarchy, grouping, density, visual metaphor, and reading order.

Never ask ImageGen to invent or finalize Korean labels, values, evidence IDs, citations, scores, charts, maps, RACI, schedules, official forms, or relationships. Supply rendered Korean reference pages and the locked topology. Treat every output as a composition candidate. Rebuild the selected candidate deterministically with Word-native components or SVG generated from the locked data.

Skip ImageGen for charts, Gantt, RACI, evidence matrices, tables, and simple flows whose geometry follows directly from structured data.

## Final framework record

Store `framework_id`, `class`, `question`, `nodes`, `edges`, `sources`, `uncertainties`, `validation_plan`, `render_hash`, `body_callout`, and `human_approval`. A final figure must satisfy `figure-grammar.md` and the DOCX integrity gate.
