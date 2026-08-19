import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  EvidenceDataBundleV1Schema,
  ProposalResearchHandoffV1Schema,
  ProposalResearchRequestV1Schema,
  sha256Canonical,
  type EvidenceDataBundleV1,
  type ProposalResearchRequestV1,
} from "@longtable/proposal-research-contracts";
import {
  ConfirmedRequirementsSchema,
  ResearchLockSchema,
  type ConfirmedRequirements,
  type ProposalClass,
} from "@longtable/kpp-schemas";
import {
  KppError,
  importResearchLock,
  readProject,
  requiresResearchLock,
  sha256File,
  verifyReceipt,
} from "@longtable/kpp-core";

const LONGTABLE_VERSION = "0.1.72";
const REQUEST_FILE_NAME = "request.json";
const DEFAULT_SOURCE_PRIORITY = [
  "user_provided",
  "institution_official",
  "alio",
  "data_go_kr",
  "kosis",
  "government_policy",
  "government_report",
  "scholarly_fulltext",
  "web_discovery",
] as const;
const OFFICIAL_SOURCE_CLASSES = new Set([
  "user_provided",
  "institution_official",
  "official",
  "alio",
  "data_go_kr",
  "kosis",
  "government_policy",
  "government_report",
]);
const INSTITUTION_SOURCE_CLASSES = new Set(["institution_official", "alio"]);
const REQUIRED_BUNDLE_PATHS = [
  "source-manifest.jsonl",
  "handoff.json",
] as const;
const REQUIRED_BUNDLE_PREFIXES = [
  "raw/",
  "normalized/",
  "transformations/",
  "claims/",
  "figures/",
  "gaps/",
] as const;

type SourceClass = ProposalResearchRequestV1["sourcePriority"][number];
type TargetArtifact = ProposalResearchRequestV1["targetArtifacts"][number];
type Institution = ProposalResearchRequestV1["institution"];
type ResearchQuestion = ProposalResearchRequestV1["questions"][number];
type RequiredDataField = ProposalResearchRequestV1["requiredData"][number];

export interface ResearchRequestOptions {
  readonly requestId?: string;
  readonly academicEvidence?: boolean;
  readonly institution: {
    readonly canonicalName: string;
    readonly aliases: readonly string[];
    readonly identifiers: Readonly<Record<string, string>>;
  };
  readonly questions: readonly {
    readonly questionId: string;
    readonly text: string;
    readonly requiredDataFieldIds: readonly string[];
  }[];
  readonly requiredData: readonly {
    readonly fieldId: string;
    readonly definition: string;
    readonly period: string;
    readonly unit: string;
    readonly grain: string;
    readonly required: boolean;
    readonly allowedSourceClasses: readonly SourceClass[];
    readonly targetClaimIds?: readonly string[];
    readonly targetFigureIds?: readonly string[];
  }[];
  readonly sourcePriority?: readonly SourceClass[];
  readonly targetArtifacts?: readonly TargetArtifact[];
  readonly privacyClass?: ProposalResearchRequestV1["privacyClass"];
}

export interface ResearchRouteInput {
  readonly proposalClass: ProposalClass;
  readonly academicEvidence: boolean;
  readonly routingDecision?: ProposalResearchRequestV1["routingDecision"];
}

export interface ResearchRouteResult {
  readonly invocations: readonly "longtable"[];
}

export interface EvidenceBundleImportResult {
  readonly state: "SUCCEEDED";
  readonly bundleHash: string;
  readonly researchReceiptHash: string;
  readonly receiptPath: string;
  readonly bundlePath: string;
  readonly legacy: boolean;
}

interface VerifiedBundleFile {
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly sha256: string;
}

