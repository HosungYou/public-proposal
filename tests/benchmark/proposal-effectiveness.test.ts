import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BENCHMARK_PROTOCOL_VERSION,
  runBenchmark,
} from "../../scripts/run_proposal_benchmark.mjs";
import {
  SCORE_PROTOCOL_VERSION,
  scoreArm,
  scoreBenchmark,
} from "../../scripts/score_proposal_benchmark.mjs";
import { validateBenchmarkEvidence } from "../../scripts/verify_public_proposal_release.mjs";

const roots: string[] = [];
const fixtureSet = resolve("fixtures/benchmarks");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("proposal effectiveness benchmark", () => {
  it("uses identical input hashes, seeds, and bounded budgets across blind arms", async () => {
    const out = await temporaryOutput();
    const report = await runBenchmark({ fixtureSet, out, fixture: "research-service", seeds: [7] });

    expect(report.protocolVersion).toBe(BENCHMARK_PROTOCOL_VERSION);
    expect(new Set(report.arms.map((arm) => arm.inputHash))).toEqual(new Set([report.inputHashes["research-service"]]));
    expect(new Set(report.arms.map((arm) => arm.seed))).toEqual(new Set([7]));
    expect(report.arms.every((arm) => arm.budgets.timeMinutes === 45)).toBe(true);
    expect(report.arms.every((arm) => arm.budgets.tokenLimit === 40_000)).toBe(true);
    expect(report.arms.every((arm) => arm.budgets.toolCallLimit === 20)).toBe(true);
    expect(report.arms.every((arm) => !arm.outputId.includes(arm.arm))).toBe(true);
    expect(new Set(report.arms.map((arm) => arm.outputId)).size).toBe(3);
  });

  it("runs all three synthetic fixture classes without customer data", async () => {
    const out = await temporaryOutput();
    const report = await runBenchmark({ fixtureSet, out, seeds: [1] });

    expect(Object.keys(report.inputHashes).sort()).toEqual([
      "general-procurement",
      "policy-research",
      "research-service",
    ]);
    expect(report.fixtures.every((fixture) => fixture.synthetic === true && fixture.customerData === false)).toBe(true);
    expect(report.arms).toHaveLength(9);
  });

  it("never invokes LongTable for the ordinary no-research fixture", async () => {
    const out = await temporaryOutput();
    const report = await runBenchmark({ fixtureSet, out, fixture: "general-procurement", seeds: [3] });

    expect(report.arms.every((arm) => arm.longTableInvocations === 0)).toBe(true);
  });

  it("keeps raw outputs and blinded evaluation packets separate", async () => {
    const out = await temporaryOutput();
    const report = await runBenchmark({ fixtureSet, out, fixture: "policy-research", seeds: [2] });
    const packet = JSON.parse(await readFile(report.humanEvaluationPacketPath, "utf8")) as Record<string, unknown>;
    const packetText = JSON.stringify(packet);

    expect(packet).toMatchObject({ protocolVersion: BENCHMARK_PROTOCOL_VERSION, blinded: true });
    expect(packetText).not.toContain('"arm"');
    expect(packetText).not.toContain("evaluatorIdentity");
    expect(report.arms.every((arm) => arm.rawOutputPath.startsWith(`${out}/raw/`))).toBe(true);
    const firstPacketOutput = (packet.outputs as Array<{ artifactPath: string }>)[0];
    const blindedArtifact = JSON.parse(await readFile(firstPacketOutput.artifactPath, "utf8")) as Record<string, unknown>;
    expect(blindedArtifact).toMatchObject({ outputId: expect.stringMatching(/^output-/u), readerTasks: expect.any(Array) });
    expect(blindedArtifact).not.toHaveProperty("arm");
    expect(blindedArtifact).not.toHaveProperty("workflow");
  });

  it("scores supported claims and figure lineage from source bindings", () => {
    const scored = scoreArm({
      requirementAnswers: [{ requirementId: "REQ-1", directAnswer: "합성 요구사항에 답함" }],
      claims: [{ claimId: "CLM-1", institutionId: "SYNTH-INST-1", sourceId: "SRC-1", page: 2 }],
      allowedInstitutionIds: ["SYNTH-INST-1"],
      figures: [{ figureId: "FIG-1", sourceIds: ["SRC-1"], transform: "sum(value)" }],
      mandatoryClaimIds: ["CLM-1"],
      mandatoryFigureIds: ["FIG-1"],
      sourceIds: ["SRC-1"],
      duplicateArtifactCount: 0,
      unusedResearchCount: 0,
    });

    expect(scored).toMatchObject({
      requirementDirectAnswerCoverage: 1,
      supportedClaimPrecision: 1,
      unsupportedInstitutionClaims: 0,
      mandatoryClaimTraceability: 1,
      figureLineage: 1,
    });
  });

  it("does not count unbound source identifiers as claim or figure traceability", () => {
    const scored = scoreArm({
      requirementAnswers: [{ requirementId: "REQ-1", directAnswer: "답변" }],
      claims: [{ claimId: "CLM-1", institutionId: "SYNTH-INST-1", sourceId: "MISSING", page: 1 }],
      allowedInstitutionIds: ["SYNTH-INST-1"],
      sourceIds: ["SRC-1"],
      figures: [{ figureId: "FIG-1", sourceIds: ["MISSING"], transform: "sum(value)" }],
      mandatoryClaimIds: ["CLM-1"],
      mandatoryFigureIds: ["FIG-1"],
    });

    expect(scored.supportedClaimPrecision).toBe(0);
    expect(scored.sourcePageTraceability).toBe(0);
    expect(scored.mandatoryClaimTraceability).toBe(0);
    expect(scored.figureLineage).toBe(0);
  });

  it("does not validate effectiveness without versioned blinded human judgments", async () => {
    const out = await temporaryOutput();
    const run = await runBenchmark({ fixtureSet, out, seeds: [1] });
    const report = await scoreBenchmark({ input: out, output: join(out, "report.json") });

    expect(report.scorerVersion).toBe(SCORE_PROTOCOL_VERSION);
    expect(report.humanEvaluationRequired).toBe(true);
    expect(report.effectivenessValidated).toBe(false);
    expect(report).not.toHaveProperty("releaseReady");
    expect(report.thresholds.compositeHumanImprovement.passed).toBe(false);
    expect(run.harness).toBe("deterministic-placeholder");
  });

  it("rejects unversioned or arm-revealing human input", async () => {
    const out = await temporaryOutput();
    await runBenchmark({ fixtureSet, out, seeds: [1] });
    const humanPath = join(out, "bad-human.json");
    await writeFile(humanPath, `${JSON.stringify({ judgments: [{ outputId: "x", arm: "C" }] })}\n`);

    await expect(scoreBenchmark({ input: out, output: join(out, "report.json"), humanPacket: humanPath }))
      .rejects.toThrow(/versioned blinded human evaluation packet/u);
  });

  it("ingests complete blinded role judgments and evaluates every human threshold", async () => {
    const out = await temporaryOutput();
    const run = await runBenchmark({ fixtureSet, out, seeds: [1] });
    const humanPath = join(out, "human-response.json");
    const roles = ["owner", "procurement", "research_editorial"] as const;
    const judgments = run.arms.flatMap(({ arm, outputId }) => roles.map((evaluatorRole) => ({
      outputId,
      evaluatorRole,
      compositeScore: arm === "A" ? 70 : arm === "C" ? 80 : 75,
      coreDimensions: {
        requirementDirectness: arm === "A" ? 70 : arm === "C" ? 76 : 73,
        evidenceConfidence: arm === "A" ? 72 : arm === "C" ? 78 : 75,
        researchOperationsLogic: arm === "A" ? 71 : arm === "C" ? 77 : 74,
      },
      evaluatorUsefulness: arm === "A" ? 3 : 4,
      koreanNaturalness: arm === "A" ? 3 : 4,
      sendReady: arm === "C",
      revisionBurdenMinutes: arm === "A" ? 60 : arm === "C" ? 40 : 50,
    })));
    await writeFile(humanPath, `${JSON.stringify({
      protocolVersion: BENCHMARK_PROTOCOL_VERSION,
      scorerVersion: SCORE_PROTOCOL_VERSION,
      benchmarkRunId: run.runId,
      blinded: true,
      judgments,
    }, null, 2)}\n`);

    const report = await scoreBenchmark({ input: out, output: join(out, "report.json"), humanPacket: humanPath });

    expect(report.humanEvaluationRequired).toBe(false);
    expect(report.effectivenessValidated).toBe(true);
    expect(report.thresholds.compositeHumanImprovement.passed).toBe(true);
    expect(report.thresholds.noCoreDimensionRegression.passed).toBe(true);
    expect(report.humanScores).toHaveLength(9);
    expect(report.humanScores.find(({ arm }) => arm === "C"))
      .toMatchObject({ evaluatorUsefulness: 4, koreanNaturalness: 4, sendReadyRate: 1, revisionBurdenMinutes: 40 });

    const candidateIds = new Set(run.arms.filter(({ arm }) => arm === "C").map(({ outputId }) => outputId));
    for (const judgment of judgments) {
      if (candidateIds.has(judgment.outputId)) judgment.coreDimensions.requirementDirectness = 65;
    }
    await writeFile(humanPath, `${JSON.stringify({
      protocolVersion: BENCHMARK_PROTOCOL_VERSION,
      scorerVersion: SCORE_PROTOCOL_VERSION,
      benchmarkRunId: run.runId,
      blinded: true,
      judgments,
    }, null, 2)}\n`);
    const boundary = await scoreBenchmark({ input: out, output: join(out, "boundary-report.json"), humanPacket: humanPath });
    expect(boundary.thresholds.noCoreDimensionRegression.passed).toBe(false);
    expect(boundary.effectivenessValidated).toBe(false);

    judgments.push({ ...judgments[0], coreDimensions: { ...judgments[0].coreDimensions } });
    await writeFile(humanPath, `${JSON.stringify({
      protocolVersion: BENCHMARK_PROTOCOL_VERSION,
      scorerVersion: SCORE_PROTOCOL_VERSION,
      benchmarkRunId: run.runId,
      blinded: true,
      judgments,
    }, null, 2)}\n`);
    await expect(scoreBenchmark({ input: out, output: join(out, "duplicate-report.json"), humanPacket: humanPath }))
      .rejects.toThrow(/duplicate human judgment/u);
  });

  it("reports the no-research promotion threshold as failed on any invocation", async () => {
    const out = await temporaryOutput();
    await runBenchmark({ fixtureSet, out, seeds: [1] });
    const runPath = join(out, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8")) as { arms: Array<Record<string, unknown>> };
    const ordinary = run.arms.find((arm) => arm.fixtureId === "general-procurement" && arm.arm === "C");
    if (ordinary === undefined) throw new Error("ordinary fixture arm missing");
    ordinary.longTableInvocations = 1;
    await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);

    const report = await scoreBenchmark({ input: out, output: join(out, "report.json") });
    expect(report.thresholds.noUnexpectedResearchInvocation).toMatchObject({ passed: false, actual: 1, maximum: 0 });
    expect(report.effectivenessValidated).toBe(false);
  });

  it("makes release verification treat machine-only benchmark evidence as incomplete", () => {
    expect(validateBenchmarkEvidence({
      protocolVersion: BENCHMARK_PROTOCOL_VERSION,
      scorerVersion: SCORE_PROTOCOL_VERSION,
      effectivenessValidated: false,
      humanEvaluationRequired: true,
      rawEvidencePreserved: true,
    })).toEqual({ ok: false, code: "PP_EFFECTIVENESS_HUMAN_EVALUATION_REQUIRED" });
  });
});

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-benchmark-test-"));
  roots.push(root);
  return root;
}
