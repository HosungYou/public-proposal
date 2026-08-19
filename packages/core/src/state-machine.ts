import { join } from "node:path";
import { ProjectStateSchema, type ProjectRecord, type ProjectState, type Receipt } from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";
import { persistProjectState, readProject } from "./project-store.js";
import { getResearchLockReceiptHash } from "./research-requirement.js";
import { RECEIPT_FILE_NAMES, verifyReceipt } from "./receipts.js";

/**
 * This is an inventory of persisted literals, not a transition index. The
 * legacy EVIDENCE_LOCKED and vNext RESEARCH_LOCKED branches meet at DESIGN.
 */
export const PROJECT_STATES: readonly ProjectState[] = [
  "UNMANAGED_DRAFT",
  "INIT", "SOURCE_LOCKED", "REQUIREMENTS_LOCKED", "BRIEF_LOCKED", "RESEARCH_LOCKED",
  "EVIDENCE_LOCKED", "DESIGN_LOCKED", "REPRESENTATIVE_REVIEW_REQUIRED",
  "REPRESENTATIVE_APPROVED", "CONTENT_APPROVED", "BUILT", "RENDERED", "AUDITED",
  "HUMAN_APPROVED", "RELEASED",
];

const STATIC_PREDECESSORS: Readonly<Partial<Record<ProjectState, ProjectState>>> = {
  SOURCE_LOCKED: "INIT",
  REQUIREMENTS_LOCKED: "SOURCE_LOCKED",
  BRIEF_LOCKED: "REQUIREMENTS_LOCKED",
  RESEARCH_LOCKED: "BRIEF_LOCKED",
  EVIDENCE_LOCKED: "REQUIREMENTS_LOCKED",
  REPRESENTATIVE_REVIEW_REQUIRED: "DESIGN_LOCKED",
  REPRESENTATIVE_APPROVED: "REPRESENTATIVE_REVIEW_REQUIRED",
  BUILT: "CONTENT_APPROVED",
  RENDERED: "BUILT",
  AUDITED: "RENDERED",
  HUMAN_APPROVED: "AUDITED",
  RELEASED: "HUMAN_APPROVED",
};

/** Maps an immutable legacy receipt stage to its vNext semantic equivalent. */
export function adaptLegacyEvidenceLockedState(state: ProjectState): ProjectState {
  return state === "EVIDENCE_LOCKED" ? "RESEARCH_LOCKED" : state;
}

export function allowedNext(state: ProjectState): ProjectState[] {
  switch (state) {
    case "UNMANAGED_DRAFT": return [];
    case "INIT": return ["SOURCE_LOCKED"];
    case "SOURCE_LOCKED": return ["REQUIREMENTS_LOCKED"];
    case "REQUIREMENTS_LOCKED": return ["BRIEF_LOCKED", "EVIDENCE_LOCKED"];
    case "BRIEF_LOCKED": return ["RESEARCH_LOCKED", "DESIGN_LOCKED"];
    case "RESEARCH_LOCKED":
    case "EVIDENCE_LOCKED": return ["DESIGN_LOCKED"];
    case "DESIGN_LOCKED": return ["REPRESENTATIVE_REVIEW_REQUIRED"];
    case "REPRESENTATIVE_REVIEW_REQUIRED": return ["REPRESENTATIVE_APPROVED"];
    case "REPRESENTATIVE_APPROVED": return ["CONTENT_APPROVED"];
    case "CONTENT_APPROVED": return ["BUILT"];
    case "BUILT": return ["RENDERED"];
    case "RENDERED": return ["AUDITED"];
    case "AUDITED": return ["HUMAN_APPROVED"];
    case "HUMAN_APPROVED": return ["RELEASED"];
    case "RELEASED": return [];
  }
}

export async function advanceProject(root: string, target: ProjectState): Promise<ProjectRecord> {
  const project = await readProject(root);
  if (project.state !== "INIT") {
    try {
      await verifyReceiptChain(root, project.state);
    } catch (error) {
      await invalidateAtEarliestAffectedStage(root, project, affectedStage(error));
      throw error;
    }
  }
  await assertAllowedTransition(root, project.state, target);
  try {
    await verifyReceiptChain(root, target);
  } catch (error) {
    await invalidateAtEarliestAffectedStage(root, project, affectedStage(error));
    throw error;
  }
  return persistProjectState(root, { ...project, state: target });
}