export async function createResearchRequest(
  rootInput: string,
  options: ResearchRequestOptions,
): Promise<ProposalResearchRequestV1> {
  const root = resolve(rootInput);
  const project = await readProject(root);
  const { requirements, receiptSha256: requirementsLockSha256 } = await readLockedRequirements(root);
  validateRequestOptions(requirements, options);
  const requirementIds = requirements.requirements.map(({ requirementId }) => requirementId);
  const targetArtifacts = options.targetArtifacts === undefined
    ? deriveTargetArtifacts(project.proposalClass, requirements, options.requiredData)
    : [...options.targetArtifacts];
  const requestSeed = {
    schemaVersion: "proposal-research-request/v1" as const,
    projectId: project.projectId,
    proposalClass: project.proposalClass,
    requirementIds,
    institution: normalizeInstitution(options.institution),
    questions: options.questions.map(normalizeQuestion),
    requiredData: options.requiredData.map(normalizeRequiredDataField),
    sourcePriority: [...(options.sourcePriority ?? DEFAULT_SOURCE_PRIORITY)],
    targetArtifacts,
    budgets: { fullPass: 1 as const, deltaPasses: 2 as const },
    privacyClass: options.privacyClass ?? "PUBLIC" as const,
    requirementsLockSha256,
    routingDecision: requiresResearchLock(project.proposalClass, options.academicEvidence === true)
      ? "required" as const
      : "prohibited" as const,
  };
  const canonicalId = canonicalRequestId(requestSeed);
  if (options.requestId !== undefined && options.requestId !== canonicalId) {
    invalidRequest("request_id_not_canonical", options.requestId);
  }
  const requestId = canonicalId;
  const parsed = ProposalResearchRequestV1Schema.safeParse({ requestId, ...requestSeed });
  if (!parsed.success) {
    throw new KppError("PP_RESEARCH_REQUEST_INVALID", "연구 요청 형식이 올바르지 않습니다.", {
      actual: parsed.error.issues,
    });
  }
  const requestPath = researchRequestPath(root);
  await writeStableFile(requestPath, `${JSON.stringify(parsed.data, null, 2)}\n`, "PP_RESEARCH_REQUEST_INVALID");
  return parsed.data;
}

export async function routeResearch(input: ResearchRouteInput): Promise<ResearchRouteResult> {
  return {
    invocations: (input.routingDecision === undefined
      ? requiresResearchLock(input.proposalClass, input.academicEvidence)
      : input.routingDecision === "required")
      ? ["longtable"]
      : [],
  };
}

export async function importEvidenceBundle(
  rootInput: string,
  bundlePathInput: string,
): Promise<EvidenceBundleImportResult> {
  const root = resolve(rootInput);
  const bundlePath = resolve(bundlePathInput);
  const raw = await readJson(bundlePath, "PP_RESEARCH_BUNDLE_INVALID", "연구 bundle JSON을 읽을 수 없습니다.");
  const legacy = ResearchLockSchema.safeParse(raw);
  if (legacy.success) {
    const imported = await importResearchLock(root, bundlePath, LONGTABLE_VERSION);
    const bundleHash = await sha256File(bundlePath);
    return {
      state: "SUCCEEDED",
      bundleHash,
      researchReceiptHash: await sha256File(imported.receiptPath),
      receiptPath: imported.receiptPath,
      bundlePath,
      legacy: true,
    };
  }

  const parsed = EvidenceDataBundleV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 형식이 올바르지 않습니다.", {
      path: bundlePath,
      actual: parsed.error.issues,
    });
  }
  const bundle = parsed.data;
  const restrictedFile = bundle.files.find(({ classification }) =>
    classification === "SECRET" || classification === "RESTRICTED_PROOF",
  );
  if (restrictedFile !== undefined) {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "제한 등급 파일은 연구 bundle에 포함할 수 없습니다.", {
      path: restrictedFile.path,
      actual: { classification: restrictedFile.classification },
    });
  }
  if (bundle.status !== "complete") {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "완료되지 않은 연구 bundle은 KPP 입력으로 가져올 수 없습니다.", {
      path: bundlePath,
      expected: "complete/SUCCEEDED",
      actual: bundle.status,
    });
  }
  const request = await readBoundResearchRequest(root, bundle.requestId);
  const project = await readProject(root);
  if (request.projectId !== project.projectId || request.proposalClass !== project.proposalClass) {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 요청이 현재 프로젝트와 일치하지 않습니다.", {
      expected: { projectId: project.projectId, proposalClass: project.proposalClass },
      actual: { projectId: request.projectId, proposalClass: request.proposalClass },
    });
  }
  validateBundleLineage(bundle, request);
  const verifiedFiles = await verifyBundleFiles(bundlePath, bundle);
  await verifySucceededHandoff(verifiedFiles, bundle);

  const bundleHash = await sha256File(bundlePath);
  const installed = await installBundle(root, bundlePath, bundle, verifiedFiles);
  const compatibility = await writeCompatibilityHandoff(root, request, bundle, bundleHash);
  const additionalArtifacts = [
    { path: projectRelative(root, researchRequestPath(root)), sha256: await sha256File(researchRequestPath(root)) },
    { path: projectRelative(root, installed.bundlePath), sha256: bundleHash },
    ...installed.files.map((file) => ({
      path: projectRelative(root, file.path),
      sha256: file.sha256,
    })),
  ];
  const imported = await importResearchLock(
    root,
    compatibility.handoffPath,
    LONGTABLE_VERSION,
    { additionalArtifacts },
  );
  return {
    state: "SUCCEEDED",
    bundleHash,
    researchReceiptHash: await sha256File(imported.receiptPath),
    receiptPath: imported.receiptPath,
    bundlePath: installed.bundlePath,
    legacy: false,
  };
}

