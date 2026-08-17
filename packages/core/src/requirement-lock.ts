import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  ConfirmedRequirementsSchema,
  type ConfirmedRequirements,
  type RequirementBinding,
  RequirementDecisionFileSchema,
  RfpCandidatesFileSchema,
  type RequirementDecision,
  type RequirementDecisionFile,
  type RfpCandidate,
} from "@kpp/schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";
import { advanceProject, verifyProjectState } from "./state-machine.js";
import { writeReceipt } from "./receipts.js";

const SCHEMA_VERSION = "1.0.0";

export interface RequirementLockInput {
  readonly candidates: unknown;
  readonly decisions: unknown;
}

export interface RequirementLockResult {
  readonly state: "REQUIREMENTS_LOCKED";
  readonly requirementsPath: string;
  readonly conflictsPath: string;
  readonly complianceMatrixPath: string;
  readonly decisionLedgerPath: string;
  readonly receiptPath: string;
}

interface ConflictRecord {
  readonly constraintKey: string;
  readonly candidateIds: readonly string[];
  readonly status: "resolved" | "unresolved";
  readonly resolution: "issuer_precedence" | "human_decision" | null;
  readonly selectedCandidateId: string | null;
}

interface ComplianceMatrixRow {
  readonly candidateId: string;
  readonly category: RfpCandidate["category"];
  readonly extractedText: string;
  readonly sourceLocator: string;
  readonly sourceSha256: string;
  readonly sourceAuthority: RequirementDecision["sourceAuthority"];
  readonly decision: RequirementDecision["decision"];
  readonly decisionStatus: "confirmed" | "superseded" | "rejected" | "conflict" | "no_rule";
  readonly targetRequirementIds: readonly string[];
  readonly targetPageIds: readonly string[];
  readonly targetPageRoles: readonly string[];
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly rationale: string;
}

interface LockedSource {
  readonly originalPath: string;
  readonly copiedPath: string;
  readonly sha256: string;
}

export async function lockRequirements(
  rootInput: string,
  input: RequirementLockInput,
): Promise<RequirementLockResult> {
  const root = resolve(rootInput);
  const project = await verifyProjectState(root);
  if (project.state !== "SOURCE_LOCKED") {
    throw new KppError(
      "KPP_STATE_INVALID_TRANSITION",
      "요구사항 확인은 SOURCE_LOCKED 상태에서만 잠글 수 있습니다.",
      { stage: project.state, expected: "SOURCE_LOCKED", actual: project.state },
    );
  }

  const candidates = normalizeCandidates(parseCandidates(input.candidates));
  const decisions = parseDecisions(input.decisions);
  const decisionsByCandidateId = validateDecisionCoverage(candidates.candidates, decisions);
  await validateCandidateSources(candidates.candidates);
  await validateIssuerAuthority(root, candidates.candidates, decisionsByCandidateId);

  const conflicts = resolveConflicts(candidates.candidates, decisions, decisionsByCandidateId);
  const unresolved = conflicts.filter(({ status }) => status === "unresolved");
  if (unresolved.length > 0) {
    throw new KppError(
      "KPP_INPUT_REQUIREMENT_CONFLICT",
      "발주처 기준으로 해소되지 않은 요구사항 충돌이 있습니다.",
      {
        rule: "requirement_conflict_unresolved",
        actual: unresolved,
      },
    );
  }

  const requirements = ConfirmedRequirementsSchema.parse({
    schemaVersion: decisions.schemaVersion,
    confirmationStatus: "confirmed",
    confirmedBy: decisions.confirmedBy,
    requirements: decisions.requirements.requirements.map(({ sourceCandidateIds: _ignored, ...requirement }) => requirement),
    evidenceBindings: decisions.requirements.evidenceBindings,
  });
  const bindingsByCandidateId = validateRequirementBindings(
    decisions.requirementBindings,
    decisionsByCandidateId,
    requirements,
  );
  const requirementsWithCandidateIds = applyCandidateBindings(requirements, bindingsByCandidateId);
  const complianceMatrix = buildComplianceMatrix(
    candidates.candidates,
    decisionsByCandidateId,
    conflicts,
    bindingsByCandidateId,
    requirementsWithCandidateIds,
  );

  const requirementsPath = join(root, "requirements", "requirements.json");
  const conflictsPath = join(root, "requirements", "conflicts.json");
  const complianceMatrixPath = join(root, "requirements", "compliance-matrix.json");
  const decisionLedgerPath = join(root, "requirements", "decision-ledger.json");
  const receiptPath = join(root, "receipts", "requirements-lock.json");

  await writeJsonAtomically(requirementsPath, requirementsWithCandidateIds);
  await writeJsonAtomically(conflictsPath, {
    schemaVersion: SCHEMA_VERSION,
    conflicts,
  });
  await writeJsonAtomically(complianceMatrixPath, {
    schemaVersion: SCHEMA_VERSION,
    rows: complianceMatrix,
  });
  await writeJsonAtomically(decisionLedgerPath, decisions);

  const sourceReceiptPath = join(root, "receipts", "source-lock.json");
  await writeReceipt({
    stage: "REQUIREMENTS_LOCKED",
    files: [
      requirementsPath,
      conflictsPath,
      complianceMatrixPath,
      decisionLedgerPath,
      ...new Set(candidates.candidates.map(({ sourcePath }) => sourcePath)),
    ],
    inputReceiptHashes: [await sha256File(sourceReceiptPath)],
    output: receiptPath,
  });
  await advanceProject(root, "REQUIREMENTS_LOCKED");

  return {
    state: "REQUIREMENTS_LOCKED",
    requirementsPath,
    conflictsPath,
    complianceMatrixPath,
    decisionLedgerPath,
    receiptPath,
  };
}

