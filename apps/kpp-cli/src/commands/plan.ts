import { join, resolve } from "node:path";
import {
  advanceProject,
  KppError,
  readProject,
  sha256File,
  writeReceipt,
} from "@kpp/core";
import {
  EvidenceLedgerSchema,
  PagePlanSchema,
  RequirementsFileSchema,
  type ConfirmedRequirements,
} from "@kpp/schemas";
import { success, type CliEnvelope } from "../output.js";
import { readJsonFile, writeJsonAtomically } from "./ingest.js";

export async function planCommand(
  rootInput: string,
  requirementsInput: string,
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  const requirementsPath = resolve(requirementsInput);
  const project = await readProject(root);
  if (project.state !== "SOURCE_LOCKED") {
    throw new KppError(
      "KPP_STATE_INVALID_TRANSITION",
      "계획은 SOURCE_LOCKED 상태에서만 만들 수 있습니다.",
      { stage: project.state, expected: "SOURCE_LOCKED", actual: project.state },
    );
  }

  const parsed = RequirementsFileSchema.safeParse(await readJsonFile(requirementsPath));
  if (!parsed.success) {
    throw new KppError("KPP_INPUT_REQUIREMENTS_INVALID", "요구사항 JSON 형식이 올바르지 않습니다.", {
      path: requirementsPath,
      actual: parsed.error.issues,
    });
  }
  if (parsed.data.confirmationStatus !== "confirmed") {
    throw new KppError(
      "KPP_INPUT_REQUIREMENTS_UNCONFIRMED",
      "파서 출력은 pending이며 사용자 확인 전에는 잠글 수 없습니다.",
      { path: requirementsPath, expected: "confirmed", actual: parsed.data.confirmationStatus },
    );
  }

  const requirements = normalizeRequirements(parsed.data);
  const persistedRequirementsPath = join(root, "requirements", "requirements.json");
  const pagePlanPath = join(root, "content", "page-plan.json");
  const evidenceLedgerPath = join(root, "evidence", "evidence-ledger.json");
  const sourceReceiptPath = join(root, "receipts", "source-lock.json");
  const requirementsReceiptPath = join(root, "receipts", "requirements-lock.json");
  const evidenceReceiptPath = join(root, "receipts", "evidence-lock.json");

  const pagePlan = PagePlanSchema.parse({
    schemaVersion: "1.0.0",
    pages: requirements.requirements.map((requirement, index) => ({
      pageId: `PAGE-${String(index + 1).padStart(3, "0")}`,
      requirementId: requirement.requirementId,
      pageRole: requirement.pageRole,
      surfaceTemplateId: requirement.surfaceTemplateId,
      claimIds: requirement.claims.map(({ claimId }) => claimId),
      figureSpecs: requirement.figureSpecs,
    })),
  });
  const ledger = EvidenceLedgerSchema.parse({
    schemaVersion: "1.0.0",
    claims: requirements.requirements.flatMap((requirement) =>
      requirement.claims.map((claim) => ({
        claimId: claim.claimId,
        status: claim.evidenceIds.length > 0
          ? "bounded"
          : claim.critical || requirement.critical
            ? "blocked"
            : "pending_blank",
        evidenceIds: claim.evidenceIds,
      })),
    ),
  });

  await writeJsonAtomically(persistedRequirementsPath, requirements);
  await writeJsonAtomically(pagePlanPath, pagePlan);
  await writeReceipt({
    stage: "REQUIREMENTS_LOCKED",
    files: [persistedRequirementsPath, pagePlanPath],
    inputReceiptHashes: [await sha256File(sourceReceiptPath)],
    output: requirementsReceiptPath,
  });
  await advanceProject(root, "REQUIREMENTS_LOCKED");

  await writeJsonAtomically(evidenceLedgerPath, ledger);
  await writeReceipt({
    stage: "EVIDENCE_LOCKED",
    files: [evidenceLedgerPath],
    inputReceiptHashes: [await sha256File(requirementsReceiptPath)],
    output: evidenceReceiptPath,
  });
  const advanced = await advanceProject(root, "EVIDENCE_LOCKED");

  return success("확인된 요구사항, 페이지 계획과 증거 원장을 잠갔습니다.", {
    state: advanced.state,
    requirementsPath: persistedRequirementsPath,
    pagePlanPath,
    evidenceLedgerPath,
  });
}

function normalizeRequirements(input: ConfirmedRequirements): ConfirmedRequirements {
  return {
    ...input,
    requirements: input.requirements
      .map((requirement) => ({
        ...requirement,
        claims: [...requirement.claims]
          .map((claim) => ({ ...claim, evidenceIds: [...claim.evidenceIds].sort() }))
          .sort((left, right) => compareIds(left.claimId, right.claimId)),
        figureSpecs: [...requirement.figureSpecs]
          .sort((left, right) => compareIds(left.figureId, right.figureId)),
      }))
      .sort((left, right) => compareIds(left.requirementId, right.requirementId)),
  };
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