export function validateBundleLineage(
  bundle: EvidenceDataBundleV1,
  request?: ProposalResearchRequestV1,
): void {
  validateUniqueIds(bundle);
  const sourceById = new Map(bundle.sources.map((source) => [source.sourceId, source]));
  const datasetById = new Map(bundle.datasets.map((dataset) => [dataset.datasetId, dataset]));
  const transformations = bundle.transformations;

  for (const claim of bundle.claims) {
    for (const dataId of claim.dataIds) {
      if (!transformations.some((lineage) =>
        lineage.outputDatasetId === dataId && lineage.claimIds.includes(claim.claimId),
      )) {
        throw lineageError("claim", claim.claimId, dataId);
      }
    }
  }
  for (const figure of bundle.figures) {
    for (const dataId of figure.dataIds) {
      if (!transformations.some((lineage) =>
        lineage.outputDatasetId === dataId && lineage.figureIds.includes(figure.figureId),
      )) {
        throw lineageError("figure", figure.figureId, dataId);
      }
    }
  }
  if (request === undefined) return;

  const acceptedInstitutionIds = new Set([
    request.institution.canonicalName,
    ...request.institution.aliases,
    ...Object.values(request.institution.identifiers),
  ]);
  for (const source of bundle.sources) {
    if (source.rightsStatus === "restricted") {
      throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "제한 증빙은 연구 bundle에 포함할 수 없습니다.", {
        actual: source.sourceId,
      });
    }
    if (INSTITUTION_SOURCE_CLASSES.has(source.sourceClass)) {
      if (source.institutionId === undefined || !acceptedInstitutionIds.has(source.institutionId)) {
        throw new KppError("PP_INSTITUTION_IDENTITY_AMBIGUOUS", "공식자료의 기관 식별자가 연구 요청과 일치하지 않습니다.", {
          expected: [...acceptedInstitutionIds],
          actual: source.institutionId ?? null,
        });
      }
    }
  }

  const requiredFieldIds = new Set(request.requiredData.filter(({ required }) => required).map(({ fieldId }) => fieldId));
  const unresolvedCriticalGaps = bundle.gaps.filter((gap) =>
    gap.requiredDataFieldId !== undefined
    && requiredFieldIds.has(gap.requiredDataFieldId)
    && gap.status !== "resolved",
  );
  if (unresolvedCriticalGaps.length > 0) {
    throw new KppError("PP_REQUIRED_DATA_GAP", "필수 데이터 gap이 해결되지 않았습니다.", {
      actual: unresolvedCriticalGaps,
    });
  }

  for (const field of request.requiredData.filter(({ required }) => required)) {
    const datasets = bundle.datasets.filter(({ fieldIds }) => fieldIds.includes(field.fieldId));
    const resolvedGap = bundle.gaps.some((gap) =>
      gap.requiredDataFieldId === field.fieldId
      && gap.status === "resolved"
      && (gap.kind === "official_source_unavailable" || gap.kind === "required_data_gap"),
    );
    for (const claimId of field.targetClaimIds ?? []) {
      const claim = bundle.claims.find((candidate) => candidate.claimId === claimId);
      if (claim === undefined) throw requiredDataError(field.fieldId, "target_claim_missing");
      if (datasets.length > 0 && !claim.dataIds.some((dataId) => datasets.some(({ datasetId }) => datasetId === dataId))) {
        throw requiredDataError(field.fieldId, "target_claim_unbound");
      }
    }
    for (const figureId of field.targetFigureIds ?? []) {
      const figure = bundle.figures.find((candidate) => candidate.figureId === figureId);
      if (figure === undefined) throw requiredDataError(field.fieldId, "target_figure_missing");
      if (datasets.length > 0 && !figure.dataIds.some((dataId) => datasets.some(({ datasetId }) => datasetId === dataId))) {
        throw requiredDataError(field.fieldId, "target_figure_unbound");
      }
    }
    if (datasets.length === 0) {
      if (resolvedGap) continue;
      throw requiredDataError(field.fieldId, "missing_dataset");
    }
    if (!datasets.some(({ period }) => period === field.period)) {
      throw new KppError("PP_DATA_GRAIN_MISMATCH", "필수 데이터 기간이 연구 요청과 일치하지 않습니다.", {
        expected: field.period,
        actual: datasets.map(({ period }) => period ?? null),
      });
    }
    if (!datasets.some(({ unit }) => unit === field.unit)) {
      throw new KppError("PP_DATA_UNIT_MISMATCH", "필수 데이터 단위가 연구 요청과 일치하지 않습니다.", {
        expected: field.unit,
        actual: datasets.map(({ unit }) => unit ?? null),
      });
    }
    if (!datasets.some(({ grain }) => grain === field.grain)) {
      throw new KppError("PP_DATA_GRAIN_MISMATCH", "필수 데이터 grain이 연구 요청과 일치하지 않습니다.", {
        expected: field.grain,
        actual: datasets.map(({ grain }) => grain ?? null),
      });
    }
    const allowed = new Set(field.allowedSourceClasses);
    const hasAuthoritativeSource = datasets.some((dataset) => dataset.sourceIds.some((sourceId) => {
      const source = sourceById.get(sourceId);
      return source !== undefined
        && source.verified === true
        && OFFICIAL_SOURCE_CLASSES.has(source.sourceClass)
        && allowed.has(source.sourceClass);
    }));
    if (!hasAuthoritativeSource && !resolvedGap) {
      throw requiredDataError(field.fieldId, "official_source_missing");
    }
    for (const claimId of field.targetClaimIds ?? []) {
      const claim = bundle.claims.find((candidate) => candidate.claimId === claimId);
      if (claim === undefined || !claim.sourceIds.some((sourceId) => {
        const source = sourceById.get(sourceId);
        return source !== undefined
          && source.verified === true
          && OFFICIAL_SOURCE_CLASSES.has(source.sourceClass)
          && allowed.has(source.sourceClass);
      })) {
        throw requiredDataError(field.fieldId, "target_claim_official_source_missing");
      }
    }
    for (const figureId of field.targetFigureIds ?? []) {
      const figure = bundle.figures.find((candidate) => candidate.figureId === figureId)!;
      if (!figure.sourceCaption.sourceIds.some((sourceId) => {
        const source = sourceById.get(sourceId);
        return source !== undefined
          && source.verified === true
          && OFFICIAL_SOURCE_CLASSES.has(source.sourceClass)
          && allowed.has(source.sourceClass);
      })) {
        throw requiredDataError(field.fieldId, "target_figure_official_source_missing");
      }
    }
    for (const dataset of datasets) {
      for (const sourceId of dataset.sourceIds) {
        if (!sourceById.has(sourceId)) throw lineageError("dataset", dataset.datasetId, sourceId);
      }
      if (!datasetById.has(dataset.datasetId)) throw lineageError("dataset", dataset.datasetId, dataset.datasetId);
    }
  }

  if (
    ["academic_research", "research_service", "policy_research"].includes(request.proposalClass)
    && request.targetArtifacts.includes("method")
    && !bundle.sources.some((source) =>
      source.sourceClass === "scholarly_fulltext"
      && source.verified === true
      && source.rightsStatus !== "restricted",
    )
  ) {
    throw new KppError("PP_REQUIRED_DATA_GAP", "학술·방법 근거 handoff가 닫히지 않았습니다.", {
      rule: "scholarly_handoff_required",
    });
  }
}