function parseCandidates(value: unknown) {
  const parsed = RfpCandidatesFileSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new KppError("KPP_INPUT_REQUIREMENTS_INVALID", "요구사항 후보 JSON 형식이 올바르지 않습니다.", {
    rule: "candidates_schema",
    actual: parsed.error.issues,
  });
}

function normalizeCandidates(candidates: ReturnType<typeof parseCandidates>) {
  return {
    ...candidates,
    candidates: candidates.candidates.map((candidate) => ({
      ...candidate,
      sourcePath: resolve(candidate.sourcePath),
    })),
  };
}

function parseDecisions(value: unknown): RequirementDecisionFile {
  const parsed = RequirementDecisionFileSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new KppError("KPP_INPUT_REQUIREMENTS_INVALID", "사람 확인 요구사항 JSON 형식이 올바르지 않습니다.", {
    rule: "decisions_schema",
    actual: parsed.error.issues,
  });
}

function validateDecisionCoverage(
  candidates: readonly RfpCandidate[],
  decisionFile: RequirementDecisionFile,
): ReadonlyMap<string, RequirementDecision> {
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const decisionsByCandidateId = new Map(decisionFile.decisions.map((decision) => [decision.candidateId, decision]));
  const missing = candidates
    .filter(({ candidateId }) => !decisionsByCandidateId.has(candidateId))
    .map(({ candidateId }) => candidateId);
  if (missing.length > 0) {
    throw new KppError(
      "KPP_INPUT_REQUIREMENT_DECISION_MISSING",
      "자동 추출 후보는 사람의 명시적 결정 없이는 확정할 수 없습니다.",
      { rule: "candidate_decision_missing", actual: missing },
    );
  }

  const unknown = decisionFile.decisions
    .filter(({ candidateId }) => !candidateById.has(candidateId))
    .map(({ candidateId }) => candidateId);
  if (unknown.length > 0) {
    throw new KppError("KPP_INPUT_REQUIREMENT_DECISION_INVALID", "존재하지 않는 후보에 대한 결정이 있습니다.", {
      rule: "candidate_decision_unknown",
      actual: unknown,
    });
  }

  for (const candidate of candidates) {
    const decision = decisionsByCandidateId.get(candidate.candidateId)!;
    if (
      decision.sourceLocator !== candidate.sourceLocator
      || decision.sourceSha256 !== candidate.sourceSha256
    ) {
      throw new KppError(
        "KPP_INPUT_REQUIREMENT_SOURCE_UNVERIFIED",
        "필수 제출조건의 결정 근거가 후보 출처와 일치하지 않습니다.",
        {
          rule: "decision_provenance_mismatch",
          path: candidate.sourcePath,
          expected: {
            sourceLocator: candidate.sourceLocator,
            sourceSha256: candidate.sourceSha256,
          },
          actual: {
            sourceLocator: decision.sourceLocator,
            sourceSha256: decision.sourceSha256,
          },
        },
      );
    }
  }
  return decisionsByCandidateId;
}

