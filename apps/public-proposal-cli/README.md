# @longtable/public-proposal

Pinned meta-installer for the Public Proposal Codex plugin, bundled Korean public-proposal authority, KPP CLI, LongTable CLI, and managed KPP DOCX worker.

This package is published on npm as `@longtable/public-proposal@0.2.2`. The commands below are the supported interface; pin `@0.2.2` when reproducibility is required.

```bash
npx @longtable/public-proposal setup --provider codex
npx @longtable/public-proposal doctor --json
```

This release coordinates the following exact contract:

| Component | Version / protocol | Authority |
| --- | --- | --- |
| `@longtable/public-proposal` | `0.2.2` | Installer and installation receipt |
| `@longtable/kpp-cli` | `0.3.0` | Proposal state, receipts, build, audit, approval, release |
| `@longtable/cli` | `0.1.72` | Conditional LongTable research and evidence service |
| managed DOCX worker | protocol `1.0.0` | Deterministic DOCX construction and OOXML checks |
| bundled `korean-public-proposal` | plugin `0.1.0` snapshot | Korean public-document rules and visual/prose baseline |

The user-facing `$public-proposal` skill provides conversation context and routing. KPP remains the only proposal-state and receipt writer; LongTable does not approve or release proposals. A Codex plugin install adds skills/resources only and does not expand Codex permissions.

Codex has a **single global Codex `public-proposal` marketplace selector**. User and project installation roots cannot coexist when they use different marketplace sources: setup reports `PP_MARKETPLACE_CONFLICT`. Choose one scope, uninstall the existing Public Proposal installation, then set up the selected scope; see the installation guide for the scoped commands and ownership boundary.

Node `>=22 <27` and Python `>=3.11 <3.15` are compatibility requirements. The current setup and doctor commands check executable availability, not runtime semver ranges. Academic, research-service, and policy-research projects require a valid LongTable research lock before approval-ready authoring and subsequent approval or release. General procurement is conditional on an academic-evidence slot; document restyling is not research-locked.

For manual installation, recovery, clean uninstall, and error handling, see the repository [installation guide](https://github.com/HosungYou/public-proposal/blob/main/docs/installation/INSTALL.md).
