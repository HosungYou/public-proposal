# @longtable/public-proposal

Pinned meta-installer for the Public Proposal Codex plugin, bundled Korean public-proposal authority, KPP CLI, LongTable CLI, and managed KPP DOCX worker.

This package is published on npm as `@longtable/public-proposal@0.1.3`. The commands below are the supported interface; pin `@0.1.3` when reproducibility is required.

```bash
npx @longtable/public-proposal setup --provider codex
npx @longtable/public-proposal doctor --json
```

This release coordinates the following exact contract:

| Component | Version / protocol | Authority |
| --- | --- | --- |
| `@longtable/public-proposal` | `0.1.3` | Installer and installation receipt |
| `@longtable/kpp-cli` | `0.2.1` | Proposal state, receipts, build, audit, approval, release |
| `@longtable/cli` | `0.1.72` | Conditional LongTable research and evidence service |
| managed DOCX worker | protocol `1.0.0` | Deterministic DOCX construction and OOXML checks |
| bundled `korean-public-proposal` | plugin `0.1.0` snapshot | Korean public-document rules and visual/prose baseline |

The user-facing `$public-proposal` skill provides conversation context and routing. KPP remains the only proposal-state and receipt writer; LongTable does not approve or release proposals. A Codex plugin install adds skills/resources only and does not expand Codex permissions.

The vNext installer records Public Proposal and LongTable registration ownership separately. A compatible pre-existing `longtable@longtable` registration is `externally_owned` and remains untouched by uninstall; an absent registration is created in a separate installer-owned marketplace. Setup/update snapshot the previous receipt, registration state, and owned-file hashes before migration, add only missing registrations, run LongTable doctor, remove only legacy LongTable skill copies under Public Proposal-owned roots, and atomically replace the receipt. Failed migration compensates only additions from that invocation and is safe to retry.

Existing proposal work is adopted through KPP, not the installer:

```bash
kpp adopt <legacy-project> --source <source-packet> --master <working-master> --json
```

The result is `UNMANAGED_DRAFT`. `.longtable/`, customer files, prior approval artifacts, and working bytes are not rewritten; source-less content remains provisional and approval/release receipts are never inferred.

Codex has a **single global Codex `public-proposal` marketplace selector**. User and project installation roots cannot coexist when they use different marketplace sources: setup reports `PP_MARKETPLACE_CONFLICT`. Choose one scope, uninstall the existing Public Proposal installation, then set up the selected scope; see the installation guide for the scoped commands and ownership boundary.

Node `>=22 <27` and Python `>=3.11 <3.15` are compatibility requirements. The current setup and doctor commands check executable availability, not runtime semver ranges. Academic, research-service, and policy-research projects require a valid LongTable research lock before approval-ready authoring and subsequent approval or release. General procurement is conditional on an academic-evidence slot; document restyling is not research-locked.

For manual installation, recovery, clean uninstall, and error handling, see the repository [installation guide](https://github.com/HosungYou/public-proposal/blob/main/docs/installation/INSTALL.md).
