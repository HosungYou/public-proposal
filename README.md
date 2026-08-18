# Public Proposal

Evidence-bound orchestration for Korean public-sector research and procurement proposals.

This repository is the canonical GitHub home for the English `$public-proposal` caller and the KPP document pipeline. It keeps issuer standards, visual source evidence, LongTable research context, Korean prose review, deterministic figures, and human approval in one handoffable product boundary.

## Install and run

The intended Codex setup path after publication is:

```bash
npx @longtable/public-proposal setup --provider codex
```

As of 2026-08-18 the package is not yet available from the public npm registry; registry publication is a release prerequisite. The command above must not be treated as currently runnable from npm until `npm view @longtable/public-proposal@0.1.0 version` succeeds. The repository release gate verifies the exact local tarball without publishing it.

It pins `@longtable/kpp-cli@0.2.1`, `@longtable/cli@0.1.72`, and managed worker protocol `1.0.0`. LongTable installs `$longtable` and `$longtable-research` into the registered Public Proposal plugin's `skills/` surface, and doctor verifies those files plus Codex marketplace/plugin registration. Node `>=22 <27` and Python `>=3.11 <3.15` are compatibility requirements. The current setup and doctor commands verify that the required executables are available; they do not yet enforce those runtime version ranges.

After setup, inspect the installed boundary without changing it:

```bash
npx @longtable/public-proposal doctor --json
```

`setup` is a change command; `doctor` is read-only. See the full [installation and recovery guide](docs/installation/INSTALL.md) and the machine-readable [compatibility matrix](docs/installation/compatibility-matrix.json).

Codex has a **single global Codex `public-proposal` marketplace selector**. A user-scoped and project-scoped installation cannot coexist when they register different marketplace sources. Setup stops with `PP_MARKETPLACE_CONFLICT`; choose one scope, uninstall the existing Public Proposal installation, then set up the selected scope.

## Four authorities, kept separate

| Authority | It owns | It does not own |
| --- | --- | --- |
| `$public-proposal` | Conversation context, task routing, and structured input preparation | KPP state or receipts |
| bundled `korean-public-proposal` | Korean public-document rules, visual grammar, tables, figures, and prose baseline | Issuer-rule overrides or release decisions |
| `@longtable/kpp-cli` | Project state, receipts, build, audit, approval, and release | Research decisions or researcher checkpoints |
| LongTable (`@longtable/cli`) | Conditional scholarly research, citation slots, source ledgers, and researcher checkpoints | DOCX, KPP receipts, and release writes |

The bundled Korean authority is a baseline: an issuer notice, RFP, annex, and clarification always take precedence. KPP is the only proposal-state and receipt writer. LongTable returns evidence and a hash-bound handoff; it does not approve or release a proposal.

Installing the Codex plugin adds skills and packaged resources only. **Plugin installation does not expand Codex permissions**: shell, filesystem, network, connector, sandbox, and approval decisions remain under the active Codex policy and workspace instructions.

## Research requirements

`academic_research`, `research_service`, and `policy_research` require a valid LongTable research lock before authoring export can become approval-ready and before content approval, approval, or release can pass. `general_procurement` requires the same lock only when its locked requirements contain an academic-evidence slot. `document_restyle` does not require LongTable.

The lock binds the LongTable research specification, citation-slot matrix, source ledger, and claim-transfer ledger to a KPP receipt. It is not permission to turn external research into institution-specific performance claims. A named human owner must still approve the exact proposal bytes and evidence boundary.

## CLI execution and human approval

Use `kpp` for proposal workflow transitions and `longtable` for research work; the setup package coordinates their pinned installation but does not merge their authority.

```bash
kpp --version
longtable --version
kpp research-lock <project-root> --handoff <longtable-handoff.json> --json
```

An `AI-assisted draft` or a technical audit pass is not submission readiness. Release requires issuer compliance, evidence binding, rendered DOCX/PDF inspection, and explicit human approval.

Customer documents, private evidence, personnel records, pricing, and bid-specific facts must remain in a separate project workspace.

See [`docs/architecture/public-proposal-context.md`](docs/architecture/public-proposal-context.md) for repository ownership, package responsibilities, context lanes, and release language.

## Product boundary

`enactionlabs` is a separate GitHub repository and is not the source of truth for this product. Do not add Public Proposal or KPP changes there.
