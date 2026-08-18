# Public Proposal Codex Plugin Handoff Plan

> This plan records the public handoff decision for the English caller. The
> plugin is a context-preserving adapter; KPP CLI remains the authority for
> state, receipts, audits, approvals, and release transitions.

## Identity

- Plugin ID: `public-proposal`
- Display name: `Public Proposal`
- User-facing caller: `$public-proposal`
- Canonical source: `https://github.com/HosungYou/public-proposal`
- Package entry point: `@longtable/kpp-cli`

The Korean public-proposal skill remains an internal authority layer for
institutional style and compliance. It is not copied into this repository as
a private path or treated as the NPM package name.

## Context lanes

The skill must keep four inputs distinguishable:

1. **Standards** — issuer RFP, official annexes, evaluation criteria, and
   Korean public-document requirements.
2. **Visual** — verified pages, table/figure grammar, surface tokens, and
   render observations.
3. **Research** — LongTable state, source ledger, citation slots, lawful
   full-text recovery, and method boundaries.
4. **Content** — claims, evidence, Korean prose, page ownership, unresolved
   blanks, and human approval records.

`$longtable` and `$longtable-research` remain specialized research routes.
They contribute context and evidence but do not declare proposal audit passes or
publish releases.

## Delegation contract

Every execution request begins with:

```bash
kpp doctor --json
kpp status --json
```

The skill may explain the structured result and suggest the next allowed
command. It must not create receipts, declare `PASS`, bypass a blocked state,
or describe a technical pass as submission readiness. `kpp approve` and
`kpp release` remain the only authoritative approval and release transitions.

## Validation

Before handoff, validate the manifest and skill with the local plugin and skill
validators. In a clean project workspace, verify the installed CLI with:

```bash
npx @longtable/kpp-cli --help
npx @longtable/kpp-cli doctor --json
```

The plugin is usable only when the caller, package metadata, context lanes,
and CLI delegation contract agree. It still requires human review of populated
pages, substantive Korean prose, table/figure body linkage, evidence scope,
DOCX/PDF integrity, and the exact bytes being approved.
