# Public Proposal

Evidence-bound orchestration for Korean public-sector research and procurement proposals.

This repository is the canonical GitHub home for the English `$public-proposal` caller and the KPP document pipeline. It keeps issuer standards, visual source evidence, LongTable research context, Korean prose review, deterministic figures, and human approval in one handoffable product boundary.

## Install and run

The current public CLI family is published under the `@longtable` scope:

```bash
npx @longtable/kpp-cli --help
```

The repository contains the source packages and the plugin adapter. Customer documents, private evidence, personnel records, pricing, and bid-specific facts must remain in a separate project workspace.

## Context routing

- `$public-proposal`: English proposal orchestrator and handoff surface.
- `$longtable`: research conversation, exploration, review, memory, and researcher checkpoints.
- `$longtable-research`: scholarly evidence, citation slots, lawful full-text recovery, and source ledgers.
- `@longtable/kpp-cli`: deterministic proposal state, build, render, audit, approval, and release operations.

The Korean public-proposal rules are an internal authority layer. They do not replace the issuer's RFP or human approval.

## Quality boundary

A technical pass is not a submission. Release requires requirement coverage, evidence binding, substantive Korean prose, page-level figure/table linkage, DOCX/PDF integrity, render inspection, and explicit human approval.

See [`docs/architecture/public-proposal-context.md`](docs/architecture/public-proposal-context.md) for repository ownership, package responsibilities, context lanes, and release language.

## Product boundary

`enactionlabs` is a separate GitHub repository and is not the source of truth for this product. Do not add Public Proposal or KPP changes there.