async function validateCandidateSources(candidates: readonly RfpCandidate[]): Promise<void> {
  await Promise.all(candidates.map(async (candidate) => {
    const sourcePath = candidate.sourcePath;
    try {
      const metadata = await stat(sourcePath);
      if (!metadata.isFile()) {
        throw new Error("source is not a file");
      }
      const actualSha256 = await sha256File(sourcePath);
      if (actualSha256 !== candidate.sourceSha256) {
        throw new KppError(
          "KPP_INPUT_REQUIREMENT_SOURCE_UNVERIFIED",
          "필수 제출조건 후보의 원문 해시가 일치하지 않습니다.",
          {
            rule: "candidate_source_sha256_mismatch",
            path: sourcePath,
            expected: candidate.sourceSha256,
            actual: actualSha256,
          },
        );
      }
    } catch (error) {
      if (error instanceof KppError) {
        throw error;
      }
      throw new KppError(
        "KPP_INPUT_REQUIREMENT_SOURCE_UNVERIFIED",
        "필수 제출조건 후보의 원문을 읽을 수 없습니다.",
        {
          rule: "candidate_source_unreadable",
          path: sourcePath,
          actual: error instanceof Error ? error.message : error,
        },
      );
    }
  }));
}

async function validateIssuerAuthority(
  root: string,
  candidates: readonly RfpCandidate[],
  decisionsByCandidateId: ReadonlyMap<string, RequirementDecision>,
): Promise<void> {
  const manifestPath = join(root, "sources", "manifest.json");
  const lockedSources = await readLockedSources(manifestPath);
  for (const candidate of candidates) {
    const decision = decisionsByCandidateId.get(candidate.candidateId)!;
    if (decision.sourceAuthority !== "issuer") {
      continue;
    }
    const sourcePath = resolve(candidate.sourcePath);
    const matchesLockedSource = lockedSources.some((source) => (
      source.sha256 === candidate.sourceSha256
      && (resolve(source.originalPath) === sourcePath || resolve(source.copiedPath) === sourcePath)
    ));
    if (!matchesLockedSource) {
      throw new KppError(
        "KPP_INPUT_REQUIREMENT_SOURCE_UNVERIFIED",
        "발주처 우선 규칙은 잠긴 발주처 원문에 연결된 후보에만 적용할 수 있습니다.",
        {
          rule: "issuer_source_not_locked",
          path: sourcePath,
          actual: candidate.candidateId,
        },
      );
    }
  }
}

