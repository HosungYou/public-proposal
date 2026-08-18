# Reusable proposal learning protocol

Use a shared pattern library and project-specific immutable packages. The Skill is the controller; the shared library is the reusable source of truth; project packages preserve each bid's evidence and decisions.

## Separation model

| Layer | Stores | Must not store |
| --- | --- | --- |
| Shared library | issuer grammar, contract-type rules, reusable components, validators | project personnel, prices, private performance evidence |
| Project package | source snapshots, requirements, candidates, decisions, render QA, submission files | unreviewed rules presented as reusable canon |

Source classes:

- `actual_submission`: a legally public bidder-authored response whose provenance is verified.
- `official_template`: an issuer notice, RFP, writing guide, official sample, or annex.
- `evaluation_result`: a score sheet or result disclosure without the bidder's full narrative.
- `report_reference`: a public research, policy, strategy, or evaluation report used only for editorial and visual language.

Never infer actual winning-proposal style from the latter three classes. Record `structure_only`, `visual_language_only`, or another explicit use boundary for every source.

Pattern scopes:

- `issuer`: use only when the issuer matches.
- `contract_type`: use only for the declared procurement or service type.
- `universal`: use across projects only after evidence from more than one applicable issuer or a controlling rule.
- `project_only`: never promote to the shared library.

## Numbered rounds

Use these semantic round names:

1. `R00_SourceLock`: official notice, RFP, annexes, clarification, paths, and SHA-256.
2. `R01_IssuerVisualCanon`: issuer-derived cover, chapter, table, figure, and annex grammar.
3. `R02_ComplianceSkeleton`: RFP hierarchy, requirements, evaluation matrix, and official form slots.
4. `R03_NarrativeMigration`: approved prior prose and research methods, with source and evidence links.
5. `R04_EvaluationCoverage`: scored criterion coverage, direct answers, proof, and page anchors.
6. `R05_AnnexEvidenceBinding`: official annex originals and qualification, personnel, and performance proof.
7. `R06_FigureSynthesis`: structured figure inputs, deterministic final figures, and interpretation.
8. `R07_SubmissionPackage`: required PDF groups, hashes, sizes, openability, and upload verification.

Each round contains `manifest.json`, `requirements.json`, `input/`, `candidates/`, `promoted/`, and `qa/`. Do not overwrite promoted artifacts. Multiple candidates may exist, but only a promoted round may become the accepted spine.

In `R01_IssuerVisualCanon`, store a visual source packet and page observations. Each observation records source class, source page, page role, reading order, components, evaluator task, transfer scope, and copy boundary. A filename or URL without a rendered, inspected page is not visual evidence.

## Automated lifecycle

Run `scripts/proposal_learning.py --help` for full arguments.

```bash
python scripts/proposal_learning.py init-library --root SHARED_LIBRARY
python scripts/proposal_learning.py init-project \
  --root PROJECT --library SHARED_LIBRARY \
  --project-id BID_ID --issuer ISSUER --contract-type TYPE --source-dir SOURCES
python scripts/proposal_learning.py create-round \
  --root PROJECT --round-id R02_ComplianceSkeleton \
  --parent R01_IssuerVisualCanon --requirements requirements.json
python scripts/proposal_learning.py capture-input \
  --root PROJECT --round-id R03_NarrativeMigration \
  --role narrative_source --path prior-proposal.docx --path approved-design.md
python scripts/proposal_learning.py regress --root PROJECT --round-id R02_ComplianceSkeleton
python scripts/proposal_learning.py promote-round \
  --root PROJECT --round-id R02_ComplianceSkeleton \
  --gates gate-report.json --approved-by HUMAN_OWNER
```

Register a reusable candidate only after source classification:

```bash
python scripts/proposal_learning.py propose-pattern \
  --library SHARED_LIBRARY --project-root PROJECT --metadata pattern.json
python scripts/proposal_learning.py promote-pattern \
  --library SHARED_LIBRARY --pattern-id PATTERN_ID --approved-by HUMAN_OWNER
```

Promotion fails when approval is absent, a validation is not `true`, a pattern is `project_only`, a parent round is unpromoted, or a child loses a confirmed requirement.

## Learning rule

Treat completed proposals as evidence, not as automatic training data. Extract structure, applicability, variables, validation, confidentiality, and source references. Keep the result as `candidate`. Promote only after source, rights, visual, content, and regression gates pass and a human owner approves it.

For broader generalization, create a new pattern ID or version. Do not silently widen `issuer` into `universal`. Deprecate superseded patterns while retaining their provenance and past package manifests.

Product Design outputs never become reusable patterns by themselves. Promote only the deterministically rebuilt component after comparing it against the source packet, completing evaluator tasks, passing regression, and receiving human approval.
