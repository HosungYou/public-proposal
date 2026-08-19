# Public Proposal vNext beta gate

vNext is a gated beta candidate, not a `latest` promotion claim. The repository verifier never runs `npm publish` and never changes a dist-tag.

## Published 0.1.3 legacy/current behavior

The registry currently serves `@longtable/public-proposal@0.1.3` as the published legacy/current artifact. Reproduce that artifact with the exact version-pinned commands:

```bash
npx --yes @longtable/public-proposal@0.1.3 setup --provider codex
npx --yes @longtable/public-proposal@0.1.3 doctor --json
npx --yes @longtable/public-proposal@0.1.3 update
npx --yes @longtable/public-proposal@0.1.3 update --apply
npx --yes @longtable/public-proposal@0.1.3 uninstall
```

This published 0.1.3 artifact is not the independent two-plugin vNext surface in this branch. Do not use an unpinned `npx @longtable/public-proposal ...` command as a vNext claim.

## Local vNext tarball / hermetic verification

Verify the vNext source locally with the bounded verifier:

```bash
npm run verify:public-proposal
```

The verifier builds and installs the complete local workspace tarball set in an isolated fixture and checks the independent `public-proposal@public-proposal` and `longtable@longtable` registrations. A local `npm pack` or `npx --package <tarball>` run proves only local bytes; it does not prove npm visibility.

## Future vNext registry command

Only after a new vNext version has been published and the exact registry `dist.integrity` matches the verified local tarball may the future version-pinned command be used:

```bash
npx --yes @longtable/public-proposal@<vnext-version> setup --provider codex
```

`<vnext-version>` is a placeholder, not an invented release. Until that gate passes, this document does not provide a registry command for vNext.

## vNext-only adoption (unavailable until publication)

Adoption is a vNext-only command and is unavailable from published 0.1.3 until vNext publication and integrity verification. Once that gate passes, use the KPP binary from the verified vNext installation:

```bash
kpp adopt <legacy-project> --source <source-packet> --master <working-master> --json
```

In the vNext source, one setup registers `public-proposal@public-proposal` and `longtable@longtable` from independently receipted sources. A compatible external LongTable registration is reused and remains externally owned. Uninstall removes only installer-owned registrations and files. Codex has a **single global Codex `public-proposal` marketplace selector**, so user- and project-scoped installations with different sources cannot coexist; setup reports `PP_MARKETPLACE_CONFLICT`.

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
