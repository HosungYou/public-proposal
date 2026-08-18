# @longtable/public-proposal

Pinned meta-installer for the Public Proposal Codex plugin, bundled Korean public-proposal authority, KPP CLI, LongTable CLI, and managed KPP DOCX worker.

As of 2026-08-18, registry publication is a release prerequisite: this package has been verified as a local npm tarball but is not yet available from the public npm registry. The commands below are the intended interface after `@longtable/public-proposal@0.1.0` is published.

```bash
npx @longtable/public-proposal setup --provider codex
npx @longtable/public-proposal doctor --json
```

This release coordinates the following exact contract:

| Component | Version / protocol | Authority |
| --- | --- | --- |
| `@longtable/public-proposal` | `0.1.0` | Installer and installation receipt |
| `@longtable/kpp-cli` | `0.2.1` | Proposal state, receipts, build, audit, approval, release |
| `@longtable/cli` | `0.1.72` | Conditional LongTable research and evidence service |
| managed DOCX worker | protocol `1.0.0` | Deterministic DOCX construction and OOXML checks |
| bundled `korean-public-proposal` | plugin `0.1.0` snapshot | Korean public-document rules and visual/prose baseline |

The user-facing `$public-proposal` skill provides conversation context and routing. KPP remains the only proposal-state and receipt writer; LongTable does not approve or release proposals. A Codex plugin install adds skills/resources only and does not expand Codex permissions.

Node `>=22 <27` and Python `>=3.11 <3.15` are compatibility requirements. The current setup and doctor commands check executable availability, not runtime semver ranges. Academic, research-service, and policy-research projects require a valid LongTable research lock before approval-ready authoring and subsequent approval or release. General procurement is conditional on an academic-evidence slot; document restyling is not research-locked.

For manual installation, recovery, clean uninstall, and error handling, see the repository [installation guide](https://github.com/HosungYou/public-proposal/blob/main/docs/installation/INSTALL.md).