export function researchRequestPath(rootInput: string): string {
  return join(resolve(rootInput), "evidence", "research-lock", REQUEST_FILE_NAME);
}

async function readLockedRequirements(root: string): Promise<{
  readonly requirements: ConfirmedRequirements;
  readonly path: string;
  readonly receiptSha256: string;
}> {
  const path = join(root, "requirements", "requirements.json");
  const receiptPath = join(root, "receipts", "requirements-lock.json");
  const raw = await readJson(path, "PP_RESEARCH_REQUEST_INVALID", "잠긴 요구사항을 읽을 수 없습니다.");
  const parsed = ConfirmedRequirementsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new KppError("PP_RESEARCH_REQUEST_INVALID", "잠긴 요구사항 형식이 올바르지 않습니다.", {
      path,
      actual: parsed.error.issues,
    });
  }
  let verification;
  try {
    verification = await verifyReceipt(receiptPath);
  } catch (error) {
    throw new KppError("PP_RESEARCH_REQUEST_INVALID", "요구사항 잠금 영수증을 검증할 수 없습니다.", {
      path: receiptPath,
      actual: error instanceof Error ? error.message : error,
    });
  }
  const actualSha256 = await sha256File(path);
  if (
    !verification.valid
    || verification.receipt.stage !== "REQUIREMENTS_LOCKED"
    || !verification.receipt.files.some((file) => file.path === path && file.sha256 === actualSha256)
  ) {
    throw new KppError("PP_RESEARCH_REQUEST_INVALID", "연구 요청은 현재 요구사항 잠금에 결속되어야 합니다.", {
      path,
      actual: verification.mismatches,
    });
  }
  return { requirements: parsed.data, path, receiptSha256: await sha256File(receiptPath) };
}

