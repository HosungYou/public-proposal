# Public Proposal installation and recovery

Verified compatibility date: **2026-08-18**. The exact supported versions are `@longtable/public-proposal@0.1.3`, `@longtable/kpp-cli@0.2.1`, `@longtable/cli@0.1.72`, and managed worker protocol `1.0.0`. See [compatibility-matrix.json](compatibility-matrix.json) for the machine-readable contract.

## Prerequisites

Use a supported Node runtime (`>=22 <27`) and Python (`>=3.11 <3.15`), plus npm, Codex CLI, LibreOffice, and the required Noto Sans CJK Korean fonts. The Node and Python ranges are compatibility requirements recorded in the matrix. The current setup and doctor implementations check executable availability, not those semver ranges; do not interpret a passing doctor as proof that the runtime range was enforced.

Use a writable user or project installation location. Do not put customer RFPs, private source files, credentials, personnel records, pricing, or bid-specific evidence in the plugin package or installation directory.

## Recommended one-command setup

The package is published on npm as `@longtable/public-proposal@0.1.3`. Leaving off the version below resolves the current `latest` tag; pin `@0.1.3` when reproducibility is required.

```bash
npx --yes @longtable/public-proposal setup --provider codex
npx --yes @longtable/public-proposal doctor --json
npx --yes @longtable/public-proposal update
npx --yes @longtable/public-proposal update --apply
npx --yes --package @longtable/public-proposal kpp adopt <legacy-project> --source <source-packet> --master <working-master> --json
npx --yes @longtable/public-proposal uninstall
```

`setup` validates the packaged Public Proposal marketplace and plugin, verifies the pinned KPP and LongTable CLIs, installs the managed DOCX worker, and writes an installation receipt only after its preflight passes. In the vNext source, LongTable is an independent `longtable@longtable` registration: a compatible external source is reused as `externally_owned`; otherwise setup creates a separate installer-owned LongTable marketplace and installs `$longtable` plus the canonical `longtable-research` skill there. The published `@longtable/cli@0.1.72` artifact may name the scholarly skill `scholar-research`; the installer normalizes that name only inside its own LongTable plugin. `doctor --json` verifies both independent registration sources and LongTable doctor; it is read-only. Use `--install-scope project` only when the installation should be scoped to the current project rather than the user.

If a later setup step fails, setup removes only marketplace/plugin registrations added by that invocation and then removes its owned files. Pre-existing Codex registrations are preserved. A failed compensation is reported as `PP_SETUP_ROLLBACK_FAILED` and requires inspection before retrying.

During migration, setup/update snapshot the prior receipt hash, both Codex registration states, and load-bearing installer-owned file hashes. It adds only missing registrations, validates LongTable doctor, removes only legacy LongTable role copies below Public Proposal-owned plugin roots, and atomically replaces `installation.json`. It never writes or deletes `.longtable/`, customer data, KPP project state, or approval artifacts. Retrying after a compensated failure does not duplicate registrations.

The `npx` form is intentionally repeatable: setup does not install a persistent `public-proposal` executable. Use the same `npx @longtable/public-proposal` prefix for doctor, update, and uninstall unless you deliberately choose the global fallback below.

The `kpp adopt` line uses `npx --package` because adoption belongs to the pinned KPP binary supplied as a dependency, not to the installer command. A single setup invocation registers both `public-proposal@public-proposal` and `longtable@longtable` as independent plugins. Their skills and ownership remain separate.

### Choose one installation scope

Codex has a **single global Codex `public-proposal` marketplace selector**. Therefore a user-scoped installation and a project-scoped installation cannot coexist when they point to different installer marketplace sources. Setup reports `PP_MARKETPLACE_CONFLICT` rather than redirecting the global selector.

Choose one scope, uninstall the existing Public Proposal installation, then set up the selected scope. For example, to move from user scope to the current project scope:

```bash
npx @longtable/public-proposal uninstall --install-scope user
npx @longtable/public-proposal setup --provider codex --install-scope project
npx @longtable/public-proposal doctor --install-scope project --json
```

Do not remove an unrelated Codex marketplace registration to force this transition. `uninstall` removes only the installation receipt's owned Public Proposal paths; if the existing marketplace source is not owned by that receipt, inspect it and choose one source before retrying setup.

The setup command uses the Codex marketplace flow internally:

```text
codex plugin marketplace add <installer-owned-install-root>/marketplace
codex plugin add public-proposal@public-proposal
```

Those paths are installer-owned; do not substitute an unrelated marketplace directory.

When LongTable is not already registered, vNext additionally uses:

