#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCHMARK_PROTOCOL_VERSION = "1.0.0";
export const DEFAULT_BENCHMARK_BUDGETS = Object.freeze({
  timeMinutes: 45,
  tokenLimit: 40_000,
  toolCallLimit: 20,
});

const ARMS = Object.freeze([
  { arm: "A", workflow: "public-proposal-0.1.3-baseline", structuredReview: false },
  { arm: "B", workflow: "vnext-conditional-longtable", structuredReview: false },
  { arm: "C", workflow: "vnext-conditional-longtable-structured-review", structuredReview: true },
]);

export async function runBenchmark({
  fixtureSet,
  out,
  fixture,
  arms = ["A", "B", "C"],
  seeds = [1, 2, 3],
  budgets = DEFAULT_BENCHMARK_BUDGETS,
}) {
  const fixtureRoot = resolve(fixtureSet);
  const outputRoot = resolve(out);
  assertBudgets(budgets);
  assertSeeds(seeds);
  const selectedArms = ARMS.filter(({ arm }) => arms.includes(arm));
  if (selectedArms.length !== arms.length || selectedArms.length === 0) {
    throw new Error("Benchmark arms must be a non-empty subset of A, B, and C.");
  }

  const manifests = await loadManifests(fixtureRoot, fixture);
  await mkdir(join(outputRoot, "raw"), { recursive: true });
  await mkdir(join(outputRoot, "human"), { recursive: true });

  const inputHashes = Object.fromEntries(manifests.map(({ manifest, inputHash }) => [manifest.fixtureId, inputHash]));
  const runId = `benchmark-${hashJson({ protocolVersion: BENCHMARK_PROTOCOL_VERSION, inputHashes, seeds, budgets }).slice(0, 20)}`;
  const rawArms = [];

  for (const { manifest, inputHash } of manifests) {
    for (const seed of seeds) {
      for (const armDefinition of selectedArms) {
        const outputId = `output-${hashJson({ runId, fixtureId: manifest.fixtureId, seed, arm: armDefinition.arm }).slice(0, 16)}`;
        const output = makeDeterministicOutput(manifest, armDefinition, seed, inputHash, outputId, budgets);
        const rawOutputPath = join(outputRoot, "raw", `${outputId}.json`);
        const blindedOutputPath = join(outputRoot, "human", "outputs", `${outputId}.json`);
        const rawOutputBytes = await writeJson(rawOutputPath, output);
        await writeJson(blindedOutputPath, {
          protocolVersion: BENCHMARK_PROTOCOL_VERSION,
          outputId,
          fixtureId: manifest.fixtureId,
          harnessNotice: output.harnessNotice,
          readerTasks: manifest.readerTasks,
          requirementAnswers: output.requirementAnswers,
          claims: output.claims,
          figures: output.figures,
        });
        rawArms.push({
          fixtureId: manifest.fixtureId,
          arm: armDefinition.arm,
          workflow: armDefinition.workflow,
          inputHash,
          seed,
          budgets: { ...budgets },
          outputId,
          rawOutputPath,
          blindedOutputPath,
          harness: "deterministic-placeholder",
          modelExecution: "not-run",
          humanEvaluationRequired: true,
          rawOutputSha256: sha256(rawOutputBytes),
          longTableInvocations: output.longTableInvocations,
          researchInvocationExpected: output.researchInvocationExpected,
          wallTimeMilliseconds: output.wallTimeMilliseconds,
          tokenUsage: output.tokenUsage,
          toolCalls: output.toolCalls,
          duplicateArtifactCount: output.duplicateArtifactCount,
          unusedResearchCount: output.unusedResearchCount,
          cost: output.cost,
          structuredReviewConfigured: output.structuredReviewConfigured,
        });
      }
    }
  }

  const humanEvaluationPacketPath = join(outputRoot, "human", "blinded-evaluation-packet.json");
  await writeJson(humanEvaluationPacketPath, {
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    benchmarkRunId: runId,
    blinded: true,
    evaluatorRolesRequired: ["owner", "procurement", "research_editorial"],
    notice: "No human scores are present. Populate a separate versioned response packet after blinded review.",
    criteria: [
      "evaluatorUsefulness",
      "koreanNaturalness",
      "sendReady",
      "revisionBurdenMinutes",
      "requirementDirectness",
      "evidenceConfidence",
      "researchOperationsLogic",
    ],
    outputs: rawArms.map(({ fixtureId, outputId, seed, blindedOutputPath }) => ({
      fixtureId,
      outputId,
      seed,
      artifactPath: blindedOutputPath,
    })),
  });

  const report = {
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    runId,
    harness: "deterministic-placeholder",
    harnessNotice: "No model or external research service was invoked. Outputs exercise reproducibility, lineage, routing, and scoring contracts only.",
    humanEvaluationRequired: true,
    fixtures: manifests.map(({ manifest }) => ({
      fixtureId: manifest.fixtureId,
      proposalClass: manifest.proposalClass,
      synthetic: manifest.synthetic,
      customerData: manifest.customerData,
      researchExpectation: manifest.researchExpectation,
    })),
    inputHashes,
    budgets: { ...budgets },
    seeds: [...seeds],
    arms: rawArms,
    humanEvaluationPacketPath,
    rawEvidencePreserved: true,
  };
  await writeJson(join(outputRoot, "run.json"), report);
  return report;
}

