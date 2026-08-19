# Task 9 fix round 3 evidence

## Scope

Strengthened `tests/plugin/install-docs.test.ts` so the published/current
0.1.3 section rejects the bounded `kpp adopt` command category regardless of
placeholder spelling, option order, or surrounding formatting. The test now
extracts each vNext adoption section and checks an explicit vNext-only,
unavailable-until-publication, integrity-verification gate without comparing a
single copied sentence.

## Mutation scenario

Scenario: insert this alternate command into the published 0.1.3 legacy
section of `README.md`:

```text
kpp adopt --master <working-master> --source <source-packet> <legacy-project> --json
```

The old exact-string assertion passed the mutated fixture (6/6), confirming
the previous false-negative gap. After the regex assertion was installed, the
same mutation failed at `tests/plugin/install-docs.test.ts:64` with:

```text
1 failed, 5 passed
expected ... not to match /\bkpp\s+adopt\b/i
```

The mutation was removed before verification; no documentation content was
changed by this fix.

## Verification

Invocation:

```text
npm test -- --run tests/plugin/install-docs.test.ts tests/e2e/public-proposal-install.test.ts tests/benchmark/proposal-effectiveness.test.ts
```

Artifact: `tests/plugin/install-docs.test.ts`

```text
3 test files passed; 36 tests passed
```

Invocation: `npm run typecheck`

Artifact: repository TypeScript sources

```text
passed
```

Invocation: `npm run build`

Artifact: workspace build outputs

```text
passed for proposal-research-contracts, kpp-schemas, kpp-core, kpp-renderers,
kpp-audits, kpp-cli, and public-proposal
```

Invocation: `git diff --check HEAD`

Artifact: current source diff

```text
passed
```
