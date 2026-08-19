# Public Proposal effectiveness benchmark

This benchmark is an effectiveness-evaluation protocol, not a product claim. It fixes the input bytes, seeds, capability budget, and scoring contract for three synthetic proposal classes. The committed fixtures contain no customer, KEITI, evaluator, or bid data.

## Arms and controls

| Arm | Workflow under comparison | Research behavior |
| --- | --- | --- |
| A | Public Proposal 0.1.3 baseline contract | Follows the fixture's declared research expectation |
| B | vNext with conditional LongTable | Follows the same expectation and budget |
| C | B plus structured reviewer/adjudication | Follows the same expectation and budget |

Every arm receives the same content hash and seed. The fixed per-output budget is 45 minutes, 40,000 tokens, and 20 tool calls. Output IDs are opaque in the evaluator packet; the arm mapping remains in the raw operator report. The ordinary `general-procurement` fixture declares LongTable forbidden, so any invocation fails promotion.

The current runner is a deterministic placeholder harness. It executes input binding, routing, lineage, blinding, and scorer contracts without calling a model or external research service. Its outputs must not be cited as evidence that vNext is more effective.

## Run and score

```bash
node scripts/run_proposal_benchmark.mjs \
  --fixture-set fixtures/benchmarks \
  --out .artifacts/benchmark

node scripts/score_proposal_benchmark.mjs \
  --input .artifacts/benchmark \
  --output .artifacts/benchmark/report.json
```

The run preserves:

- `run.json`: input hashes, seeds, budgets, arm mapping, resource use, and raw paths;
- `raw/*.json`: operator-only arm outputs and cost fields;
- `human/outputs/*.json`: arm-free artifacts for reviewers;
- `human/blinded-evaluation-packet.json`: the versioned review template;
- `report.json`: machine calibration, human-evaluation status, and threshold results.

`.artifacts/` is intentionally untracked. If a private benchmark is run, keep both its inputs and outputs outside the repository. Do not add evaluator identity to a response packet.

## Human response packet

Human judgments are accepted only from a JSON packet with:

- `protocolVersion: "1.0.0"`, `scorerVersion: "1.0.0"`, and the exact `benchmarkRunId`;
- `blinded: true` and no `arm` or `evaluatorIdentity` field;
- one judgment from each of `owner`, `procurement`, and `research_editorial` for every output ID;
- a 0–100 composite score and core-dimension scores;
- 1–5 evaluator-usefulness and Korean-naturalness scores;
- send-ready status and non-negative human revision minutes.

Pass that separate packet only after the blind review:

```bash
node scripts/score_proposal_benchmark.mjs \
  --input .artifacts/benchmark \
  --output .artifacts/benchmark/report-with-human.json \
  --human-packet /private/path/blinded-human-response.json
```

Machine metrics cover direct-answer coverage, supported-claim precision, institution transfer, source/page traceability, mandatory claim and figure lineage, research invocation correctness, wall time, tool calls, duplicates, and unused research. They are calibration and safety gates only. Evaluator usefulness, Korean naturalness, send-ready status, and revision burden come only from the blinded human packet.

## Promotion thresholds

`effectivenessValidated` remains `false` until complete human judgments are present and all thresholds pass:

- composite human score improves by at least 10% from A to C;
- no core human dimension falls by 5 percentage points or more;
- wrong-institution and unsupported institution claims remain zero;
- mandatory claim traceability and figure lineage remain 100%;
- C wall time is no more than 125% of A;
- the no-research fixture records zero LongTable invocations.

The benchmark report intentionally has no `releaseReady` field. Release readiness remains the release gate's authority and also depends on registry visibility, technical verification, and approvals. A passing synthetic test or machine-only report cannot promote a package.

## Limitations

The committed data are synthetic and intentionally small. The placeholder harness does not estimate prose quality, real retrieval recall, real cost, real latency, or institutional usability. Production efficacy requires representative private documents, real bounded model/tool runs, blinded role review, and preservation of the resulting private evidence outside Git.
