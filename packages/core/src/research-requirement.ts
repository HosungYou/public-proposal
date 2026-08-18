import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import {
  ConfirmedRequirementsSchema,
  ResearchLockSchema,
  type ProposalClass,
  type ResearchLock,
} from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";
import { readProject } from "./project-store.js";
import { verifyReceipt } from "./receipts.js";

const REQUIRED_RESEARCH_CLASSES = new Set<ProposalClass>([
  "academic_research",
  "research_service",
  "policy_research",
]);
const SUPPORTED_LONGTABLE_VERSION = "0.1.72";
const GATE_STAGE = "CONTENT_APPROVED" as const;

const ARTIFACT_BINDINGS = [
  ["researchSpecificationPath", "researchSpecificationSha256"],
  ["citationSlotMatrixPath", "citationSlotMatrixSha256"],
  ["sourceLedgerPath", "sourceLedgerSha256"],
  ["claimTransferLedgerPath", "claimTransferLedgerSha256"],
] as const;

export function requiresResearchLock(
  proposalClass: ProposalClass,
  hasAcademicEvidence: boolean,
): boolean {
  return REQUIRED_RESEARCH_CLASSES.has(proposalClass)
    || (proposalClass === "general_procurement" && hasAcademicEvidence);
}

export async function verifyResearchRequirement(root: string): Promise<void> {
  await getResearchLockReceiptHash(root);
}

export async function resolveProjectResearchRequirement(rootInput: string) {
  const root = resolve(rootInput);
  const project = await readProject(root);
  const hasAcademicEvidence = project.proposalClass === "general_procurement"
    ? await lockedRequirementsHaveAcademicEvidence(root)
    : false;
  return {
    project,
    required: requiresResearchLock(project.proposalClass, hasAcademicEvidence),
  } as const;
}

export async function getResearchLockReceiptHash(rootInput: string): Promise<string | null> {
  const root = resolve(rootInput);
  const { project, required } = await resolveProjectResearchRequirement(root);
  if (!required) {
    return null;
  }

  const receiptPath = join(root, "receipts", "research-lock.json");
  let verification;
  try {
    verification = await verifyReceipt(receiptPath);
  } catch (error) {
    if (error instanceof KppError && error.code === "KPP_INPUT_RECEIPT_READ") {
      throw gateError("PP_RESEARCH_LOCK_MISSING", "LongTable 연구 잠금 영수증이 필요합니다.", {
        path: receiptPath,
      });
    }
    throw withGateStage(error);
  }
  if (!verification.valid) {
    throw gateError("KPP_INPUT_RECEIPT_INVALID", "연구 잠금 영수증에 연결된 입력이 변경되었습니다.", {
      path: receiptPath,
      actual: verification.mismatches,
    });
  }
  if (verification.receipt.stage !== "EVIDENCE_LOCKED" || verification.receipt.result !== "PASS") {
    throw gateError("KPP_INPUT_RECEIPT_INVALID", "연구 잠금 영수증 형식이 유효하지 않습니다.", {
      path: receiptPath,
      expected: { stage: "EVIDENCE_LOCKED", result: "PASS" },
      actual: { stage: verification.receipt.stage, result: verification.receipt.result },
    });
  }

  const handoff = await findBoundHandoff(verification.receipt.files.map(({ path }) => path));
  if (handoff === null) {
    throw gateError("PP_LONGTABLE_REQUIRED", "검증된 LongTable 연구 handoff가 필요합니다.", {
      path: receiptPath,
    });
  }
  if (handoff.longtableVersion !== SUPPORTED_LONGTABLE_VERSION) {
    throw gateError("PP_LONGTABLE_VERSION_MISMATCH", "LongTable 버전이 고정 버전과 일치하지 않습니다.", {
      expected: SUPPORTED_LONGTABLE_VERSION,
      actual: handoff.longtableVersion,
    });
  }
  if (handoff.openRequiredCheckpoints.length > 0) {
    throw gateError("PP_RESEARCH_CHECKPOINT_OPEN", "미해결 필수 연구 checkpoint가 있습니다.", {
      actual: handoff.openRequiredCheckpoints,
    });
  }
  if (handoff.projectId !== project.projectId || handoff.proposalClass !== project.proposalClass) {
    throw gateError("PP_LONGTABLE_REQUIRED", "LongTable 연구 handoff가 현재 프로젝트와 일치하지 않습니다.", {
      expected: { projectId: project.projectId, proposalClass: project.proposalClass },
      actual: { projectId: handoff.projectId, proposalClass: handoff.proposalClass },
    });
  }

  const receiptFiles = new Map(await Promise.all(verification.receipt.files.map(async (file) => [
    await realpath(file.path).catch(() => resolve(file.path)),
    file.sha256,
  ] as const)));
  for (const [pathKey, hashKey] of ARTIFACT_BINDINGS) {
    const artifactPath = await resolveResearchArtifact(root, handoff[pathKey]);
    const actualSha256 = await sha256File(artifactPath).catch(() => undefined);
    const expectedSha256 = handoff[hashKey];
    if (
      actualSha256 !== expectedSha256
      || receiptFiles.get(artifactPath) !== expectedSha256
      || !verification.receipt.inputReceiptHashes.includes(expectedSha256)
    ) {
      throw gateError("KPP_INPUT_RECEIPT_INVALID", "연구 잠금 산출물의 해시 연결이 유효하지 않습니다.", {
        path: artifactPath,
        expected: expectedSha256,
        actual: actualSha256,
      });
    }
  }
  return sha256File(receiptPath);
}