async function readLockedSources(manifestPath: string): Promise<readonly LockedSource[]> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new KppError("KPP_INPUT_REQUIREMENT_SOURCE_UNVERIFIED", "잠긴 발주처 원문 manifest를 읽을 수 없습니다.", {
      rule: "source_manifest_unreadable",
      path: manifestPath,
      actual: error instanceof Error ? error.message : error,
    });
  }
  try {
    const record = JSON.parse(raw) as { sources?: unknown };
    if (!Array.isArray(record.sources)) {
      throw new Error("sources must be an array");
    }
    const sources = record.sources.map((source) => {
      if (
        typeof source !== "object"
        || source === null
        || typeof source.originalPath !== "string"
        || typeof source.copiedPath !== "string"
        || typeof source.sha256 !== "string"
      ) {
        throw new Error("invalid source manifest entry");
      }
      return source as LockedSource;
    });
    if (sources.length === 0) {
      throw new Error("source manifest is empty");
    }
    return sources;
  } catch (error) {
    throw new KppError("KPP_INPUT_REQUIREMENT_SOURCE_UNVERIFIED", "잠긴 발주처 원문 manifest 형식이 올바르지 않습니다.", {
      rule: "source_manifest_invalid",
      path: manifestPath,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

function resolveConflicts(
  candidates: readonly RfpCandidate[],
  decisionFile: RequirementDecisionFile,
  decisionsByCandidateId: ReadonlyMap<string, RequirementDecision>,
): readonly ConflictRecord[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const groups = new Map<string, RequirementDecision[]>();
  for (const decision of decisionFile.decisions) {
    const group = groups.get(decision.constraintKey) ?? [];
    group.push(decision);
    groups.set(decision.constraintKey, group);
  }

  const resolutionsByKey = new Map(
    decisionFile.resolutions.map((resolution) => [resolution.constraintKey, resolution]),
  );
  const conflicts: ConflictRecord[] = [];
  for (const [constraintKey, decisions] of groups) {
    const confirmed = decisions.filter(({ decision }) => decision === "confirm");
    const distinctValues = new Set(confirmed.map(({ candidateId }) => candidateById.get(candidateId)!.extractedText));
    const explicitConflict = decisions.some(({ decision }) => decision === "conflict");
    if (distinctValues.size <= 1 && !explicitConflict) {
      continue;
    }

    const issuerConfirmed = confirmed.filter(({ sourceAuthority }) => sourceAuthority === "issuer");
    const issuerValues = new Set(
      issuerConfirmed.map(({ candidateId }) => candidateById.get(candidateId)!.extractedText),
    );
    if (!explicitConflict && issuerConfirmed.length > 0 && issuerValues.size === 1) {
      conflicts.push({
        constraintKey,
        candidateIds: decisions.map(({ candidateId }) => candidateId),
        status: "resolved",
        resolution: "issuer_precedence",
        selectedCandidateId: issuerConfirmed[0]!.candidateId,
      });
      continue;
    }

    const resolution = resolutionsByKey.get(constraintKey);
    const selected = resolution === undefined
      ? undefined
      : decisionsByCandidateId.get(resolution.selectedCandidateId);
    if (
      selected !== undefined
      && selected.decision === "confirm"
      && decisions.some(({ candidateId }) => candidateId === selected.candidateId)
    ) {
      conflicts.push({
        constraintKey,
        candidateIds: decisions.map(({ candidateId }) => candidateId),
        status: "resolved",
        resolution: "human_decision",
        selectedCandidateId: selected.candidateId,
      });
      continue;
    }
    conflicts.push({
      constraintKey,
      candidateIds: decisions.map(({ candidateId }) => candidateId),
      status: "unresolved",
      resolution: null,
      selectedCandidateId: null,
    });
  }
  return conflicts.sort((left, right) => left.constraintKey.localeCompare(right.constraintKey));
}

function validateRequirementBindings(
  bindings: readonly RequirementBinding[],
  decisionsByCandidateId: ReadonlyMap<string, RequirementDecision>,
  requirements: ConfirmedRequirements,
): ReadonlyMap<string, readonly string[]> {
  const requirementIds = new Set(requirements.requirements.map(({ requirementId }) => requirementId));
  const targetRequirementIdsByCandidateId = new Map<string, readonly string[]>();
  for (const binding of bindings) {
    if (targetRequirementIdsByCandidateId.has(binding.candidateId)) {
      throw new KppError(
        "KPP_INPUT_REQUIREMENT_MAPPING_DUPLICATE",
        "하나의 후보에는 하나의 요구사항 연결만 선언할 수 있습니다.",
        { rule: "binding_candidate_duplicate", actual: binding.candidateId },
      );
    }
    const duplicatedTargetIds = binding.targetRequirementIds
      .filter((requirementId, index, ids) => ids.indexOf(requirementId) !== index);
    if (duplicatedTargetIds.length > 0) {
      throw new KppError(
        "KPP_INPUT_REQUIREMENT_MAPPING_DUPLICATE",
        "하나의 후보 연결에 같은 요구사항을 중복할 수 없습니다.",
        { rule: "binding_requirement_duplicate", actual: [...new Set(duplicatedTargetIds)] },
      );
    }
    const decision = decisionsByCandidateId.get(binding.candidateId);
    if (decision === undefined) {
      throw new KppError(
        "KPP_INPUT_REQUIREMENT_MAPPING_UNKNOWN",
        "요구사항 연결이 존재하지 않는 후보를 가리킵니다.",
        { rule: "binding_candidate_unknown", actual: binding.candidateId },
      );
    }
    if (decision.decision !== "confirm") {
      throw new KppError(
        "KPP_INPUT_REQUIREMENT_MAPPING_INVALID",
        "확정되지 않은 후보에는 요구사항 연결을 만들 수 없습니다.",
        { rule: "binding_candidate_not_confirmed", actual: binding.candidateId },
      );
    }
    const unknownRequirementIds = binding.targetRequirementIds
      .filter((requirementId) => !requirementIds.has(requirementId));
    if (unknownRequirementIds.length > 0) {
      throw new KppError(
        "KPP_INPUT_REQUIREMENT_MAPPING_UNKNOWN",
        "요구사항 연결 대상이 잠금 입력에 없습니다.",
        {
          rule: "binding_requirement_unknown",
          actual: unknownRequirementIds,
          expected: [...requirementIds],
        },
      );
    }
    targetRequirementIdsByCandidateId.set(binding.candidateId, binding.targetRequirementIds);
  }

  const missingConfirmedCandidateIds = [...decisionsByCandidateId.values()]
    .filter(({ decision }) => decision === "confirm")
    .map(({ candidateId }) => candidateId)
    .filter((candidateId) => !targetRequirementIdsByCandidateId.has(candidateId));
  if (missingConfirmedCandidateIds.length > 0) {
    throw new KppError(
      "KPP_INPUT_REQUIREMENT_MAPPING_MISSING",
      "확정된 제출조건은 하나 이상의 실제 요구사항과 페이지 역할에 연결되어야 합니다.",
      { rule: "confirmed_candidate_mapping_missing", actual: missingConfirmedCandidateIds },
    );
  }
  return targetRequirementIdsByCandidateId;
}

function applyCandidateBindings(
  requirements: ConfirmedRequirements,
  bindingsByCandidateId: ReadonlyMap<string, readonly string[]>,
): ConfirmedRequirements {
  return {
    ...requirements,
    requirements: requirements.requirements.map((requirement) => {
      const sourceCandidateIds = [...bindingsByCandidateId]
        .filter(([, targetRequirementIds]) => targetRequirementIds.includes(requirement.requirementId))
        .map(([candidateId]) => candidateId);
      return sourceCandidateIds.length === 0
        ? requirement
        : { ...requirement, sourceCandidateIds };
    }),
  };
}

function buildComplianceMatrix(
  candidates: readonly RfpCandidate[],
  decisionsByCandidateId: ReadonlyMap<string, RequirementDecision>,
  conflicts: readonly ConflictRecord[],
  bindingsByCandidateId: ReadonlyMap<string, readonly string[]>,
  requirements: ConfirmedRequirements,
): readonly ComplianceMatrixRow[] {
  const selectedByConstraintKey = new Map(
    conflicts.map((conflict) => [conflict.constraintKey, conflict.selectedCandidateId]),
  );
  const pageByRequirementId = new Map(requirements.requirements.map((requirement, index) => [
    requirement.requirementId,
    {
      pageId: `PAGE-${String(index + 1).padStart(3, "0")}`,
      pageRole: requirement.pageRole,
    },
  ]));
  return candidates.map((candidate) => {
    const decision = decisionsByCandidateId.get(candidate.candidateId)!;
    const selectedCandidateId = selectedByConstraintKey.get(decision.constraintKey);
    const decisionStatus = decision.decision === "confirm"
      ? selectedCandidateId !== undefined && selectedCandidateId !== candidate.candidateId
        ? "superseded"
        : "confirmed"
      : decision.decision === "reject"
        ? "rejected"
        : decision.decision;
    const targetRequirementIds = bindingsByCandidateId.get(candidate.candidateId) ?? [];
    const targets = targetRequirementIds.map((requirementId) => pageByRequirementId.get(requirementId)!);
    return {
      candidateId: candidate.candidateId,
      category: candidate.category,
      extractedText: candidate.extractedText,
      sourceLocator: candidate.sourceLocator,
      sourceSha256: candidate.sourceSha256,
      sourceAuthority: decision.sourceAuthority,
      decision: decision.decision,
      decisionStatus,
      targetRequirementIds,
      targetPageIds: targets.map(({ pageId }) => pageId),
      targetPageRoles: targets.map(({ pageRole }) => pageRole),
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      rationale: decision.rationale,
    };
  });
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let created = false;
  let renamed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    renamed = true;
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    if (created && !renamed) {
      await rm(temporaryPath, { force: true });
    }
  }
}
