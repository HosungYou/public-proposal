#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK_PROTOCOL_VERSION } from "./run_proposal_benchmark.mjs";

export const SCORE_PROTOCOL_VERSION = "1.0.0";
const REQUIRED_EVALUATOR_ROLES = ["owner", "procurement", "research_editorial"];
const REQUIRED_CORE_DIMENSIONS = ["evidenceConfidence", "requirementDirectness", "researchOperationsLogic"];

export function scoreArm(output) {
  const requirements = output.requirementAnswers ?? [];
  const claims = output.claims ?? [];
  const figures = output.figures ?? [];
  const mandatoryClaimIds = output.mandatoryClaimIds ?? [];
  const mandatoryFigureIds = output.mandatoryFigureIds ?? [];
  const allowedInstitutionIds = new Set(output.allowedInstitutionIds ?? []);
  const sourceIds = new Set(output.sourceIds ?? []);
  const supportedClaims = claims.filter((claim) => sourceIds.has(claim.sourceId) && validLocator(claim));
  const traceableMandatoryClaims = mandatoryClaimIds.filter((claimId) => {
    const claim = claims.find((candidate) => candidate.claimId === claimId);
    return claim !== undefined && sourceIds.has(claim.sourceId) && validLocator(claim);
  });
  const traceableMandatoryFigures = mandatoryFigureIds.filter((figureId) => {
    const figure = figures.find((candidate) => candidate.figureId === figureId);
    return figure !== undefined
      && Array.isArray(figure.sourceIds)
      && figure.sourceIds.length > 0
      && figure.sourceIds.every((sourceId) => sourceIds.has(sourceId))
      && nonEmpty(figure.transform);
  });
  const unsupportedInstitutionClaims = claims.filter((claim) => !allowedInstitutionIds.has(claim.institutionId)).length;

  return {
    requirementDirectAnswerCoverage: ratio(requirements.filter(({ directAnswer }) => nonEmpty(directAnswer)).length, requirements.length),
    supportedClaimPrecision: ratio(supportedClaims.length, claims.length),
    unsupportedInstitutionClaims,
    wrongInstitutionClaims: unsupportedInstitutionClaims,
    sourcePageTraceability: ratio(supportedClaims.length, claims.length),
    mandatoryClaimTraceability: ratio(traceableMandatoryClaims.length, mandatoryClaimIds.length),
    figureLineage: ratio(traceableMandatoryFigures.length, mandatoryFigureIds.length),
    researchInvocationCorrectness: output.researchInvocationExpected === undefined
      ? null
      : output.longTableInvocations === output.researchInvocationExpected ? 1 : 0,
    evaluatorUsefulness: null,
    koreanNaturalness: null,
    sendReady: null,
    revisionBurdenMinutes: null,
    wallTimeMilliseconds: output.wallTimeMilliseconds ?? null,
    toolCalls: output.toolCalls ?? null,
    duplicateArtifacts: output.duplicateArtifactCount ?? 0,
    unusedResearch: output.unusedResearchCount ?? 0,
  };
}

export async function scoreBenchmark({ input, output, humanPacket }) {
  const inputRoot = resolve(input);
  const run = JSON.parse(await readFile(join(inputRoot, "run.json"), "utf8"));
  if (run.protocolVersion !== BENCHMARK_PROTOCOL_VERSION || run.harness !== "deterministic-placeholder") {
    throw new Error("Unsupported benchmark run protocol or harness.");
  }
  const scoredArms = [];
  for (const arm of run.arms) {
    const raw = JSON.parse(await readFile(arm.rawOutputPath, "utf8"));
    if (raw.outputId !== arm.outputId || raw.inputHash !== arm.inputHash) {
      throw new Error(`Raw benchmark binding mismatch: ${arm.outputId}`);
    }
    scoredArms.push({ ...arm, machine: scoreArm(raw) });
  }

  const human = humanPacket === undefined ? null : await loadHumanPacket(humanPacket, run, scoredArms);
  const thresholds = evaluateThresholds(run, scoredArms, human);
  const effectivenessValidated = human !== null && Object.values(thresholds).every(({ passed }) => passed === true);
  const humanScores = human === null ? [] : summarizeHumanScores(scoredArms, human.judgments);
  const report = {
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    scorerVersion: SCORE_PROTOCOL_VERSION,
    benchmarkRunId: run.runId,
    harness: run.harness,
    calibrationOnly: true,
    machineScoreNotice: "Machine scores validate contracts and calibrate the packet; they are not effectiveness evidence.",
    humanEvaluationRequired: human === null,
    humanEvaluation: human === null
      ? { status: "missing", packetPath: null, evaluatorIdentitiesStored: false }
      : { status: "present", packetPath: resolve(humanPacket), evaluatorIdentitiesStored: false, judgmentCount: human.judgments.length },
    effectivenessValidated,
    thresholds,
    arms: scoredArms,
    humanScores,
    costs: scoredArms.map(({ outputId, cost, tokenUsage, toolCalls, wallTimeMilliseconds }) => ({
      outputId,
      cost,
      tokenUsage,
      toolCalls,
      wallTimeMilliseconds,
    })),
    rawEvidencePreserved: await rawEvidenceExists(run),
    rawEvidencePaths: scoredArms.map(({ rawOutputPath }) => rawOutputPath),
    humanEvaluationPacketPath: run.humanEvaluationPacketPath,
  };
  await writeJson(resolve(output), report);
  return report;
}

