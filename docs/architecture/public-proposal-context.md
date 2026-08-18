# Public Proposal context and ownership

## Canonical repository

The canonical public repository for this product is:

- GitHub: `https://github.com/HosungYou/public-proposal`
- Product: Public Proposal orchestrator and KPP evidence-bound document pipeline
- Maintainer: Enaction Labs / HosungYou
- Local checkout: `/Users/hosung/work/Enaction Labs/KPP`

The `enactionlabs` repository is outside this product boundary and must not receive KPP or Public Proposal commits.

## User-facing entry point

The user-facing Codex entry point is the English `$public-proposal` plugin skill. It preserves proposal context and delegates mutations to `kpp`.

```text
$public-proposal
  ├── standards: issuer RFP and Korean public-document rules
  ├── visual: verified pages, surface tokens, table/figure grammar
  ├── research: LongTable state, evidence, citation slots, access boundaries
  ├── content: claims, proof, prose, pages, owners, approvals
  └── @longtable/kpp-cli: build, render, audit, approve, release
```

`$longtable` and `$longtable-research` remain specialized research routes. They are not replaced by, and do not become, the proposal compiler.

## NPM package family

The current public package family is published under the `@longtable` scope. The scope reflects the research-enabled implementation lineage; it does not change the English Public Proposal user-facing name.

| Package | Responsibility |
| --- | --- |
| `@longtable/kpp-cli` | CLI entry point and guarded workflow transitions |
| `@longtable/kpp-core` | state, provenance, receipts, and release lineage |
| `@longtable/kpp-schemas` | RFP, evidence, content, figure, audit, and approval contracts |
| `@longtable/kpp-renderers` | deterministic SVG and figure families |
| `@longtable/kpp-audits` | content, source, DOCX, render, and release audits |

All next-version package metadata must point to this GitHub repository. NPM publication is a separate release action and must follow tarball inspection, clean-install verification, scope authorization, and explicit publish approval.

## Context contract

Every proposal project must keep the following inputs distinguishable:

1. issuer requirements and official annexes;
2. visual source packet and approved surface profile;
3. locked research logic and source ledger;
4. structured claims/evidence/content and human approval records.

The system may use research sources to design a method or framework, but must not transfer external findings into KEITI or another institution's performance, readiness, or impact claims without institution-specific evidence.

## Release language

The following labels are mandatory:

- `AI-assisted draft`: generated or mechanically assembled content not yet approved by a human owner;
- `technical audit pass`: automated structural, geometry, source, or render checks passed;
- `human approved`: named owner approved the exact bytes and evidence boundary;
- `submission ready`: only after issuer compliance, evidence, human approval, and packaging gates all pass.

No page count, figure count, successful build, or npm publication may be described as submission readiness by itself.