async function loadManifests(fixtureRoot, requestedFixture) {
  const entries = await readdir(fixtureRoot, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
    .map((entry) => entry.name)
    .filter((name) => requestedFixture === undefined || name === requestedFixture)
    .sort();
  if (names.length === 0) throw new Error(`No benchmark fixture found${requestedFixture ? ` for ${requestedFixture}` : ""}.`);

  return Promise.all(names.map(async (name) => {
    const manifestPath = join(fixtureRoot, name, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    validateManifest(manifest, name);
    const sourceBindings = [];
    for (const source of manifest.sources) {
      const sourcePath = resolve(dirname(manifestPath), source.path);
      if (!relative(fixtureRoot, sourcePath) || relative(fixtureRoot, sourcePath).startsWith("..")) {
        throw new Error(`Benchmark source escapes fixture set: ${source.path}`);
      }
      const bytes = await readFile(sourcePath);
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== source.sha256) throw new Error(`Benchmark source hash mismatch: ${source.sourceId}`);
      sourceBindings.push({ sourceId: source.sourceId, path: source.path, sha256: actual });
    }
    return {
      manifest,
      inputHash: hashJson({ manifest, sourceBindings }),
    };
  }));
}

function validateManifest(manifest, directoryName) {
  if (manifest.schemaVersion !== "1.0.0" || manifest.fixtureId !== directoryName) {
    throw new Error(`Invalid benchmark manifest: ${directoryName}`);
  }
  if (manifest.synthetic !== true || manifest.customerData !== false) {
    throw new Error(`Benchmark fixture must be explicitly synthetic and customer-free: ${directoryName}`);
  }
  for (const field of ["sources", "requirements", "permittedDataOperations", "targetClaims", "figureQuestions", "readerTasks"]) {
    if (!Array.isArray(manifest[field]) || manifest[field].length === 0) {
      throw new Error(`Benchmark manifest ${directoryName} is missing ${field}.`);
    }
  }
  const expectation = manifest.researchExpectation;
  if (!expectation || !["required", "forbidden"].includes(expectation.longTableInvocation)) {
    throw new Error(`Benchmark manifest ${directoryName} has no research invocation expectation.`);
  }
}

function makeDeterministicOutput(manifest, armDefinition, seed, inputHash, outputId, budgets) {
  const sourceIds = manifest.sources.map(({ sourceId }) => sourceId);
  const longTableInvocations = manifest.researchExpectation.expectedCount;
  const claims = manifest.targetClaims.map((claim) => ({
    claimId: claim.claimId,
    institutionId: manifest.institutionId,
    sourceId: claim.requiredSourceIds[0],
    page: 1,
    sourceLocator: "synthetic-fixture:1",
    text: claim.question,
  }));
  return {
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    outputId,
    arm: armDefinition.arm,
    fixtureId: manifest.fixtureId,
    inputHash,
    seed,
    harness: "deterministic-placeholder",
    harnessNotice: "Contract-only synthetic output; it is not evidence of model effectiveness.",
    workflow: armDefinition.workflow,
    structuredReviewConfigured: armDefinition.structuredReview,
    budgets: { ...budgets },
    requirementAnswers: manifest.requirements.map(({ requirementId }) => ({
      requirementId,
      directAnswer: `합성 벤치마크 요구사항 ${requirementId}에 대한 추적 가능한 자리표시자`,
    })),
    claims,
    allowedInstitutionIds: [manifest.institutionId],
    figures: manifest.figureQuestions.map((figure) => ({
      figureId: figure.figureId,
      sourceIds: figure.requiredSourceIds,
      transform: manifest.permittedDataOperations.join(";"),
    })),
    mandatoryClaimIds: manifest.targetClaims.filter(({ mandatory }) => mandatory).map(({ claimId }) => claimId),
    mandatoryFigureIds: manifest.figureQuestions.filter(({ mandatory }) => mandatory).map(({ figureId }) => figureId),
    sourceIds,
    longTableInvocations,
    researchInvocationExpected: manifest.researchExpectation.expectedCount,
    wallTimeMilliseconds: 1_000,
    tokenUsage: 0,
    toolCalls: longTableInvocations,
    duplicateArtifactCount: 0,
    unusedResearchCount: 0,
    cost: { currency: "USD", amount: 0, status: "no-model-execution" },
  };
}

function assertBudgets(budgets) {
  if (budgets.timeMinutes !== 45 || budgets.tokenLimit !== 40_000 || budgets.toolCallLimit !== 20) {
    throw new Error("Benchmark budgets must match the fixed protocol budget.");
  }
}

function assertSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0 || seeds.some((seed) => !Number.isSafeInteger(seed))) {
    throw new Error("Benchmark seeds must be a non-empty list of safe integers.");
  }
}

function hashJson(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path, bytes, { mode: 0o600 });
  return bytes;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArguments(argv) {
  const options = { fixtureSet: "fixtures/benchmarks", out: ".artifacts/benchmark", seeds: [1, 2, 3] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--fixture-set") options.fixtureSet = argv[++index];
    else if (value === "--out") options.out = argv[++index];
    else if (value === "--fixture") options.fixture = argv[++index];
    else if (value === "--seeds") options.seeds = argv[++index].split(",").map(Number);
    else throw new Error(`Unknown benchmark argument: ${value}`);
  }
  return options;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBenchmark(parseArguments(process.argv.slice(2)))
    .then((report) => process.stdout.write(`${JSON.stringify({ ok: true, runId: report.runId, humanEvaluationRequired: true })}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