function evaluateThresholds(run, arms, human) {
  const generalInvocations = arms
    .filter(({ fixtureId }) => fixtureId === "general-procurement")
    .reduce((sum, arm) => sum + arm.longTableInvocations, 0);
  const candidateArms = arms.filter(({ arm }) => arm === "C");
  const baselineWall = average(arms.filter(({ arm }) => arm === "A").map(({ wallTimeMilliseconds }) => wallTimeMilliseconds));
  const candidateWall = average(candidateArms.map(({ wallTimeMilliseconds }) => wallTimeMilliseconds));
  const wallRatio = baselineWall === 0 ? Number.POSITIVE_INFINITY : candidateWall / baselineWall;
  const unsupported = candidateArms.reduce((sum, arm) => sum + arm.machine.unsupportedInstitutionClaims, 0);
  const wrongInstitution = candidateArms.reduce((sum, arm) => sum + arm.machine.wrongInstitutionClaims, 0);
  const mandatoryTraceability = minimum(candidateArms.map((arm) => arm.machine.mandatoryClaimTraceability));
  const figureLineage = minimum(candidateArms.map((arm) => arm.machine.figureLineage));
  const humanThresholds = human === null ? { improvement: null, coreRegression: null } : scoreHumanThresholds(run, human);

  return {
    compositeHumanImprovement: {
      passed: humanThresholds.improvement !== null && humanThresholds.improvement >= 0.10,
      actual: humanThresholds.improvement,
      minimum: 0.10,
    },
    noCoreDimensionRegression: {
      passed: humanThresholds.coreRegression !== null && humanThresholds.coreRegression > -5,
      worstChangePercentagePoints: humanThresholds.coreRegression,
      minimumChangePercentagePoints: -5,
    },
    zeroUnsupportedInstitutionClaims: { passed: unsupported === 0, actual: unsupported, maximum: 0 },
    zeroWrongInstitutionClaims: { passed: wrongInstitution === 0, actual: wrongInstitution, maximum: 0 },
    mandatoryClaimTraceability: { passed: mandatoryTraceability === 1, actual: mandatoryTraceability, minimum: 1 },
    mandatoryFigureLineage: { passed: figureLineage === 1, actual: figureLineage, minimum: 1 },
    wallTimeIncrease: { passed: wallRatio <= 1.25, actualRatio: wallRatio, maximumRatio: 1.25 },
    noUnexpectedResearchInvocation: { passed: generalInvocations === 0, actual: generalInvocations, maximum: 0 },
  };
}

