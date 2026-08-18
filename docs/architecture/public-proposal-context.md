# Public Proposal context and ownership

## Canonical repository

The canonical public repository for this product is:

- GitHub: `https://github.com/HosungYou/public-proposal`
- Product: Public Proposal orchestrator and KPP evidence-bound document pipeline
- Maintainer: Enaction Labs / HosungYou
- Local checkout: clone this repository into any project workspace.

The `enactionlabs` repository is outside this product boundary and must not receive KPP or Public Proposal commits.

## User-facing entry point

The user-facing Codex entry point is the English `$public-proposal` plugin skill. It preserves proposal context and delegates mutations to `kpp`.

The supported installation entry point is deliberately separate from KPP execution:

```bash
npx @longtable/public-proposal setup --provider codex
```

The installer coordinates exact component versions and records its own installation receipt. It does not become a second proposal-state authority.

```text
$public-proposal
  ├── standards: issuer RFP and Korean public-document rules
  ├── visual: verified pages, surface tokens, table/figure grammar
  ├── research: LongTable state, evidence, citation slots, access boundaries
  ├── content: claims, proof, prose, pages, owners, approvals
  └── @longtable/kpp-cli: build, render, audit, approve, release
```

`$longtable` and `$longtable-research` remain specialized research routes. They are not replaced by, and do not become, the proposal compiler.

## Four authority contract

| Surface | Owns | Must not do |
| --- | --- | --- |
| `$public-proposal` | Conversation context, work routing, and structured input preparation | Write KPP state or receipts |
| bundled `korean-public-proposal` | Korean public-document grammar, visual/prose standards, and reusable checked assets | Override issuer requirements or declare release readiness |
| `@longtable/kpp-cli` | State, receipts, build, audit, approval, and release | Settle researcher checkpoints or invent evidence |
| LongTable (`@longtable/cli`) | Conditional scholarly research, source ledgers, citation slots, and research checkpoints | Write KPP receipts, DOCX, or releases |

The Korean bundle is the installed baseline, but issuer notices, RFPs, annexes, and clarifications remain higher authority. KPP is the only writer of proposal state and receipts. A LongTable handoff is hash-bound evidence for KPP to verify, not an approval or release action.

Installing the plugin adds skills and packaged resources only. It does not expand Codex filesystem, shell, network, connector, sandbox, or approval permissions; those remain governed by the active Codex session and workspace policy.

## NPM package family

The current public package family is published under the `@longtable` scope. The scope reflects the research-enabled implementation lineage; it does not change the English Public Proposal user-facing name.

| Package | Responsibility |
| --- | --- |
| `@longtable/public-proposal` | pinned meta-installer, Codex marketplace registration, managed worker installation, and installation receipt |
| `@longtable/kpp-cli` | CLI entry point and guarded workflow transitions |
| `@longtable/kpp-core` | state, provenance, receipts, and release lineage |
| `@longtable/kpp-schemas` | RFP, evidence, content, figure, audit, and approval contracts |
| `@longtable/kpp-renderers` | deterministic SVG and figure families |
| `@longtable/kpp-audits` | content, source, DOCX, render, and release audits |

All next-version package metadata must point to this GitHub repository. NPM publication is a separate release action and must follow tarball inspection, clean-install verification, scope authorization, and explicit publish approval.

The current compatibility contract pins `@longtable/kpp-cli@0.2.1`, `@longtable/cli@0.1.72`, and worker protocol `1.0.0`; [the matrix](../installation/compatibility-matrix.json) records the installer and runtime bounds. NPM availability and clean-machine installation are separate release checks.

## Context contract

Every proposal project must keep the following inputs distinguishable:

1. issuer requirements and official annexes;
2. visual source packet and approved surface profile;
3. locked research logic and source ledger;
4. structured claims/evidence/content and human approval records.

The system may use research sources to design a method or framework, but must not transfer external findings into an issuer's performance, readiness, or impact claims without institution-specific evidence.

`academic_research`, `research_service`, and `policy_research` require a valid LongTable research lock before approval-ready authoring, content approval, approval, or release. `general_procurement` requires one only when its locked requirements include an academic-evidence slot; `document_restyle` does not. The lock never replaces named human approval.

## Release language

The following labels are mandatory:

- `AI-assisted draft`: generated or mechanically assembled content not yet approved by a human owner;
- `technical audit pass`: automated structural, geometry, source, or render checks passed;
- `human approved`: named owner approved the exact bytes and evidence boundary;
- `submission ready`: only after issuer compliance, evidence, human approval, and packaging gates all pass.

No page count, figure count, successful build, or npm publication may be described as submission readiness by itself.
