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

Resolve exactly one v2 mode: `public_procurement`, `research_service`, `private_partnership`, `internal_decision`, or `document_restyle`. A v1 project remains unchanged until an operator explicitly runs `kpp migrate PROJECT --apply`; no read, plan, build, audit, or release command may auto-migrate it.

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

Use the bundled `korean-public-proposal/references/vnext-contract.md` for page architecture. A large title belongs to the cover or chapter opener. Ordinary continuation pages retain running context and headings at 12 pt or smaller; three consecutive structurally equivalent pages block release unless a verified issuer/accessibility exception is source-bound.

## LongTable routing

LongTable is a research collaborator, not the proposal compiler:

- Use `$longtable` for research conversation, exploration, review, disagreement, researcher checkpoints, and project memory.
- Use `$longtable-research` for DOI/title seeds, citation slots, scholarly evidence, lawful full-text recovery, and source ledgers.
- Surface a Researcher Checkpoint before closing an unresolved research decision.
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

Release also requires a mode-aware `CompositeAuditReceipt` that binds the current architecture, references, render observations, required audit slices, and allowlisted artifacts. Its human boundary is `TECHNICAL_GATE_ONLY`; npm `latest`, GitHub release, and final submission remain blocked until the final rendered exemplar receives explicit human approval.

## Handoff

When handing the package to another person, provide the GitHub repository, exact KPP version, supported runtime, install command, project input boundaries, evidence classification, and the remaining human decisions. Never present a technical pass as a submission-ready proposal.
