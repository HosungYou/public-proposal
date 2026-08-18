# Public Proposal installation and recovery

Verified compatibility date: **2026-08-18**. The exact supported versions are `@longtable/public-proposal@0.1.0`, `@longtable/kpp-cli@0.2.1`, `@longtable/cli@0.1.72`, and managed worker protocol `1.0.0`. See [compatibility-matrix.json](compatibility-matrix.json) for the machine-readable contract.

## Prerequisites

Install a supported Node runtime (`>=22 <27`), Python (`>=3.11 <3.15`), npm, Codex CLI, LibreOffice, and the required Noto Sans CJK Korean fonts. The installer checks these independently; a setup result is not successful until its doctor checks pass.

Use a writable user or project installation location. Do not put customer RFPs, private source files, credentials, personnel records, pricing, or bid-specific evidence in the plugin package or installation directory.

## Recommended one-command setup

```bash
npx @longtable/public-proposal setup --provider codex
public-proposal doctor --json
```

`setup` validates the packaged marketplace and plugin, installs the bundled skill assets, verifies the pinned KPP and LongTable CLIs, installs the managed DOCX worker, and writes an installation receipt only after its preflight passes. `doctor --json` is the read-only verification command. Use `--install-scope project` only when the installation should be scoped to the current project rather than the user.

The setup command uses the Codex marketplace flow internally:

```text
codex plugin marketplace add <installer-owned-install-root>/marketplace
codex plugin add public-proposal@public-proposal
```

Those paths are installer-owned; do not substitute an unrelated marketplace directory.

## What each installed component is allowed to do

| Component | Authority | Boundary |
| --- | --- | --- |
| `$public-proposal` | Conversation context and work routing | Cannot write KPP state or receipts |
| bundled `korean-public-proposal` | Korean public proposal rules, document grammar, visual and prose baseline | Does not supersede the issuer RFP or approve release |
| `@longtable/kpp-cli@0.2.1` | State, receipts, build, audit, approval, and release | Does not resolve research decisions |
| LongTable / `@longtable/cli@0.1.72` | Conditional scholarly research, evidence recovery, citation slots, and checkpoints | Does not write DOCX, KPP receipts, or releases |

KPP is the sole proposal-state and receipt writer. LongTable remains a research/evidence service and gives KPP a hash-bound handoff rather than authority to approve a proposal.

Installing a plugin provides the skills and packaged resources to Codex. **Plugin installation does not expand Codex permissions**. The active Codex sandbox, approvals, workspace instructions, connector access, and user-granted filesystem/network permissions still decide what any command may do.

## Manual fallback

Use this only when `npx` is unavailable or a controlled environment requires global installation:

```bash
npm install --global @longtable/public-proposal@0.1.0 @longtable/kpp-cli@0.2.1 @longtable/cli@0.1.72
public-proposal setup --provider codex
public-proposal doctor --json
```

If setup stopped before it wrote a successful installation receipt, correct the reported blocker and run setup again. Do not copy files into an existing installation root or create a receipt by hand. For an already prepared installer-owned root, the two marketplace commands shown above are the manual plugin-registration fallback; then rerun `public-proposal doctor --json`.

To remove only files owned by a successful Public Proposal installation:

```bash
public-proposal uninstall
```

Uninstall preserves existing LongTable projects, `.longtable/` research state, KPP project data, and customer material. `public-proposal update` previews compatibility changes; use `public-proposal update --apply` only after checking the preview and the compatibility matrix.

## LongTable research lock requirements

| Proposal class | LongTable research lock |
| --- | --- |
| `academic_research` | Required |
| `research_service` | Required |
| `policy_research` | Required |
| `general_procurement` | Required only when locked requirements contain an academic-evidence slot |
| `document_restyle` | Not required |

For a required project, LongTable must prepare the research specification, citation-slot matrix, source ledger, and claim-transfer ledger, close required researcher checkpoints, and emit a compatible handoff. Import it with KPP before approval-ready authoring:

```bash
kpp research-lock <project-root> --handoff <longtable-handoff.json> --json
```

The resulting LongTable research lock is rechecked before authoring export, content approval, approval, and release. It does not replace human approval, issuer compliance, or institution-specific evidence.

## Troubleshooting

| Code | Meaning | Safe recovery |
| --- | --- | --- |
| `PP_WORKER_PROTOCOL_MISSING` | The managed DOCX worker is absent, incompatible, or fails its protocol check. | Run `public-proposal doctor --json`, restore the supported Python runtime, then rerun setup. Do not point KPP at an unverified worker binary. |
| `PP_LONGTABLE_REQUIRED` | The project class needs LongTable, or the handoff no longer matches the locked project. | Prepare the required LongTable research handoff and confirm the project class before importing it with `kpp research-lock`. |
| `PP_RESEARCH_LOCK_MISSING` | A required project has no valid KPP-bound LongTable research lock. | Complete the required LongTable artifacts and checkpoints, then import the handoff with `kpp research-lock <project-root> --handoff <handoff.json> --json`. |
| `PP_RESEARCH_CHECKPOINT_OPEN` | A required researcher decision remains unresolved. | Resolve it with the researcher; do not bypass it in KPP. |
| `PP_LONGTABLE_VERSION_MISMATCH` | The handoff or installed CLI is not `@longtable/cli@0.1.72`. | Restore the pinned LongTable version and regenerate or revalidate the handoff. |

Research-lock recovery is deliberately conservative: KPP does not automatically overwrite a malformed, stale, or conflicting `research-lock.json` receipt. Preserve the existing artifact for inspection, correct the source handoff or project evidence, and use a clean, valid import path. Never delete `.longtable/` state as a generic recovery step.

## Human release boundary

The installer, Codex plugin, KPP audit, and LongTable research lock can establish technical readiness only. A release remains blocked until a named human owner approves the exact evidence boundary and proposal bytes. `AI-assisted draft`, a passing doctor, a valid research lock, and a passing technical audit are not submission-ready status by themselves.