export async function verifyProjectState(root: string): Promise<ProjectRecord> {
  const project = await readProject(root);
  if (project.state === "INIT" || project.state === "UNMANAGED_DRAFT") return project;
  try {
    await verifyReceiptChain(root, project.state);
    return project;
  } catch (error) {
    await invalidateAtEarliestAffectedStage(root, project, affectedStage(error));
    throw error;
  }
}

async function assertAllowedTransition(root: string, current: ProjectState, target: ProjectState): Promise<void> {
  const legacyContentTransition = current === "DESIGN_LOCKED"
    && target === "CONTENT_APPROVED"
    && await isLegacyDesignPath(root);
  if (!ProjectStateSchema.safeParse(target).success || (!legacyContentTransition && !allowedNext(current).includes(target))) {
    throw new KppError("KPP_STATE_INVALID_TRANSITION", "허용되지 않은 프로젝트 상태 전이입니다.", {
      actual: target,
      expected: legacyContentTransition ? ["CONTENT_APPROVED"] : allowedNext(current),
      stage: current,
    });
  }
}

async function verifyReceiptChain(root: string, target: ProjectState): Promise<void> {
  await verifyStageAndPredecessors(root, target, new Set<ProjectState>());
}

async function verifyStageAndPredecessors(root: string, stage: ProjectState, visited: Set<ProjectState>): Promise<void> {
  if (stage === "INIT" || visited.has(stage)) return;
  visited.add(stage);
  const receipt = await verifyStageReceipt(root, stage);
  const predecessor = await resolvePredecessor(root, stage, receipt);
  if (predecessor === "INIT") return;
  await verifyStageAndPredecessors(root, predecessor, visited);
  const predecessorPath = receiptPath(root, predecessor);
  let predecessorHash: string;
  try {
    predecessorHash = await sha256File(predecessorPath);
  } catch (error) {
    throw new KppError("KPP_INPUT_RECEIPT_READ", "입력 영수증 파일을 읽을 수 없습니다.", {
      path: predecessorPath,
      stage,
      actual: error instanceof Error ? error.message : error,
    });
  }
  if (!receipt.inputReceiptHashes.includes(predecessorHash)) {
    throw new KppError("KPP_INPUT_RECEIPT_MISSING", "선행 영수증 해시가 누락되었습니다.", {
      path: receiptPath(root, stage), stage, expected: predecessorHash, actual: receipt.inputReceiptHashes,
    });
  }
  if (stage === "CONTENT_APPROVED" && predecessor === "DESIGN_LOCKED") {
    await verifyLegacyResearchInput(root, receipt, stage);
  }
}

async function resolvePredecessor(root: string, stage: ProjectState, receipt: Receipt): Promise<ProjectState> {
  if (stage === "DESIGN_LOCKED") {
    return resolveOneOfPredecessors(root, stage, receipt, ["RESEARCH_LOCKED", "BRIEF_LOCKED", "EVIDENCE_LOCKED"]);
  }
  if (stage === "CONTENT_APPROVED") {
    return resolveOneOfPredecessors(root, stage, receipt, ["REPRESENTATIVE_APPROVED", "DESIGN_LOCKED"]);
  }
  return STATIC_PREDECESSORS[stage] ?? "INIT";
}

async function resolveOneOfPredecessors(
  root: string,
  stage: ProjectState,
  receipt: Receipt,
  candidates: readonly ProjectState[],
): Promise<ProjectState> {
  const matches: ProjectState[] = [];
  for (const candidate of candidates) {
    const hash = await sha256File(receiptPath(root, candidate)).catch(() => undefined);
    if (hash !== undefined && receipt.inputReceiptHashes.includes(hash)) matches.push(candidate);
  }
  if (matches.length === 1) return matches[0]!;
  throw new KppError("KPP_INPUT_RECEIPT_MISSING", "단계 영수증에 정확히 하나의 선행 영수증 해시가 필요합니다.", {
    path: receiptPath(root, stage), stage, expected: candidates, actual: receipt.inputReceiptHashes,
  });
}

