---
name: public-proposal
description: Use for Korean public-sector research-service and procurement proposals when the work spans issuer requirements, visual source grammar, academic evidence, Korean prose, deterministic figures, DOCX/PDF QA, or governed release.
---

# Public Proposal

`$public-proposal` is the English user-facing orchestrator for the KPP public-proposal workflow. It preserves the conversation context across four dimensions—standards, visual, research, and content—and delegates authoritative state changes to the KPP CLI.

For an installed environment, the supported setup command is:

```bash
npx @longtable/public-proposal setup --provider codex
```

The installer provides this skill and the bundled `korean-public-proposal` authority, but it does not grant Codex any additional shell, filesystem, network, connector, or approval permission.

## Authority and boundaries

Use the following authority order:

1. Issuer notice, RFP, writing guide, evaluation table, annex, and clarification.
2. The locked Korean public-document and project profile rules.
3. Verified research sources and the locked research logic.
4. Human-approved proposal content and evidence ledger.
5. KPP technical audits and deterministic rendering.

The orchestrator must not invent institutional facts, personnel evidence, performance claims, scores, dates, budgets, or submission status. `AI-assisted draft` remains distinct from human-approved content.

The installer uses the bundled `korean-public-proposal` snapshot in this plugin as its Korean authority baseline. Issuer notice, RFP, annex, and clarification rules remain higher authority than that bundled snapshot.

## Route the work

Start execution work by locating the project and reading its machine state:

```bash
kpp doctor --json
kpp status --json
```

Use `npx @longtable/kpp-cli` when the `kpp` executable is not installed. The published package family is:

- `@longtable/kpp-cli`: user-facing CLI and state transitions;
- `@longtable/kpp-core`: provenance, receipts, and release state;
- `@longtable/kpp-schemas`: project and evidence contracts;
- `@longtable/kpp-renderers`: deterministic SVG figure rendering;
- `@longtable/kpp-audits`: content, source, DOCX, render, and release audits.

Do not write receipts, declare `PASS`, approve content, or release a submission directly from this skill. Only the KPP CLI and an explicitly named human owner can perform those transitions.

## Preserve the four context lanes

Before drafting or changing a project, keep these lanes separate and linked:

- **Standards**: RFP requirements, evaluation questions, page/file limits, official annexes, and the Korean public-document grammar.
- **Visual**: issuer pages, verified Korean public/report references, surface tokens, page roles, table grammar, figure grammar, and render findings.
- **Research**: research question, theoretical or methodological provenance, citation slots, source ledger, full-text access status, and transfer boundaries.
- **Content**: claims, evidence IDs, direct evaluator answers, page locators, deliverables, risks, owners, and approval state.

Every ordinary page must connect an evaluation question, direct answer, mechanism or evidence interpretation, deliverable or acceptance criterion, and claim/proof status. A table or figure is not a substitute for developed prose; it needs a body callout, source/date, interpretation boundary, and action or decision.

## Automatic routing and section authoring

`$public-proposal` is the one user-facing proposal surface. It automatically selects the smallest needed agent profile from the shared `AGENT_TRIGGER_MATRIX` policy:

- every proposal: Proposal Architect and RFP/Compliance Reviewer;
- research, policy, academic-evidence work: Methods/Evidence Reviewer and conditional LongTable research;
- institution facts or data: Institutional Evidence and Data Reviewer;
- representative sections: Korean Prose Reviewer and Evaluator Red Team;
- figures or tables: Visual/Render Reviewer;
- qualification, PII, or blind-copy material: Proof/Privacy Reviewer;
- final release: a fresh-context Submission Gate Reviewer.

Use `quick` (maximum 3 concurrent agents), `standard` (6), or `deep` (10) according to proposal class and risk. A finding receives at most one rebuttal, a section at most two automatic revisions, and a stage at most 12 agent runs. Reviewers receive read-only hash-bound packets and may only propose patches; the Proposal Editor is the only patch applier.

