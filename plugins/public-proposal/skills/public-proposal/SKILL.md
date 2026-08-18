---
name: public-proposal
description: Use for Korean public-sector research-service and procurement proposals when the work spans issuer requirements, visual source grammar, academic evidence, Korean prose, deterministic figures, DOCX/PDF QA, or governed release.
---

# Public Proposal

`$public-proposal` is the English user-facing orchestrator for the KPP public-proposal workflow. It preserves the conversation context across four dimensions—standards, visual, research, and content—and delegates authoritative state changes to the KPP CLI.

## Authority and boundaries

Use the following authority order:

1. Issuer notice, RFP, writing guide, evaluation table, annex, and clarification.
2. The locked Korean public-document and project profile rules.
3. Verified research sources and the locked research logic.
4. Human-approved proposal content and evidence ledger.
5. KPP technical audits and deterministic rendering.

The orchestrator must not invent institutional facts, personnel evidence, performance claims, scores, dates, budgets, or submission status. `AI-assisted draft` remains distinct from human-approved content.

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

## LongTable routing

LongTable is a research collaborator, not the proposal compiler:

- Use `$longtable` for research conversation, exploration, review, disagreement, researcher checkpoints, and project memory.
- Use `$longtable-research` for DOI/title seeds, citation slots, scholarly evidence, lawful full-text recovery, and source ledgers.
- Surface a Researcher Checkpoint before closing an unresolved research decision.
- Do not create research-state QuestionRecords for KPP product, hook, setup, release, or documentation work.

The proposal workflow may call LongTable, but it must preserve source provenance, access limits, unresolved tensions, and the boundary between external research evidence and institution-specific facts.

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
