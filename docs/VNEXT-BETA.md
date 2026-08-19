# Public Proposal vNext beta gate

vNext is a gated beta candidate, not a `latest` promotion claim. The repository verifier never runs `npm publish` and never changes a dist-tag.

## One command, two independent plugins

```bash
npx --yes @longtable/public-proposal setup --provider codex
```

This registers `public-proposal@public-proposal` and `longtable@longtable` from independently receipted sources. A compatible external LongTable registration is reused and remains externally owned. Uninstall removes only installer-owned registrations and files. Codex has one global `public-proposal` marketplace selector, so user- and project-scoped installations with different sources cannot coexist; setup reports `PP_MARKETPLACE_CONFLICT`.

Use the complete command matrix:

```bash
npx --yes @longtable/public-proposal setup --provider codex
npx --yes @longtable/public-proposal doctor --json
npx --yes @longtable/public-proposal update
npx --yes @longtable/public-proposal update --apply
npx --yes --package @longtable/public-proposal kpp adopt <legacy-project> --source <source-packet> --master <working-master> --json
npx --yes @longtable/public-proposal uninstall
```

## Conditional LongTable routing

LongTable is required for `academic_research`, `research_service`, and `policy_research`. It is required for `general_procurement` only when a locked requirement contains an academic-evidence slot. Ordinary general procurement and `document_restyle` must not invoke LongTable. Any LongTable invocation in the ordinary general-procurement benchmark fails with `PP_UNEXPECTED_RESEARCH_INVOCATION`.

## Four independent release signals

Run the bounded local verifier:

```bash
npm run verify:public-proposal
```

The JSON report records:

- `localArtifactVerified`: local build, tests, tarball, isolated installation commands, and research matrix passed;
- `registryAvailable`: the exact version was found by `npm view @longtable/public-proposal@<version>` and its `dist.integrity` matched the local tarball;
- `effectivenessValidated`: a versioned blinded human evaluation passed all thresholds;
- `releaseReady`: all three signals are true and no forbidden research invocation occurred.

The report preserves its benchmark run, score, blinded packet, and raw evidence paths. The default runner is a deterministic contract harness; it does not call a model and is not evidence of production effectiveness. Therefore its normal result is `effectivenessValidated=false`, `releaseReady=false`, with human evaluation required.

To evaluate an existing versioned blinded response packet without embedding identities or customer data in the repository:

```bash
PUBLIC_PROPOSAL_BENCHMARK_HUMAN_PACKET=/absolute/path/to/human-response.json npm run verify:public-proposal
```

The scorer accepts only the exact versioned, arm-free schema. It requires complete Owner, Procurement, and Research/Editorial judgments and rejects unknown workflow or arm-revealing fields.

## Promotion criteria

A beta recommendation requires at least 10% composite human improvement, no core-dimension regression of 5 percentage points or more, zero wrong-institution transfer, zero unsupported institution claims, complete mandatory claim and figure traceability, no more than 25% wall-time increase, and zero LongTable calls for ordinary general procurement. The three representative classes must be evaluated by humans using the blinded packet.

A local `npm pack` or `npx --package <tarball>` run proves only the inspected local artifact. It does not prove npm identity. Registry availability is a separate exact-version and integrity probe. Do not promote `latest` until the report says `releaseReady=true` and the named human release owner separately approves the exact package bytes and evidence boundary.
