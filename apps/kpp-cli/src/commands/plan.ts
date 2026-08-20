import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  advanceProject,
  getDocumentModePolicy,
  KppError,
  planFigure,
  sha256File,
  validatePageArchitecture,
  validateReferenceManifest,
  verifyProjectState,
  writeReceipt,
} from "@longtable/kpp-core";
import {
  ConfirmedRequirementsSchema,
  EvidenceLedgerSchema,
  PageArchitectureManifestSchema,
  PagePlanSchema,
  ReferenceManifestSchema,
  RequirementsFileSchema,
  type ConfirmedRequirements,
  type EvidenceBinding,
  type EvidenceLedger,
  type PageArchitectureManifest,
  type PagePlan,
  type ReferenceManifest,
} from "@longtable/kpp-schemas";
import { success, type CliEnvelope } from "../output.js";
import { readJsonFile, writeJsonAtomically } from "./ingest.js";

export async function planCommand(
  rootInput: string,
  requirementsInput: string,
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  const requirementsPath = resolve(requirementsInput);
  const project = await verifyProjectState(root);
  if (project.state !== "SOURCE_LOCKED" && project.state !== "REQUIREMENTS_LOCKED") {
    throw new KppError(
      "KPP_STATE_INVALID_TRANSITION",
      "계획은 SOURCE_LOCKED 또는 REQUIREMENTS_LOCKED 상태에서만 만들 수 있습니다.",
      {
        stage: project.state,
        expected: ["SOURCE_LOCKED", "REQUIREMENTS_LOCKED"],
        actual: project.state,
      },
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

  const requirements = normalizeRequirements(parsed.data, dirname(requirementsPath));
  const persistedRequirementsPath = join(root, "requirements", "requirements.json");
  const pagePlanPath = join(root, "content", "page-plan.json");
  const pageArchitecturePath = join(root, "content", "page-architecture.json");
  const evidenceLedgerPath = join(root, "evidence", "evidence-ledger.json");
  const referenceManifestPath = join(root, "evidence", "reference-manifest.json");
  const sourceReceiptPath = join(root, "receipts", "source-lock.json");
  const requirementsReceiptPath = join(root, "receipts", "requirements-lock.json");
  const evidenceReceiptPath = join(root, "receipts", "evidence-lock.json");

  const pagePlan = PagePlanSchema.parse({
    schemaVersion: "1.0.0",
    pages: requirements.requirements.map((requirement, index) => {
      const pageId = `PAGE-${String(index + 1).padStart(3, "0")}`;
      return {
        pageId,
        requirementId: requirement.requirementId,
        pageRole: requirement.pageRole,
        surfaceTemplateId: requirement.surfaceTemplateId,
        claimIds: requirement.claims.map(({ claimId }) => claimId),
        figureSpecs: requirement.figureSpecs.map((figure) => planFigure({
          ...figure,
          requirementId: requirement.requirementId,
          pageId,
          requestedFamily: figure.family,
        })),
        ...(requirement.sourceCandidateIds === undefined
          ? {}
          : { sourceCandidateIds: requirement.sourceCandidateIds }),
      };
    }),
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
    bindings: requirements.evidenceBindings,
  });

  await validateEvidenceBindings(requirements, pagePlan);
  if (project.schemaVersion !== "2.0.0") {
    throw new KppError("KPP_MIGRATION_REQUIRED", "문서 아키텍처 계획에는 v2 프로젝트가 필요합니다.", {
      expected: "2.0.0",
      actual: project.schemaVersion,
    });
  }
  const policy = getDocumentModePolicy(project.documentMode);
  const pageArchitecture = createPageArchitecture(project, pagePlan, ledger);
  const referenceManifest = createReferenceManifest(project, pagePlan, ledger);
  const architectureValidation = validatePageArchitecture(pageArchitecture, pagePlan, policy);
  const referenceValidation = validateReferenceManifest(referenceManifest, pageArchitecture, ledger);
  if (architectureValidation.status !== "PASS" || referenceValidation.status !== "PASS") {
    throw new KppError("KPP_PLAN_MANIFEST_INVALID", "페이지 아키텍처 또는 참조 원장이 모드 정책을 충족하지 않습니다.", {
      actual: [...architectureValidation.findings, ...referenceValidation.findings],
    });
  }

  if (project.state === "SOURCE_LOCKED") {
    await writeJsonAtomically(persistedRequirementsPath, requirements);
    await writeJsonAtomically(pagePlanPath, pagePlan);
    await writeJsonAtomically(pageArchitecturePath, pageArchitecture);
    await writeReceipt({
      stage: "REQUIREMENTS_LOCKED",
      files: [persistedRequirementsPath, pagePlanPath, pageArchitecturePath],
      inputReceiptHashes: [await sha256File(sourceReceiptPath)],
      output: requirementsReceiptPath,
    });
    await advanceProject(root, "REQUIREMENTS_LOCKED");
  } else {
    await assertRequirementsLockedRecovery(
      persistedRequirementsPath,
      pagePlanPath,
      pageArchitecturePath,
      requirements,
      pagePlan,
      pageArchitecture,
    );
  }

  await writeJsonAtomically(evidenceLedgerPath, ledger);
  await writeJsonAtomically(referenceManifestPath, referenceManifest);
  await writeReceipt({
    stage: "EVIDENCE_LOCKED",
    files: [
      evidenceLedgerPath,
      pagePlanPath,
      pageArchitecturePath,
      referenceManifestPath,
      ...new Set(requirements.evidenceBindings.map(({ sourcePath }) => sourcePath)),
    ],
    inputReceiptHashes: [await sha256File(requirementsReceiptPath)],
    output: evidenceReceiptPath,
  });
  const advanced = await advanceProject(root, "EVIDENCE_LOCKED");

  return success("확인된 요구사항, 페이지 계획과 증거 원장을 잠갔습니다.", {
    state: advanced.state,
    requirementsPath: persistedRequirementsPath,
    pagePlanPath,
    pageArchitecturePath,
    evidenceLedgerPath,
    referenceManifestPath,
  });
}

function createPageArchitecture(
  project: { readonly projectId: string; readonly documentMode: PageArchitectureManifest["documentMode"]; readonly modePolicyVersion: string },
  pagePlan: PagePlan,
  ledger: EvidenceLedger,
): PageArchitectureManifest {
  const chapterId = "CHAPTER-001";
  const bindingsByPage = new Map<string, string[]>();
  for (const binding of ledger.bindings) {
    const pageBindings = bindingsByPage.get(binding.targetPageId) ?? [];
    if (!pageBindings.includes(binding.evidenceId)) pageBindings.push(binding.evidenceId);
    bindingsByPage.set(binding.targetPageId, pageBindings);
  }
  return PageArchitectureManifestSchema.parse({
    schemaVersion: "2.0.0",
    projectId: project.projectId,
    documentMode: project.documentMode,
    modePolicyVersion: project.modePolicyVersion,
    chapters: [{ chapterId, order: 0 }],
    sections: pagePlan.pages.map((page, index) => ({
      sectionId: `SECTION-${String(index + 1).padStart(3, "0")}`,
      chapterId,
      order: index,
    })),
    pages: pagePlan.pages.map((page, index) => ({
      pageId: page.pageId,
      chapterId,
      sectionId: `SECTION-${String(index + 1).padStart(3, "0")}`,
      pageRole: page.pageRole,
      surfaceTemplateId: page.surfaceTemplateId,
      titleScope: index === 0 ? "chapter" : "section",
      continuation: false,
      dominantSurface: page.figureSpecs.length > 0 && page.claimIds.length > 0
        ? "mixed"
        : page.figureSpecs.length > 0 ? "figure" : "narrative",
      surfaceVisibility: "internal",
      claimIds: page.claimIds,
      proofIds: unique(page.figureSpecs.flatMap(({ evidenceIds }) => evidenceIds)),
      referenceIds: bindingsByPage.get(page.pageId) ?? [],
      figureIds: page.figureSpecs.map(({ figureId }) => figureId),
    })),
  });
}

function createReferenceManifest(
  project: { readonly projectId: string; readonly documentMode: ReferenceManifest["documentMode"]; readonly modePolicyVersion: string },
  pagePlan: PagePlan,
  ledger: EvidenceLedger,
): ReferenceManifest {
  const pageById = new Map(pagePlan.pages.map((page) => [page.pageId, page]));
  return ReferenceManifestSchema.parse({
    schemaVersion: "2.0.0",
    projectId: project.projectId,
    documentMode: project.documentMode,
    modePolicyVersion: project.modePolicyVersion,
    references: ledger.bindings.map((binding) => {
      const page = pageById.get(binding.targetPageId);
      const targets = [
        ...binding.claimIds.map((id) => ({ kind: "claim" as const, id })),
        { kind: "page" as const, id: binding.targetPageId },
        ...(page?.figureSpecs
          .filter(({ evidenceIds }) => evidenceIds.includes(binding.evidenceId))
          .map(({ figureId: id }) => ({ kind: "figure" as const, id })) ?? []),
      ];
      return {
        referenceId: binding.evidenceId,
        referenceClass: "evidence",
        sourcePath: binding.sourcePath,
        sourceSha256: binding.sourceSha256,
        locator: binding.scope,
        targets: targets.filter((target, index) =>
          targets.findIndex((candidate) => candidate.kind === target.kind && candidate.id === target.id) === index),
        verificationStatus: "verified",
        availability: "available",
      };
    }),
  });
}

function unique(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function normalizeRequirements(
  input: ConfirmedRequirements,
  inputDirectory: string,
): ConfirmedRequirements {
  return {
    ...input,
    evidenceBindings: input.evidenceBindings
      .map((binding) => ({
        ...binding,
        sourcePath: /^[a-z][a-z0-9+.-]*:/i.test(binding.sourcePath)
          ? binding.sourcePath
          : resolve(inputDirectory, binding.sourcePath),
        claimIds: [...binding.claimIds],
      })),
    requirements: input.requirements
      .map((requirement) => ({
        ...requirement,
        claims: requirement.claims
          .map((claim) => ({ ...claim, evidenceIds: [...claim.evidenceIds] })),
        figureSpecs: [...requirement.figureSpecs],
      })),
  };
}

async function validateEvidenceBindings(
  requirements: ConfirmedRequirements,
  pagePlan: PagePlan,
): Promise<void> {
  const bindingById = new Map(
    requirements.evidenceBindings.map((binding) => [binding.evidenceId, binding]),
  );
  const pageByRequirement = new Map(
    pagePlan.pages.map((page) => [page.requirementId, page]),
  );
  const claimTargets = new Map(
    requirements.requirements.flatMap((requirement) => {
      const page = pageByRequirement.get(requirement.requirementId)!;
      return requirement.claims.map((claim) => [claim.claimId, { claim, requirement, page }] as const);
    }),
  );

  for (const binding of requirements.evidenceBindings) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(binding.sourcePath)) {
      throw unresolvedEvidence(binding, "unsupported_source_uri", "readable local file");
    }
    try {
      const metadata = await stat(binding.sourcePath);
      if (!metadata.isFile()) {
        throw new Error("source is not a file");
      }
      const actualSha256 = await sha256File(binding.sourcePath);
      if (actualSha256 !== binding.sourceSha256) {
        throw unresolvedEvidence(binding, "source_sha256_mismatch", binding.sourceSha256, actualSha256);
      }
    } catch (error) {
      if (error instanceof KppError) {
        throw error;
      }
      throw unresolvedEvidence(
        binding,
        "source_unreadable",
        "readable local file",
        error instanceof Error ? error.message : error,
      );
    }

    for (const claimId of binding.claimIds) {
      const target = claimTargets.get(claimId);
      if (target === undefined || !target.claim.evidenceIds.includes(binding.evidenceId)) {
        throw unresolvedEvidence(binding, "binding_claim_mismatch", claimId);
      }
      if (
        binding.targetRequirementId !== target.requirement.requirementId
        || binding.targetPageId !== target.page.pageId
        || binding.targetPageRole !== target.page.pageRole
      ) {
        throw unresolvedEvidence(binding, "binding_target_mismatch", {
          targetRequirementId: target.requirement.requirementId,
          targetPageId: target.page.pageId,
          targetPageRole: target.page.pageRole,
        }, {
          targetRequirementId: binding.targetRequirementId,
          targetPageId: binding.targetPageId,
          targetPageRole: binding.targetPageRole,
        });
      }
    }
  }

  for (const [claimId, target] of claimTargets) {
    for (const evidenceId of target.claim.evidenceIds) {
      const binding = bindingById.get(evidenceId);
      if (binding === undefined || !binding.claimIds.includes(claimId)) {
        throw new KppError(
          "KPP_INPUT_EVIDENCE_UNRESOLVED",
          "증거 ID를 실제 출처와 계획 페이지에 연결할 수 없습니다.",
          { rule: "claim_binding_missing", expected: claimId, actual: evidenceId },
        );
      }
    }
  }

  for (const page of pagePlan.pages) {
    const requirement = requirements.requirements.find(({ requirementId }) =>
      requirementId === page.requirementId)!;
    const requirementClaimIds = new Set(requirement.claims.map(({ claimId }) => claimId));
    for (const figure of page.figureSpecs) {
      if (figure.requirementId !== requirement.requirementId || figure.pageId !== page.pageId) {
        throw unresolvedFigureEvidence(figure.figureId, "figure_page_requirement_mismatch", {
          requirementId: requirement.requirementId,
          pageId: page.pageId,
        });
      }
      for (const claimId of figure.claimIds) {
        if (!requirementClaimIds.has(claimId)) {
          throw unresolvedFigureEvidence(figure.figureId, "figure_claim_unknown", claimId);
        }
      }
      for (const evidenceId of figure.evidenceIds) {
        const binding = bindingById.get(evidenceId);
        if (binding === undefined
          || binding.targetRequirementId !== requirement.requirementId
          || binding.targetPageId !== page.pageId
          || !binding.claimIds.some((claimId) => figure.claimIds.includes(claimId))) {
          throw unresolvedFigureEvidence(figure.figureId, "figure_evidence_binding_missing", {
            evidenceId,
            expected: {
              requirementId: requirement.requirementId,
              pageId: page.pageId,
              claimIds: figure.claimIds,
            },
          });
        }
      }
    }
  }
}

function unresolvedEvidence(
  binding: EvidenceBinding,
  rule: string,
  expected: unknown,
  actual: unknown = binding.sourcePath,
): KppError {
  return new KppError(
    "KPP_INPUT_EVIDENCE_UNRESOLVED",
    "증거 ID를 실제 출처와 계획 페이지에 연결할 수 없습니다.",
    { path: binding.sourcePath, rule, expected, actual },
  );
}

function unresolvedFigureEvidence(
  figureId: string,
  rule: string,
  actual: unknown,
): KppError {
  return new KppError(
    "KPP_EVIDENCE_FIGURE_UNBOUND",
    "도식은 잠긴 주장·증거·페이지에 연결되어야 합니다.",
    { path: figureId, rule, actual },
  );
}

async function assertRequirementsLockedRecovery(
  persistedRequirementsPath: string,
  pagePlanPath: string,
  pageArchitecturePath: string,
  requirements: ConfirmedRequirements,
  pagePlan: PagePlan,
  pageArchitecture: PageArchitectureManifest,
): Promise<void> {
  let persistedRequirements: unknown;
  try {
    persistedRequirements = ConfirmedRequirementsSchema.parse(
      await readJsonFile(persistedRequirementsPath),
    );
  } catch (error) {
    throw new KppError(
      "KPP_INPUT_REQUIREMENTS_RECOVERY_MISMATCH",
      "잠긴 요구사항 산출물이 재시도 입력과 일치하지 않습니다.",
      {
        rule: "locked_artifact_invalid",
        actual: error instanceof Error ? error.message : error,
      },
    );
  }
  if (JSON.stringify(persistedRequirements) !== JSON.stringify(requirements)) {
    throw new KppError(
      "KPP_INPUT_REQUIREMENTS_RECOVERY_MISMATCH",
      "잠긴 요구사항 산출물이 재시도 입력과 일치하지 않습니다.",
      {
        rule: "locked_input_changed",
        expected: [persistedRequirementsPath, pagePlanPath],
        actual: "retry input differs from locked artifacts",
      },
    );
  }

  let pagePlanWasMissing = false;
  try {
    await stat(pagePlanPath);
  } catch (error) {
    if (isMissingFile(error)) {
      await writeJsonAtomically(pagePlanPath, pagePlan);
      pagePlanWasMissing = true;
    } else {
      throw recoveryMismatch("locked_page_plan_unreadable", error);
    }
  }

  if (!pagePlanWasMissing) {
    let persistedPagePlan: PagePlan;
    try {
      persistedPagePlan = PagePlanSchema.parse(await readJsonFile(pagePlanPath));
    } catch (error) {
      throw recoveryMismatch("locked_page_plan_invalid", error);
    }
    if (JSON.stringify(persistedPagePlan) !== JSON.stringify(pagePlan)) {
      throw recoveryMismatch("locked_input_changed", "retry input differs from locked artifacts");
    }
  }
  try {
    await stat(pageArchitecturePath);
  } catch (error) {
    if (isMissingFile(error)) {
      await writeJsonAtomically(pageArchitecturePath, pageArchitecture);
      return;
    }
    throw recoveryMismatch("locked_page_architecture_unreadable", error);
  }
  let persistedArchitecture: PageArchitectureManifest;
  try {
    persistedArchitecture = PageArchitectureManifestSchema.parse(await readJsonFile(pageArchitecturePath));
  } catch (error) {
    throw recoveryMismatch("locked_page_architecture_invalid", error);
  }
  if (JSON.stringify(persistedArchitecture) !== JSON.stringify(pageArchitecture)) {
    throw recoveryMismatch("locked_input_changed", "retry architecture differs from locked artifacts");
  }
}

function recoveryMismatch(rule: string, actual: unknown): KppError {
  return new KppError(
    "KPP_INPUT_REQUIREMENTS_RECOVERY_MISMATCH",
    "잠긴 요구사항 산출물이 재시도 입력과 일치하지 않습니다.",
    { rule, actual },
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}