```text
codex plugin marketplace add <installer-owned-install-root>/longtable-marketplace
codex plugin add longtable@longtable
```

If `longtable@longtable` already resolves to a compatible external marketplace, setup records that exact source and does not copy, redirect, or later uninstall it.

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
npm install --global @longtable/public-proposal@0.1.3 @longtable/kpp-cli@0.2.1 @longtable/cli@0.1.72
public-proposal setup --provider codex
public-proposal doctor --json
```

This section alone assumes the globally installed `public-proposal` executable. If setup stopped before it wrote a successful installation receipt, correct the reported blocker and run setup again. Do not copy files into an existing installation root or create a receipt by hand. For an already prepared installer-owned root, the two marketplace commands shown above are the manual plugin-registration fallback; then rerun `public-proposal doctor --json`.

To remove only files owned by a successful Public Proposal installation:

```bash
public-proposal uninstall
```

Uninstall preserves existing LongTable projects, `.longtable/` research state, KPP project data, and customer material. `public-proposal update` previews compatibility changes; use `public-proposal update --apply` only after checking the preview and the compatibility matrix. With the ephemeral path, use `npx @longtable/public-proposal uninstall` and `npx @longtable/public-proposal update` instead.

## Adopt a legacy proposal project

Adoption is a KPP project operation and does not mutate installer ownership:

```bash
kpp adopt <legacy-project> --source <rfp-or-source-packet> --master <working-master> --json
```

KPP copies source/master and existing claim/evidence/figure ledger bytes into governed project locations, records readable `.longtable` run links without moving or rewriting them, and writes provisional records for content with no source binding. A legacy Living Brief produces a candidate and decision diff. The project state is exactly `UNMANAGED_DRAFT`; no content, human, or release approval is created. The same bytes return the same adoption ID with no duplicate entries. New, removed, or changed input bytes fail closed with `KPP_ADOPTION_INPUT_CHANGED`; inspect its diff and choose a new project root or resolve the changed inputs deliberately.

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
| `PP_WORKER_PROTOCOL_MISSING` | The managed DOCX worker is absent, incompatible, or fails its protocol check. | Run `npx @longtable/public-proposal doctor --json`, restore a runtime in the documented Python compatibility range, then rerun setup. Do not interpret doctor as semver enforcement or point KPP at an unverified worker binary. |
| `PP_LONGTABLE_REQUIRED` | The project class needs LongTable, or the handoff no longer matches the locked project. | Prepare the required LongTable research handoff and confirm the project class before importing it with `kpp research-lock`. |
| `PP_RESEARCH_LOCK_MISSING` | A required project has no valid KPP-bound LongTable research lock. | Complete the required LongTable artifacts and checkpoints, then import the handoff with `kpp research-lock <project-root> --handoff <handoff.json> --json`. |
| `PP_RESEARCH_CHECKPOINT_OPEN` | A required researcher decision remains unresolved. | Resolve it with the researcher; do not bypass it in KPP. |
| `PP_LONGTABLE_VERSION_MISMATCH` | The handoff or installed CLI is not `@longtable/cli@0.1.72`. | Restore the pinned LongTable version and regenerate or revalidate the handoff. |

Research-lock recovery is deliberately conservative: KPP does not automatically overwrite a malformed, stale, or conflicting `research-lock.json` receipt. Preserve the existing artifact for inspection, correct the source handoff or project evidence, and use a clean, valid import path. Never delete `.longtable/` state as a generic recovery step.

## Human release boundary

The installer, Codex plugin, KPP audit, and LongTable research lock can establish technical readiness only. A release remains blocked until a named human owner approves the exact evidence boundary and proposal bytes. `AI-assisted draft`, a passing doctor, a valid research lock, and a passing technical audit are not submission-ready status by themselves.

The source release verifier also keeps package-release evidence separate:

| Field | Meaning |
| --- | --- |
| `localArtifactVerified` | Build, tests, tarball integrity, isolated commands, and the conditional research matrix completed locally. |
| `registryAvailable` | The exact package version resolved through `npm view @longtable/public-proposal@<version>` and its `dist.integrity` matched the verified local tarball. |
| `effectivenessValidated` | A versioned blinded human benchmark report met every promotion threshold. Machine scores do not qualify. |
| `releaseReady` | All three preceding fields are true and the forbidden-research gate passed. |

`npm pack` and `npx --package <tarball>` verify only local bytes. They do not prove npm visibility. The default benchmark is deterministic and machine-only, so it intentionally leaves `effectivenessValidated=false`. See [the vNext beta gate](../VNEXT-BETA.md) for promotion criteria and report usage.