function validateRequestOptions(
  requirements: ConfirmedRequirements,
  options: ResearchRequestOptions,
): void {
  const claimIds = new Set(requirements.requirements.flatMap(({ claims }) => claims.map(({ claimId }) => claimId)));
  const figureIds = new Set(requirements.requirements.flatMap(({ figureSpecs }) => figureSpecs.map(({ figureId }) => figureId)));
  const fieldIds = new Set(options.requiredData.map(({ fieldId }) => fieldId));
  for (const question of options.questions) {
    for (const fieldId of question.requiredDataFieldIds) {
      if (!fieldIds.has(fieldId)) invalidRequest("question_required_data_unknown", fieldId);
    }
  }
  for (const field of options.requiredData) {
    for (const claimId of field.targetClaimIds ?? []) {
      if (!claimIds.has(claimId)) invalidRequest("target_claim_unknown", claimId);
    }
    for (const figureId of field.targetFigureIds ?? []) {
      if (!figureIds.has(figureId)) invalidRequest("target_figure_unknown", figureId);
    }
  }
}

function invalidRequest(rule: string, actual: unknown): never {
  throw new KppError("PP_RESEARCH_REQUEST_INVALID", "연구 요청이 잠긴 요구사항과 일치하지 않습니다.", {
    rule,
    actual,
  });
}

function normalizeInstitution(input: ResearchRequestOptions["institution"]): Institution {
  return {
    canonicalName: input.canonicalName,
    aliases: [...input.aliases],
    identifiers: { ...input.identifiers },
  };
}

function normalizeQuestion(input: ResearchRequestOptions["questions"][number]): ResearchQuestion {
  return {
    questionId: input.questionId,
    text: input.text,
    requiredDataFieldIds: [...input.requiredDataFieldIds],
  };
}

function normalizeRequiredDataField(input: ResearchRequestOptions["requiredData"][number]): RequiredDataField {
  return {
    fieldId: input.fieldId,
    definition: input.definition,
    period: input.period,
    unit: input.unit,
    grain: input.grain,
    required: input.required,
    allowedSourceClasses: [...input.allowedSourceClasses],
    ...(input.targetClaimIds === undefined ? {} : { targetClaimIds: [...input.targetClaimIds] }),
    ...(input.targetFigureIds === undefined ? {} : { targetFigureIds: [...input.targetFigureIds] }),
  };
}

function deriveTargetArtifacts(
  proposalClass: ProposalClass,
  requirements: ConfirmedRequirements,
  requiredData: ResearchRequestOptions["requiredData"],
): TargetArtifact[] {
  const targets = new Set<TargetArtifact>();
  if (requiredData.some(({ targetClaimIds }) => (targetClaimIds?.length ?? 0) > 0)) targets.add("claim");
  if (requiredData.some(({ targetFigureIds }) => (targetFigureIds?.length ?? 0) > 0)) targets.add("figure");
  if (requiredData.length > 0) targets.add("table");
  if (
    ["academic_research", "research_service", "policy_research"].includes(proposalClass)
    || requirements.requirements.some(({ pageRole }) => /^academic(?:_|$)/u.test(pageRole))
  ) targets.add("method");
  if (targets.size === 0) targets.add("claim");
  return [...targets];
}