async function loadHumanPacket(path, run, arms) {
  const packet = JSON.parse(await readFile(resolve(path), "utf8"));
  const validEnvelope = packet.protocolVersion === BENCHMARK_PROTOCOL_VERSION
    && packet.scorerVersion === SCORE_PROTOCOL_VERSION
    && packet.benchmarkRunId === run.runId
    && packet.blinded === true
    && Array.isArray(packet.judgments);
  if (!validEnvelope || packet.judgments.length === 0) {
    throw new Error("Expected a versioned blinded human evaluation packet.");
  }
  const outputIds = new Set(arms.map(({ outputId }) => outputId));
  const judgmentKeys = new Set();
  for (const judgment of packet.judgments) {
    if ("arm" in judgment || "evaluatorIdentity" in judgment || !outputIds.has(judgment.outputId)) {
      throw new Error("Expected a versioned blinded human evaluation packet without arm or evaluator identity.");
    }
    if (!REQUIRED_EVALUATOR_ROLES.includes(judgment.evaluatorRole)
      || !bounded(judgment.compositeScore, 0, 100)
      || !isCoreDimensions(judgment.coreDimensions)
      || !bounded(judgment.evaluatorUsefulness, 1, 5)
      || !bounded(judgment.koreanNaturalness, 1, 5)
      || !bounded(judgment.revisionBurdenMinutes, 0, 10_000)
      || typeof judgment.sendReady !== "boolean") {
      throw new Error("Human evaluation packet contains an invalid judgment.");
    }
    const judgmentKey = `${judgment.outputId}:${judgment.evaluatorRole}`;
    if (judgmentKeys.has(judgmentKey)) throw new Error(`Human evaluation packet contains a duplicate human judgment: ${judgmentKey}.`);
    judgmentKeys.add(judgmentKey);
  }
  for (const outputId of outputIds) {
    const roles = new Set(packet.judgments.filter((judgment) => judgment.outputId === outputId).map(({ evaluatorRole }) => evaluatorRole));
    if (REQUIRED_EVALUATOR_ROLES.some((role) => !roles.has(role))) {
      throw new Error(`Human evaluation packet is incomplete for ${outputId}.`);
    }
  }
  return packet;
}

function summarizeHumanScores(arms, judgments) {
  return arms.map(({ outputId, fixtureId, arm }) => {
    const outputJudgments = judgments.filter((judgment) => judgment.outputId === outputId);
    return {
      outputId,
      fixtureId,
      arm,
      evaluatorUsefulness: average(outputJudgments.map(({ evaluatorUsefulness }) => evaluatorUsefulness)),
      koreanNaturalness: average(outputJudgments.map(({ koreanNaturalness }) => koreanNaturalness)),
      sendReadyRate: average(outputJudgments.map(({ sendReady }) => sendReady ? 1 : 0)),
      revisionBurdenMinutes: average(outputJudgments.map(({ revisionBurdenMinutes }) => revisionBurdenMinutes)),
      compositeScore: average(outputJudgments.map(({ compositeScore }) => compositeScore)),
    };
  });
}

function scoreHumanThresholds(run, packet) {
  const armByOutput = new Map(run.arms.map(({ outputId, arm }) => [outputId, arm]));
  const baseline = packet.judgments.filter(({ outputId }) => armByOutput.get(outputId) === "A");
  const candidate = packet.judgments.filter(({ outputId }) => armByOutput.get(outputId) === "C");
  const baselineComposite = average(baseline.map(({ compositeScore }) => compositeScore));
  const candidateComposite = average(candidate.map(({ compositeScore }) => compositeScore));
  const improvement = baselineComposite === 0 ? null : (candidateComposite - baselineComposite) / baselineComposite;
  const dimensionNames = Object.keys(baseline[0]?.coreDimensions ?? {});
  const changes = dimensionNames.map((dimension) => average(candidate.map(({ coreDimensions }) => coreDimensions[dimension]))
    - average(baseline.map(({ coreDimensions }) => coreDimensions[dimension])));
  return { improvement, coreRegression: changes.length === 0 ? null : minimum(changes) };
}

function isCoreDimensions(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) return false;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(REQUIRED_CORE_DIMENSIONS)) return false;
  return Object.values(value).every((score) => bounded(score, 0, 100));
}

function bounded(value, minimumValue, maximumValue) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimumValue && value <= maximumValue;
}

function validLocator(claim) {
  return (Number.isInteger(claim.page) && claim.page > 0) || nonEmpty(claim.sourceLocator);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function minimum(values) {
  return values.length === 0 ? 0 : Math.min(...values);
}

async function rawEvidenceExists(run) {
  try {
    await Promise.all(run.arms.map(({ rawOutputPath }) => access(rawOutputPath)));
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function parseArguments(argv) {
  const options = { input: ".artifacts/benchmark", output: ".artifacts/benchmark/report.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") options.input = argv[++index];
    else if (value === "--output") options.output = argv[++index];
    else if (value === "--human-packet") options.humanPacket = argv[++index];
    else throw new Error(`Unknown scorer argument: ${value}`);
  }
  return options;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scoreBenchmark(parseArguments(process.argv.slice(2)))
    .then((report) => process.stdout.write(`${JSON.stringify({ ok: true, effectivenessValidated: report.effectivenessValidated })}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