Writers receive a positive packet with exactly these doctrine sentences, reader tasks, the section purpose, allowed claim/evidence IDs, open decisions, two or three approved references, and a proposal-family profile:

1. 발주처의 평가 질문에 먼저 직접 답하고, 필요한 전제와 범위를 분명히 한다.
2. 확인된 사실에서 해석을 도출하고 그 해석이 다음 결정이나 행동으로 이어지게 한다.
3. 추상적인 체계보다 누가 무엇을 어떻게 수행하는지를 구체적으로 쓴다.
4. 표와 도식은 비교·이해·판단을 실제로 더 쉽게 만들 때만 사용한다.
5. 미확정 사항은 감추거나 채우지 않고 결정 주체와 다음 행동을 명확히 한다.
6. 형식은 내용과 독자의 읽기 흐름을 돕도록 선택하며 모든 페이지를 같은 틀에 맞추지 않는다.

Section authoring is distinct from legacy page authoring. Section responses contain paragraphs, table/figure references, claim/evidence bindings, and unresolved decisions; they do not contain page IDs, page breaks, or evaluator-answer metadata. The renderer applies pagination later. Existing v0.1.3 page-based authoring remains available through its legacy adapter.

Before full-document authoring, create and render representative `problem`, `method`, and `execution` sections. Each requires independent prose, evaluator, compliance, evidence, and visual findings, followed by a named human approval. Partial or timeout runs are quarantined; when an input hash changes, only its affected findings are invalidated. This gate is not satisfied by an automated pass, a research lock, or a technical audit.

## Conditional LongTable collaboration

LongTable is a research collaborator, not the proposal compiler:

- Public Proposal routes only the necessary research request, evidence bundle, and Researcher Checkpoint work.
- LongTable may supply lawful scholarly evidence and source ledgers, but it cannot approve, patch, or release a proposal.
- Do not expose or invoke legacy LongTable role skills from this proposal surface; role selection stays internal to automatic routing.
- Do not create research-state QuestionRecords for KPP product, hook, setup, release, or documentation work.

The proposal workflow may call LongTable, but it must preserve source provenance, access limits, unresolved tensions, and the boundary between external research evidence and institution-specific facts.

### Required research route before authoring approval

For `academic_research`, `research_service`, and `policy_research`, route research work through LongTable before producing approval-ready authoring output. Require a compatible LongTable research handoff with closed required checkpoints, then bind it through KPP:

```bash
kpp research-lock <project-root> --handoff <longtable-handoff.json> --json
```

KPP verifies that research lock again before authoring export, content approval, approval, and release. For `general_procurement`, do this only when locked requirements contain an academic-evidence slot. `document_restyle` does not require a LongTable research lock. Do not describe the lock as human approval, issuer compliance, or a license to turn research findings into institution-specific claims.

## Korean prose and visual QA

For Korean text, route mechanical or translation-like prose to `humanize-korean` while preserving facts, numbers, dates, names, citations, and evidence IDs. Review for public-sector register, subject–action clarity, varied sentence rhythm, paragraph-level reasoning, and natural Korean report style.

For visual and document work, use Korean public-proposal references as bounded evidence. Rebuild text-bearing figures deterministically from locked data. Inspect populated rendered pages, not only ZIP/XML or page counts. A technical audit is not submission approval.

The minimum release review covers:

- source/version/hash and requirement coverage;
- claim–evidence–page linkage;
- substantive prose and repetition;
- table/figure shell and body linkage;
- Korean fonts, geometry, page occupancy, glyphs, overlap, and clipping;
- PDF/DOCX lineage, receipts, and human approval.

## Handoff

When handing the package to another person, provide the GitHub repository, exact KPP version, supported runtime, install command, project input boundaries, evidence classification, and the remaining human decisions. Never present a technical pass as a submission-ready proposal.
