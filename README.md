# Public Proposal

Evidence-bound orchestration for Korean public-sector research and procurement proposals.

This repository is the canonical GitHub home for the English `$public-proposal` caller and the KPP document pipeline. It keeps issuer standards, visual source evidence, LongTable research context, Korean prose review, deterministic figures, and human approval in one handoffable product boundary.

## Install and run

### Published 0.1.3 legacy/current behavior

The npm registry currently serves `@longtable/public-proposal@0.1.3` as the published legacy/current artifact. Pin that version when reproducing it:

```bash
npx --yes @longtable/public-proposal@0.1.3 setup --provider codex
npx --yes @longtable/public-proposal@0.1.3 doctor --json
npx --yes @longtable/public-proposal@0.1.3 update
npx --yes @longtable/public-proposal@0.1.3 update --apply
npx --yes @longtable/public-proposal@0.1.3 uninstall
```

Do not use an unpinned `npx @longtable/public-proposal ...` command as the vNext install path. The published 0.1.3 artifact and this branch's vNext artifact are not interchangeable; the current registry artifact must not be described as the independent two-plugin vNext surface.

### Local vNext tarball / hermetic verification

Run the bounded verifier against the local workspace when checking this branch's vNext surface:

```bash
npm run verify:public-proposal
```

It builds and installs the complete local workspace tarball set in an isolated fixture, then checks the independent `public-proposal@public-proposal` and `longtable@longtable` registrations. A local `npm pack` or `npx --package <tarball>` run proves only local bytes; it does not prove npm visibility or registry identity.

### Published vNext beta (`0.2.0-beta.0`)

The vNext beta is published under the `beta` dist-tag. Pin the exact beta version while the blinded effectiveness gate remains open:

```bash
npx --yes @longtable/public-proposal@0.2.0-beta.0 setup --provider codex
npx --yes @longtable/public-proposal@0.2.0-beta.0 doctor --json
npx --yes @longtable/public-proposal@0.2.0-beta.0 update
npx --yes @longtable/public-proposal@0.2.0-beta.0 uninstall
```

The beta is not a `latest` promotion: `effectivenessValidated` remains false until the versioned blinded Owner, Procurement, and Research/Editorial evaluation passes. Verify the exact registry `dist.integrity` with `npm run verify:public-proposal` before using the command on a clean machine.

The vNext source keeps Public Proposal and LongTable as independent Codex registrations. Setup reuses a compatible external `longtable@longtable` registration or creates a separately receipted installer-owned LongTable marketplace; uninstall never removes an externally owned registration. Node `>=22 <27` and Python `>=3.11 <3.15` are compatibility requirements. The current setup and doctor commands verify that the required executables are available; they do not yet enforce those runtime version ranges.

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
kpp doctor --json
longtable scholar-research doctor --json
kpp research-lock <project-root> --handoff <longtable-handoff.json> --json
```

An `AI-assisted draft` or a technical audit pass is not submission readiness. Release requires issuer compliance, evidence binding, rendered DOCX/PDF inspection, and explicit human approval.

Customer documents, private evidence, personnel records, pricing, and bid-specific facts must remain in a separate project workspace.

## Effectiveness benchmark

The repository includes three source-hashed, synthetic benchmark classes and a deterministic A/B/C harness for the 0.1.3 baseline, conditional LongTable routing, and structured review. The harness preserves raw outputs and creates an arm-free human evaluation packet, but it does not call a model and cannot establish production efficacy. `effectivenessValidated` stays false until complete blinded Owner, Procurement, and Research/Editorial judgments satisfy the promotion thresholds. Benchmark scoring never sets `releaseReady`.

Run the local contract harness with:

```bash
node scripts/run_proposal_benchmark.mjs --fixture-set fixtures/benchmarks --out .artifacts/benchmark
node scripts/score_proposal_benchmark.mjs --input .artifacts/benchmark --output .artifacts/benchmark/report.json
```

See [the benchmark protocol](docs/BENCHMARKING.md) for fixed budgets, scorer fields, human packet format, limitations, and promotion thresholds.

`npm run verify:public-proposal` writes a local release report with four separate booleans: `localArtifactVerified`, `registryAvailable`, `effectivenessValidated`, and `releaseReady`. The default deterministic benchmark is machine-only, so `effectivenessValidated` and `releaseReady` remain false. A local tarball or `npx --package <tarball>` run does not prove that npm can resolve the same artifact; the verifier checks the exact version and `dist.integrity` separately with `npm view @longtable/public-proposal@<version>`. See [the vNext beta gate](docs/VNEXT-BETA.md).

### Adopt an existing draft (vNext beta)

Adoption is available from the verified vNext beta KPP binary, not from published 0.1.3. Use `adopt` when a legacy proposal directory has no KPP state:

```bash
kpp adopt <legacy-project> --source <rfp-or-source-packet> --master <working-master> --json
```

Adoption detects candidate RFP/source/master files, imports existing claim/evidence/figure ledgers, links readable `.longtable` runs in place, and labels source-less content `provisional`. When a legacy Living Brief exists, KPP creates a candidate and decision diff for human review. It always stops at `UNMANAGED_DRAFT`; it never creates content approval, human approval, or release receipts. An unchanged retry is idempotent. Changed input bytes fail with `KPP_ADOPTION_INPUT_CHANGED` and an explicit diff instead of overwriting the first adoption receipt.

See [`docs/architecture/public-proposal-context.md`](docs/architecture/public-proposal-context.md) for repository ownership, package responsibilities, context lanes, and release language.

## Product boundary

`enactionlabs` is a separate GitHub repository and is not the source of truth for this product. Do not add Public Proposal or KPP changes there.