async function readBoundResearchRequest(
  root: string,
  requestId: string,
): Promise<ProposalResearchRequestV1> {
  const path = researchRequestPath(root);
  const raw = await readJson(path, "PP_RESEARCH_REQUEST_INVALID", "연구 요청을 읽을 수 없습니다.");
  const parsed = ProposalResearchRequestV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw new KppError("PP_RESEARCH_REQUEST_INVALID", "저장된 연구 요청 형식이 올바르지 않습니다.", {
      path,
      actual: parsed.error.issues,
    });
  }
  if (parsed.data.requestId !== requestId) {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle이 현재 KPP 요청과 일치하지 않습니다.", {
      expected: parsed.data.requestId,
      actual: requestId,
    });
  }
  const locked = await readLockedRequirements(root);
  const currentRequirementIds = locked.requirements.requirements.map(({ requirementId }) => requirementId);
  const { requestId: storedRequestId, ...requestSeed } = parsed.data;
  if (
    parsed.data.requirementsLockSha256 !== locked.receiptSha256
    || JSON.stringify(parsed.data.requirementIds) !== JSON.stringify(currentRequirementIds)
    || storedRequestId !== canonicalRequestId(requestSeed)
  ) {
    throw new KppError("PP_RESEARCH_REQUEST_INVALID", "연구 요청이 현재 요구사항 잠금과 정규 요청 식별자에 결속되지 않았습니다.", {
      expected: {
        requirementsLockSha256: locked.receiptSha256,
        requestId: canonicalRequestId(requestSeed),
      },
      actual: {
        requirementsLockSha256: parsed.data.requirementsLockSha256,
        requestId: storedRequestId,
      },
    });
  }
  if (parsed.data.routingDecision !== "required") {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "LongTable 금지 라우팅 요청에는 연구 bundle을 가져올 수 없습니다.", {
      actual: { routingDecision: parsed.data.routingDecision },
    });
  }
  return parsed.data;
}

async function verifyBundleFiles(
  bundlePath: string,
  bundle: EvidenceDataBundleV1,
): Promise<readonly VerifiedBundleFile[]> {
  const bundleRoot = dirname(bundlePath);
  const bundleRootReal = await realpath(bundleRoot);
  const seen = new Set<string>();
  const verified = await Promise.all(bundle.files.map(async (file) => {
    const relativePath = normalizeBundlePath(file.path);
    if (seen.has(relativePath)) {
      throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 파일 경로가 중복됩니다.", {
        path: relativePath,
      });
    }
    seen.add(relativePath);
    const sourcePath = resolve(bundleRoot, relativePath);
    const sourceReal = await realpath(sourcePath).catch(() => undefined);
    const sourceMetadata = await lstat(sourcePath).catch(() => undefined);
    if (
      sourceReal === undefined
      || sourceMetadata === undefined
      || sourceMetadata.isSymbolicLink()
      || !isSubpath(bundleRootReal, sourceReal)
    ) {
      throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 파일 경로가 bundle 경계를 벗어납니다.", {
        path: relativePath,
      });
    }
    const metadata = await stat(sourcePath);
    if (!metadata.isFile()) {
      throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 항목은 일반 파일이어야 합니다.", {
        path: relativePath,
      });
    }
    const actual = await sha256File(sourcePath);
    if (actual !== file.sha256 || (file.bytes !== undefined && file.bytes !== metadata.size)) {
      throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 파일 해시 또는 크기가 일치하지 않습니다.", {
        path: relativePath,
        expected: { sha256: file.sha256, bytes: file.bytes ?? null },
        actual: { sha256: actual, bytes: metadata.size },
      });
    }
    return { relativePath, sourcePath, sha256: actual };
  }));
  for (const path of REQUIRED_BUNDLE_PATHS) {
    if (!seen.has(path)) missingBundleArtifact(path);
  }
  for (const prefix of REQUIRED_BUNDLE_PREFIXES) {
    if (![...seen].some((path) => path.startsWith(prefix))) missingBundleArtifact(prefix);
  }
  return verified;
}

