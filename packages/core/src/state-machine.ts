import { join } from "node:path";
import { ProjectStateSchema, type ProjectRecord, type ProjectState } from "@kpp/schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";
import { persistProjectState, readProject } from "./project-store.js";
import { verifyReceipt } from "./receipts.js";

export const PROJECT_STATES: readonly ProjectState[] = [
  "INIT",
  "SOURCE_LOCKED",
  "REQUIREMENTS_LOCKED",
  "EVIDENCE_LOCKED",
  "DESIGN_LOCKED",
  "CONTENT_APPROVED",
  "BUILT",
  "RENDERED",
  "AUDITED",
  "HUMAN_APPROVED",
  "RELEASED",
];

const RECEIPT_FILE_NAMES: Partial<Record<ProjectState, string>> = {
  SOURCE_LOCKED: "source-lock.json",
  REQUIREMENTS_LOCKED: "requirements-lock.json",
  EVIDENCE_LOCKED: "evidence-lock.json",
  DESIGN_LOCKED: "design-lock.json",
  CONTENT_APPROVED: "content-approval.json",
  BUILT: "build.json",
  RENDERED: "render.json",
  AUDITED: "audit.json",
  HUMAN_APPROVED: "approval.json",
  RELEASED: "release.json",
};

export function allowedNext(state: ProjectState): ProjectState[] {
  const index = PROJECT_STATES.indexOf(state);
  const next = PROJECT_STATES[index + 1];
  return next === undefined ? [] : [next];
}

export async function advanceProject(
  root: string,
  target: ProjectState,
): Promise<ProjectRecord> {
  const project = await readProject(root);
  if (project.state !== "INIT") {
    try {
      await verifyReceiptChain(root, project.state);
    } catch (error) {
      await invalidateAtEarliestAffectedStage(root, project, affectedStage(error));
      throw error;
    }
  }
  assertAdjacentTransition(project.state, target);

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
  if (project.state === "INIT") {
    return project;
  }
  try {
    await verifyReceiptChain(root, project.state);
    return project;
  } catch (error) {
    await invalidateAtEarliestAffectedStage(root, project, affectedStage(error));
    throw error;
  }
}

function assertAdjacentTransition(current: ProjectState, target: ProjectState): void {
  if (!ProjectStateSchema.safeParse(target).success || !allowedNext(current).includes(target)) {
    throw new KppError("KPP_STATE_INVALID_TRANSITION", "허용되지 않은 프로젝트 상태 전이입니다.", {
      actual: target,
      expected: allowedNext(current),
      stage: current,
    });
  }
}

async function verifyReceiptChain(root: string, target: ProjectState): Promise<void> {
  const targetIndex = PROJECT_STATES.indexOf(target);
  for (let index = 1; index <= targetIndex; index += 1) {
    const stage = PROJECT_STATES[index];
    if (stage === undefined) {
      continue;
    }
    const receipt = await verifyStageReceipt(root, stage);
    const predecessor = PROJECT_STATES[index - 1];
    if (predecessor !== "INIT") {
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
          path: receiptPath(root, stage),
          stage,
          expected: predecessorHash,
          actual: receipt.inputReceiptHashes,
        });
      }
    }
  }
}

async function verifyStageReceipt(root: string, stage: ProjectState) {
  const path = receiptPath(root, stage);
  let verification;
  try {
    verification = await verifyReceipt(path);
  } catch (error) {
    if (error instanceof KppError) {
      throw new KppError(error.code, error.message, { ...error.details, stage });
    }
    throw error;
  }

  if (!verification.valid) {
    throw new KppError("KPP_INPUT_RECEIPT_INVALID", "영수증에 연결된 입력이 변경되었습니다.", {
      path,
      stage,
      actual: verification.mismatches,
    });
  }
  if (verification.receipt.stage !== stage) {
    throw new KppError("KPP_INPUT_RECEIPT_STAGE", "영수증 단계가 상태 전이와 일치하지 않습니다.", {
      path,
      stage,
      expected: stage,
      actual: verification.receipt.stage,
    });
  }
  if (verification.receipt.result !== "PASS") {
    throw new KppError("KPP_STATE_RECEIPT_BLOCKED", "차단된 영수증으로는 상태를 전이할 수 없습니다.", {
      path,
      stage,
      actual: verification.receipt.result,
    });
  }
  return verification.receipt;
}

async function invalidateAtEarliestAffectedStage(
  root: string,
  project: ProjectRecord,
  stage: ProjectState | undefined,
): Promise<void> {
  if (stage === undefined) {
    return;
  }
  const stageIndex = PROJECT_STATES.indexOf(stage);
  const currentIndex = PROJECT_STATES.indexOf(project.state);
  if (stageIndex < 1 || stageIndex > currentIndex) {
    return;
  }
  const predecessor = PROJECT_STATES[stageIndex - 1];
  if (predecessor !== undefined && predecessor !== project.state) {
    await persistProjectState(root, { ...project, state: predecessor });
  }
}

function affectedStage(error: unknown): ProjectState | undefined {
  if (!(error instanceof KppError) || typeof error.details.stage !== "string") {
    return undefined;
  }
  const parsed = ProjectStateSchema.safeParse(error.details.stage);
  return parsed.success ? parsed.data : undefined;
}

function receiptPath(root: string, stage: ProjectState): string {
  const filename = RECEIPT_FILE_NAMES[stage];
  if (filename === undefined) {
    throw new KppError("KPP_STATE_INVALID_TRANSITION", "INIT에는 단계 영수증이 없습니다.", {
      stage,
    });
  }
  return join(root, "receipts", filename);
}