async function verifyLegacyResearchInput(root: string, receipt: Receipt, stage: ProjectState): Promise<void> {
  const researchReceiptHash = await getResearchLockReceiptHash(root);
  if (researchReceiptHash !== null && !receipt.inputReceiptHashes.includes(researchReceiptHash)) {
    throw new KppError("KPP_INPUT_RECEIPT_MISSING", "콘텐츠 승인 영수증에 연구 잠금 해시가 누락되었습니다.", {
      path: receiptPath(root, stage), stage, expected: researchReceiptHash, actual: receipt.inputReceiptHashes,
    });
  }
}

async function isLegacyDesignPath(root: string): Promise<boolean> {
  const verification = await verifyReceipt(receiptPath(root, "DESIGN_LOCKED"));
  if (!verification.valid || verification.receipt.stage !== "DESIGN_LOCKED") return false;
  const evidenceHash = await sha256File(receiptPath(root, "EVIDENCE_LOCKED")).catch(() => undefined);
  return evidenceHash !== undefined && verification.receipt.inputReceiptHashes.includes(evidenceHash);
}

async function verifyStageReceipt(root: string, stage: ProjectState): Promise<Receipt> {
  const path = receiptPath(root, stage);
  let verification;
  try {
    verification = await verifyReceipt(path);
  } catch (error) {
    if (error instanceof KppError) throw new KppError(error.code, error.message, { ...error.details, stage });
    throw error;
  }
  if (!verification.valid) {
    throw new KppError("KPP_INPUT_RECEIPT_INVALID", "영수증에 연결된 입력이 변경되었습니다.", { path, stage, actual: verification.mismatches });
  }
  if (verification.receipt.stage !== stage) {
    throw new KppError("KPP_INPUT_RECEIPT_STAGE", "영수증 단계가 상태 전이와 일치하지 않습니다.", {
      path, stage, expected: stage, actual: verification.receipt.stage,
    });
  }
  if (verification.receipt.result !== "PASS") {
    throw new KppError("KPP_STATE_RECEIPT_BLOCKED", "차단된 영수증으로는 상태를 전이할 수 없습니다.", {
      path, stage, actual: verification.receipt.result,
    });
  }
  return verification.receipt;
}

async function invalidateAtEarliestAffectedStage(
  root: string,
  project: ProjectRecord,
  stage: ProjectState | undefined,
): Promise<void> {
  if (stage === undefined) return;
  const stageIndex = PROJECT_STATES.indexOf(stage);
  const currentIndex = PROJECT_STATES.indexOf(project.state);
  if (stageIndex < 1 || stageIndex > currentIndex) return;
  const predecessor = await predecessorForInvalidation(root, stage);
  if (predecessor !== project.state) await persistProjectState(root, { ...project, state: predecessor });
}

async function predecessorForInvalidation(root: string, stage: ProjectState): Promise<ProjectState> {
  if (stage === "DESIGN_LOCKED" || stage === "CONTENT_APPROVED") {
    const verification = await verifyReceipt(receiptPath(root, stage)).catch(() => undefined);
    if (verification !== undefined) return resolvePredecessor(root, stage, verification.receipt).catch(() => STATIC_PREDECESSORS[stage] ?? "INIT");
  }
  return STATIC_PREDECESSORS[stage] ?? "INIT";
}

function affectedStage(error: unknown): ProjectState | undefined {
  if (!(error instanceof KppError) || typeof error.details.stage !== "string") return undefined;
  const parsed = ProjectStateSchema.safeParse(error.details.stage);
  return parsed.success ? parsed.data : undefined;
}

function receiptPath(root: string, stage: ProjectState): string {
  const filename = RECEIPT_FILE_NAMES[stage];
  if (filename === undefined) throw new KppError("KPP_STATE_INVALID_TRANSITION", "INIT에는 단계 영수증이 없습니다.", { stage });
  return join(root, "receipts", filename);
}