async function verifySucceededHandoff(
  files: readonly VerifiedBundleFile[],
  bundle: EvidenceDataBundleV1,
): Promise<void> {
  const path = files.find((file) => file.relativePath === "handoff.json")!.sourcePath;
  const raw = await readJson(path, "PP_RESEARCH_BUNDLE_INVALID", "연구 bundle handoff를 읽을 수 없습니다.");
  const parsed = ProposalResearchHandoffV1Schema.safeParse(raw);
  if (!parsed.success || parsed.data.status !== "SUCCEEDED") {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "SUCCEEDED handoff만 KPP 입력으로 가져올 수 있습니다.", {
      path,
      expected: "SUCCEEDED",
      actual: parsed.success ? parsed.data.status : parsed.error.issues,
    });
  }
  if (parsed.data.bundleId !== bundle.bundleId || parsed.data.requestId !== bundle.requestId) {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 handoff 식별자가 bundle과 일치하지 않습니다.", {
      expected: { bundleId: bundle.bundleId, requestId: bundle.requestId },
      actual: { bundleId: parsed.data.bundleId, requestId: parsed.data.requestId },
    });
  }
}

function canonicalRequestId(request: Omit<ProposalResearchRequestV1, "requestId">): string {
  return `request-${sha256Canonical(request).slice(0, 20)}`;
}

async function installBundle(
  root: string,
  sourceBundlePath: string,
  bundle: EvidenceDataBundleV1,
  files: readonly VerifiedBundleFile[],
): Promise<{
  readonly bundlePath: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}> {
  const bundlesRoot = join(root, "evidence", "research-lock", "bundles");
  const destination = join(bundlesRoot, safeSegment(bundle.bundleId));
  const staging = join(bundlesRoot, `.${safeSegment(bundle.bundleId)}.${randomUUID()}.tmp`);
  await mkdir(staging, { recursive: true });
  try {
    for (const file of files) {
      const target = join(staging, file.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(file.sourcePath, target);
      if (await sha256File(target) !== file.sha256) {
        throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 복사 후 해시가 일치하지 않습니다.", {
          path: target,
        });
      }
    }
    const stagedBundlePath = join(staging, "bundle.json");
    await copyFile(sourceBundlePath, stagedBundlePath);
    try {
      await rename(staging, destination);
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      await verifyInstalledBundle(destination, sourceBundlePath, files);
      await rm(staging, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    bundlePath: join(destination, "bundle.json"),
    files: files.map((file) => ({ path: join(destination, file.relativePath), sha256: file.sha256 })),
  };
}

async function verifyInstalledBundle(
  destination: string,
  sourceBundlePath: string,
  files: readonly VerifiedBundleFile[],
): Promise<void> {
  if (await sha256File(join(destination, "bundle.json")) !== await sha256File(sourceBundlePath)) {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "같은 bundle ID에 다른 bundle이 이미 설치되어 있습니다.", {
      path: destination,
    });
  }
  for (const file of files) {
    if (await sha256File(join(destination, file.relativePath)) !== file.sha256) {
      throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "설치된 연구 bundle 파일이 입력과 일치하지 않습니다.", {
        path: join(destination, file.relativePath),
      });
    }
  }
}

async function writeCompatibilityHandoff(
  root: string,
  request: ProposalResearchRequestV1,
  bundle: EvidenceDataBundleV1,
  bundleHash: string,
): Promise<{ readonly handoffPath: string }> {
  const compatibilityRoot = join(root, "evidence", "research-lock", "compat", safeSegment(bundle.bundleId));
  const artifacts = {
    researchSpecification: join(compatibilityRoot, "research-specification.json"),
    citationSlotMatrix: join(compatibilityRoot, "citation-slot-matrix.json"),
    sourceLedger: join(compatibilityRoot, "source-ledger.json"),
    claimTransferLedger: join(compatibilityRoot, "claim-transfer-ledger.json"),
  };
  await Promise.all([
    writeStableJson(artifacts.researchSpecification, {
      schemaVersion: "proposal-research-compat/v1",
      request,
      bundleId: bundle.bundleId,
      bundleSha256: bundleHash,
    }),
    writeStableJson(artifacts.citationSlotMatrix, {
      schemaVersion: "proposal-research-compat/v1",
      scholarlySources: bundle.sources.filter(({ sourceClass }) => sourceClass === "scholarly_fulltext"),
      claims: bundle.claims.map(({ claimId, sourceIds }) => ({ claimId, sourceIds })),
    }),
    writeStableJson(artifacts.sourceLedger, {
      schemaVersion: "proposal-research-compat/v1",
      sources: bundle.sources,
      datasets: bundle.datasets,
    }),
    writeStableJson(artifacts.claimTransferLedger, {
      schemaVersion: "proposal-research-compat/v1",
      bundleSha256: bundleHash,
      claims: bundle.claims,
      transformations: bundle.transformations,
      figures: bundle.figures,
      gaps: bundle.gaps,
    }),
  ]);
  const handoffPath = join(compatibilityRoot, "research-lock-handoff.json");
  const projectRelativePaths = Object.fromEntries(Object.entries(artifacts).map(([key, path]) => [
    key,
    projectRelative(root, path),
  ])) as Record<keyof typeof artifacts, string>;
  await writeStableJson(handoffPath, {
    schemaVersion: "1.0.0",
    longtableVersion: LONGTABLE_VERSION,
    projectId: request.projectId,
    proposalClass: request.proposalClass,
    researchSpecificationPath: projectRelativePaths.researchSpecification,
    researchSpecificationSha256: await sha256File(artifacts.researchSpecification),
    citationSlotMatrixPath: projectRelativePaths.citationSlotMatrix,
    citationSlotMatrixSha256: await sha256File(artifacts.citationSlotMatrix),
    sourceLedgerPath: projectRelativePaths.sourceLedger,
    sourceLedgerSha256: await sha256File(artifacts.sourceLedger),
    claimTransferLedgerPath: projectRelativePaths.claimTransferLedger,
    claimTransferLedgerSha256: await sha256File(artifacts.claimTransferLedger),
    openRequiredCheckpoints: [],
    createdAt: new Date(0).toISOString(),
  });
  return { handoffPath };
}