async function lockedRequirementsHaveAcademicEvidence(root: string): Promise<boolean> {
  const path = join(root, "requirements", "requirements.json");
  const requirementsReceiptPath = join(root, "receipts", "requirements-lock.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw gateError("KPP_INPUT_REQUIREMENTS_INVALID", "잠긴 요구사항을 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
  let requirementsReceipt;
  try {
    requirementsReceipt = await verifyReceipt(requirementsReceiptPath);
  } catch (error) {
    if (error instanceof KppError && error.code === "KPP_INPUT_RECEIPT_READ") {
      return false;
    }
    throw withGateStage(error);
  }
  if (
    !requirementsReceipt.valid
    || requirementsReceipt.receipt.stage !== "REQUIREMENTS_LOCKED"
    || requirementsReceipt.receipt.result !== "PASS"
  ) {
    throw gateError("KPP_INPUT_RECEIPT_INVALID", "학술 근거 슬롯의 요구사항 잠금이 유효하지 않습니다.", {
      path: requirementsReceiptPath,
      actual: requirementsReceipt.mismatches,
    });
  }
  const requirementsRealPath = await realpath(path);
  const requirementsSha256 = await sha256File(requirementsRealPath);
  const boundRequirements = await Promise.all(requirementsReceipt.receipt.files.map(async (file) => ({
    path: await realpath(file.path).catch(() => undefined),
    sha256: file.sha256,
  })));
  if (!boundRequirements.some((file) =>
    file.path === requirementsRealPath && file.sha256 === requirementsSha256,
  )) {
    return false;
  }
  const parsed = ConfirmedRequirementsSchema.safeParse(value);
  if (!parsed.success) {
    throw gateError("KPP_INPUT_REQUIREMENTS_INVALID", "잠긴 요구사항 형식이 올바르지 않습니다.", {
      path,
      actual: parsed.error.issues,
    });
  }
  return parsed.data.evidenceBindings.some(({ targetPageRole }) =>
    /^academic(?:_|$)/u.test(targetPageRole),
  );
}

async function findBoundHandoff(paths: readonly string[]): Promise<ResearchLock | null> {
  const handoffs: ResearchLock[] = [];
  for (const path of paths) {
    try {
      const parsed = ResearchLockSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
      if (parsed.success) handoffs.push(parsed.data);
    } catch {
      // Non-JSON research artifacts are allowed; only a schema-valid handoff qualifies.
    }
  }
  return handoffs.length === 1 ? handoffs[0]! : null;
}

async function resolveResearchArtifact(root: string, projectRelativePath: string): Promise<string> {
  const normalized = normalize(projectRelativePath);
  if (
    isAbsolute(projectRelativePath)
    || normalized === "."
    || normalized.startsWith("..")
    || !normalized.startsWith("evidence/research-lock/")
  ) {
    throw gateError("KPP_INPUT_RECEIPT_INVALID", "연구 잠금 산출물 경로가 프로젝트 경계를 벗어납니다.", {
      path: projectRelativePath,
    });
  }
  const researchRoot = await realpath(join(root, "evidence", "research-lock")).catch(() => undefined);
  const artifactPath = await realpath(resolve(root, normalized)).catch(() => undefined);
  if (researchRoot === undefined || artifactPath === undefined) {
    throw gateError("KPP_INPUT_RECEIPT_INVALID", "연구 잠금 산출물을 읽을 수 없습니다.", {
      path: projectRelativePath,
    });
  }
  const local = relative(researchRoot, artifactPath);
  if (local === "" || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw gateError("KPP_INPUT_RECEIPT_INVALID", "연구 잠금 산출물 경로가 프로젝트 경계를 벗어납니다.", {
      path: projectRelativePath,
    });
  }
  return artifactPath;
}

function gateError(code: string, message: string, details: Record<string, unknown> = {}): KppError {
  return new KppError(code, message, { ...details, stage: GATE_STAGE });
}

function withGateStage(error: unknown): unknown {
  if (error instanceof KppError) {
    return new KppError(error.code, error.message, { ...error.details, stage: GATE_STAGE });
  }
  return error;
}