function validateUniqueIds(bundle: EvidenceDataBundleV1): void {
  for (const [name, values] of [
    ["source", bundle.sources.map(({ sourceId }) => sourceId)],
    ["dataset", bundle.datasets.map(({ datasetId }) => datasetId)],
    ["transformation", bundle.transformations.map(({ transformationId }) => transformationId)],
    ["claim", bundle.claims.map(({ claimId }) => claimId)],
    ["figure", bundle.figures.map(({ figureId }) => figureId)],
    ["gap", bundle.gaps.map(({ gapId }) => gapId)],
  ] as const) {
    if (new Set(values).size !== values.length) {
      throw new KppError("PP_TRANSFORMATION_UNTRACEABLE", "연구 bundle 식별자가 중복됩니다.", {
        rule: `${name}_id_duplicate`,
      });
    }
  }
}

function lineageError(kind: string, id: string, dataId: string): KppError {
  return new KppError("PP_TRANSFORMATION_UNTRACEABLE", "원자료에서 claim·Figure까지의 변환 lineage를 확인할 수 없습니다.", {
    rule: `${kind}_lineage_missing`,
    actual: { id, dataId },
  });
}

function requiredDataError(fieldId: string, rule: string): KppError {
  return new KppError("PP_REQUIRED_DATA_GAP", "필수 기관 데이터에 검증된 공식 출처 또는 명시적 미해결 근거가 없습니다.", {
    rule,
    actual: fieldId,
  });
}

function missingBundleArtifact(path: string): never {
  throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 필수 산출물이 없습니다.", {
    path,
  });
}

function normalizeBundlePath(path: string): string {
  const normalized = normalize(path);
  if (
    isAbsolute(path)
    || normalized === "."
    || normalized.startsWith("..")
    || normalized === "bundle.json"
  ) {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle 파일 경로가 허용 경계를 벗어납니다.", {
      path,
    });
  }
  return normalized;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === "." || value === "..") {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 bundle ID를 파일 경로로 사용할 수 없습니다.", {
      actual: value,
    });
  }
  return value;
}

function projectRelative(root: string, path: string): string {
  const value = relative(root, path);
  if (value === "" || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new KppError("PP_RESEARCH_BUNDLE_INVALID", "연구 산출물 경로가 KPP 프로젝트를 벗어납니다.", {
      path,
    });
  }
  return value;
}

function isSubpath(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function readJson(path: string, code: string, message: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new KppError(code, message, {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new KppError(code, message, {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

async function writeStableJson(path: string, value: unknown): Promise<void> {
  await writeStableFile(path, `${JSON.stringify(value, null, 2)}\n`, "PP_RESEARCH_BUNDLE_INVALID");
}

async function writeStableFile(path: string, contents: string, code: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (isFileExistsError(error)) {
      const existing = await readFile(path, "utf8").catch(() => undefined);
      if (existing === contents) return;
      throw new KppError(code, "기존 연구 산출물을 다른 내용으로 덮어쓸 수 없습니다.", { path });
    }
    throw error;
  }
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ["EEXIST", "ENOTEMPTY"].includes(String((error as { code?: unknown }).code));
}
