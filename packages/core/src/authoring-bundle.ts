import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  ApprovedTerminologySchema,
  AuthoringRequestSchema,
  AuthoringResponseSchema,
  ConfirmedRequirementsSchema,
  EvidenceLedgerSchema,
  IssuerProfileSchema,
  PagePlanSchema,
  type ApprovedTerminology,
  type AuthoringEvidenceProvenance,
  type AuthoringRequest,
  type AuthoringResponse,
  type ConfirmedRequirements,
  type EvidenceLedger,
  type IssuerProfile,
  type PagePlan,
} from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";
import { verifyProjectState } from "./state-machine.js";

const SCHEMA_VERSION = "1.0.0";
const REQUEST_FILE_NAME = "authoring-request.json";
const RESPONSE_FILE_NAME = "authoring-response.json";
const DEFAULT_ISSUER_PROFILE: IssuerProfile = {
  schemaVersion: SCHEMA_VERSION,
  rules: [],
};
const DEFAULT_TERMINOLOGY: ApprovedTerminology = {
  schemaVersion: SCHEMA_VERSION,
  entries: [],
};

export interface AuthoringSourceInput {
  readonly path: string;
  readonly value: unknown;
}

export interface ExportAuthoringInput {
  readonly issuerProfile?: AuthoringSourceInput;
  readonly terminology?: AuthoringSourceInput;
}

export interface ExportAuthoringResult {
  readonly requestPath: string;
  readonly blockCount: number;
}

export interface ImportAuthoringResult {
  readonly responsePath: string;
  readonly blockCount: number;
}

export interface VerifiedAuthoringResponse {
  readonly requestPath: string;
  readonly responsePath: string;
  readonly request: AuthoringRequest;
  readonly response: AuthoringResponse;
}

interface AuthoringArtifacts {
  readonly requirementsPath: string;
  readonly evidenceLedgerPath: string;
  readonly pagePlanPath: string;
  readonly requirements: ConfirmedRequirements;
  readonly evidenceLedger: EvidenceLedger;
  readonly pagePlan: PagePlan;
}

interface LoadedAuthoringInput<T> {
  readonly status: "provided" | "not_provided";
  readonly path: string | null;
  readonly sha256: string | null;
  readonly value: T;
}

export async function exportAuthoring(
  rootInput: string,
  input: ExportAuthoringInput = {},
): Promise<ExportAuthoringResult> {
  const root = resolve(rootInput);
  const project = await assertAuthoringProject(root);
  const artifacts = await loadAuthoringArtifacts(root);
  const issuerProfile = await loadIssuerProfile(input.issuerProfile);
  const terminology = await loadTerminology(input.terminology);
  const request = await buildAuthoringRequest(project.projectId, artifacts, issuerProfile, terminology);
  const requestPath = join(root, "content", REQUEST_FILE_NAME);
  await writeJsonAtomically(requestPath, request);
  return { requestPath, blockCount: request.blocks.length };
}

export async function importAuthoring(
  rootInput: string,
  responseInput: unknown,
): Promise<ImportAuthoringResult> {
  const root = resolve(rootInput);
  const project = await assertAuthoringProject(root);
  const requestPath = join(root, "content", REQUEST_FILE_NAME);
  const request = await readAuthoringRequest(requestPath);
  await verifyRequestAgainstLockedInputs(root, project.projectId, request);
  const response = parseAuthoringResponse(responseInput);
  await validateAuthoringResponse(response, request);

  const responsePath = join(root, "content", RESPONSE_FILE_NAME);
  await writeJsonAtomically(responsePath, response);
  return { responsePath, blockCount: response.blocks.length };
}

/**
 * Re-validates the persisted authoring exchange against its currently locked
 * inputs. Consumers that make approval decisions must use this rather than
 * accepting a response file as independently trustworthy.
 */
export async function verifyImportedAuthoringResponse(
  rootInput: string,
): Promise<VerifiedAuthoringResponse> {
  const root = resolve(rootInput);
  const project = await verifyProjectState(root);
  if (project.state !== "DESIGN_LOCKED") {
    throw new KppError(
      "KPP_STATE_INVALID_TRANSITION",
      "콘텐츠 승인은 DESIGN_LOCKED 상태에서만 시작할 수 있습니다.",
      { stage: project.state, expected: "DESIGN_LOCKED", actual: project.state },
    );
  }
  const requestPath = join(root, "content", REQUEST_FILE_NAME);
  const responsePath = join(root, "content", RESPONSE_FILE_NAME);
  const request = await readAuthoringRequest(requestPath);
  await verifyRequestAgainstLockedInputs(root, project.projectId, request);
  const response = parseAuthoringResponse(await readJson(responsePath, "KPP_INPUT_AUTHORING_RESPONSE_MISSING"));
  await validateAuthoringResponse(response, request);
  return { requestPath, responsePath, request, response };
}

async function assertAuthoringProject(root: string) {
  const project = await verifyProjectState(root);
  if (project.state !== "REQUIREMENTS_LOCKED" && project.state !== "EVIDENCE_LOCKED") {
    throw new KppError(
      "KPP_STATE_INVALID_TRANSITION",
      "작성 번들은 REQUIREMENTS_LOCKED 또는 EVIDENCE_LOCKED 상태에서만 교환할 수 있습니다.",
      {
        stage: project.state,
        expected: ["REQUIREMENTS_LOCKED", "EVIDENCE_LOCKED"],
        actual: project.state,
      },
    );
  }
  return project;
}

async function loadAuthoringArtifacts(root: string): Promise<AuthoringArtifacts> {
  const requirementsPath = join(root, "requirements", "requirements.json");
  const evidenceLedgerPath = join(root, "evidence", "evidence-ledger.json");
  const pagePlanPath = join(root, "content", "page-plan.json");
  const [requirementsRaw, evidenceLedgerRaw, pagePlanRaw] = await Promise.all([
    readJson(requirementsPath, "KPP_INPUT_AUTHORING_ARTIFACT"),
    readJson(evidenceLedgerPath, "KPP_INPUT_AUTHORING_ARTIFACT"),
    readJson(pagePlanPath, "KPP_INPUT_AUTHORING_ARTIFACT"),
  ]);
  const requirements = parseArtifact(ConfirmedRequirementsSchema, requirementsRaw, requirementsPath);
  const evidenceLedger = parseArtifact(EvidenceLedgerSchema, evidenceLedgerRaw, evidenceLedgerPath);
  const pagePlan = parseArtifact(PagePlanSchema, pagePlanRaw, pagePlanPath);
  return { requirementsPath, evidenceLedgerPath, pagePlanPath, requirements, evidenceLedger, pagePlan };
}

async function loadIssuerProfile(input: AuthoringSourceInput | undefined): Promise<LoadedAuthoringInput<IssuerProfile>> {
  return loadOptionalInput(input, IssuerProfileSchema, DEFAULT_ISSUER_PROFILE, "issuer profile");
}

async function loadTerminology(input: AuthoringSourceInput | undefined): Promise<LoadedAuthoringInput<ApprovedTerminology>> {
  return loadOptionalInput(input, ApprovedTerminologySchema, DEFAULT_TERMINOLOGY, "approved terminology");
}

async function loadOptionalInput<T>(
  input: AuthoringSourceInput | undefined,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } } },
  fallback: T,
  label: string,
): Promise<LoadedAuthoringInput<T>> {
  if (input === undefined) {
    return { status: "not_provided", path: null, sha256: null, value: fallback };
  }
  const path = resolve(input.path);
  const parsed = schema.safeParse(input.value);
  if (!parsed.success) {
    throw new KppError("KPP_INPUT_AUTHORING_SOURCE_INVALID", `${label} JSON 형식이 올바르지 않습니다.`, {
      path,
      actual: parsed.error.issues,
    });
  }
  const persisted = await readJson(path, "KPP_INPUT_AUTHORING_SOURCE_INVALID");
  const persistedParsed = schema.safeParse(persisted);
  if (!persistedParsed.success || JSON.stringify(persistedParsed.data) !== JSON.stringify(parsed.data)) {
    throw new KppError("KPP_INPUT_AUTHORING_SOURCE_INVALID", `${label} 입력과 원본 파일이 일치하지 않습니다.`, {
      path,
      actual: persistedParsed.success ? persistedParsed.data : persistedParsed.error.issues,
    });
  }
  return {
    status: "provided",
    path,
    sha256: await sha256File(path),
    value: parsed.data,
  };
}

async function buildAuthoringRequest(
  projectId: string,
  artifacts: AuthoringArtifacts,
  issuerProfile: LoadedAuthoringInput<IssuerProfile>,
  terminology: LoadedAuthoringInput<ApprovedTerminology>,
): Promise<AuthoringRequest> {
  const requirementById = new Map(artifacts.requirements.requirements.map((requirement) => [
    requirement.requirementId,
    requirement,
  ]));
  const claimById = new Map(artifacts.evidenceLedger.claims.map((claim) => [claim.claimId, claim]));
  const bindingByEvidenceId = new Map(artifacts.evidenceLedger.bindings.map((binding) => [
    binding.evidenceId,
    binding,
  ]));
  assertUnique(artifacts.evidenceLedger.claims.map(({ claimId }) => claimId), "claim ID", artifacts.evidenceLedgerPath);
  assertUnique(artifacts.evidenceLedger.bindings.map(({ evidenceId }) => evidenceId), "evidence ID", artifacts.evidenceLedgerPath);
  assertUnique(artifacts.pagePlan.pages.map(({ pageId }) => pageId), "page ID", artifacts.pagePlanPath);

  const evidenceIdsInRequest = new Set<string>();
  const blocks = artifacts.pagePlan.pages.map((page) => {
    const requirement = requirementById.get(page.requirementId);
    if (requirement === undefined || requirement.pageRole !== page.pageRole) {
      throw artifactError("page_requirement_mismatch", artifacts.pagePlanPath, page);
    }
    const expectedClaimIds = requirement.claims.map(({ claimId }) => claimId);
    if (!sameOrderedValues(page.claimIds, expectedClaimIds)) {
      throw artifactError("page_claim_mismatch", artifacts.pagePlanPath, {
        pageId: page.pageId,
        expectedClaimIds,
        actualClaimIds: page.claimIds,
      });
    }
    const claimScopes = page.claimIds.map((claimId) => {
      const claim = claimById.get(claimId);
      if (claim === undefined) {
        throw artifactError("ledger_claim_missing", artifacts.evidenceLedgerPath, claimId);
      }
      if (claim.status === "blocked") {
        throw new KppError(
          "KPP_INPUT_AUTHORING_BLOCKED_CLAIM",
          "차단된 핵심 주장이 있어 작성 요청을 만들 수 없습니다.",
          { rule: "blocked_claim", path: artifacts.evidenceLedgerPath, actual: claimId },
        );
      }
      return { claimId, status: claim.status, evidenceIds: [...claim.evidenceIds] };
    });
    const allowedEvidenceIds = uniqueInOrder(claimScopes
      .filter(({ status }) => status === "verified" || status === "bounded")
      .flatMap(({ evidenceIds }) => evidenceIds));
    for (const evidenceId of allowedEvidenceIds) {
      const binding = bindingByEvidenceId.get(evidenceId);
      if (binding === undefined) {
        throw artifactError("ledger_binding_missing", artifacts.evidenceLedgerPath, evidenceId);
      }
      if (binding.targetPageId !== page.pageId || binding.targetRequirementId !== requirement.requirementId) {
        throw artifactError("evidence_target_mismatch", artifacts.evidenceLedgerPath, { pageId: page.pageId, evidenceId });
      }
      evidenceIdsInRequest.add(evidenceId);
    }
    const permittedPendingBlankFields = claimScopes
      .filter(({ status }) => status === "pending_blank")
      .map(({ claimId }) => claimId);
    return {
      pageId: page.pageId,
      requirementId: requirement.requirementId,
      pageRole: page.pageRole,
      claimIds: [...page.claimIds],
      claimScopes,
      allowedEvidenceIds,
      terminology: terminology.value.entries.map((entry) => ({ ...entry })),
      lengthBudget: { maxCharacters: page.figureSpecs.length > 0 ? 800 : 1_200 },
      requiredEvaluatorAnswer: `평가항목 “${requirement.title}”에 대한 직접 답변을 작성합니다.`,
      permittedPendingBlankFields,
      figureSpecs: page.figureSpecs.map((figure) => ({ ...figure })),
    };
  });

  const evidenceProvenance: AuthoringEvidenceProvenance[] = [];
  for (const evidenceId of [...evidenceIdsInRequest].sort()) {
    const binding = bindingByEvidenceId.get(evidenceId)!;
    await assertEvidenceSource(binding.sourcePath, binding.sourceSha256);
    const statuses = binding.claimIds.map((claimId) => claimById.get(claimId)?.status);
    const status = statuses.includes("verified") ? "verified" : "bounded";
    evidenceProvenance.push({
      evidenceId: binding.evidenceId,
      sourcePath: resolve(binding.sourcePath),
      sourceSha256: binding.sourceSha256,
      scope: binding.scope,
      claimIds: [...binding.claimIds],
      status,
    });
  }

  return AuthoringRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    projectId,
    issuerProfile: {
      status: issuerProfile.status,
      path: issuerProfile.path,
      sha256: issuerProfile.sha256,
      profile: issuerProfile.value,
    },
    terminology: {
      status: terminology.status,
      path: terminology.path,
      sha256: terminology.sha256,
      glossary: terminology.value,
    },
    artifacts: {
      requirementsPath: artifacts.requirementsPath,
      requirementsSha256: await sha256File(artifacts.requirementsPath),
      evidenceLedgerPath: artifacts.evidenceLedgerPath,
      evidenceLedgerSha256: await sha256File(artifacts.evidenceLedgerPath),
      pagePlanPath: artifacts.pagePlanPath,
      pagePlanSha256: await sha256File(artifacts.pagePlanPath),
    },
    evidenceProvenance,
    blocks,
  });
}

async function verifyRequestAgainstLockedInputs(
  root: string,
  projectId: string,
  request: AuthoringRequest,
): Promise<void> {
  if (request.projectId !== projectId) {
    throw requestMismatch("project_id", request.projectId, projectId);
  }
  const artifacts = await loadAuthoringArtifacts(root);
  const issuerProfile = await reloadRequestIssuerProfile(request);
  const terminology = await reloadRequestTerminology(request);
  const canonical = await buildAuthoringRequest(projectId, artifacts, issuerProfile, terminology);
  if (JSON.stringify(canonical) !== JSON.stringify(request)) {
    throw requestMismatch("request_provenance", canonical, request);
  }
}

async function reloadRequestIssuerProfile(
  request: AuthoringRequest,
): Promise<LoadedAuthoringInput<IssuerProfile>> {
  const { issuerProfile } = request;
  return reloadRequestInput(
    issuerProfile.status,
    issuerProfile.path,
    issuerProfile.sha256,
    issuerProfile.profile,
    IssuerProfileSchema,
    DEFAULT_ISSUER_PROFILE,
    "issuer profile",
  );
}

async function reloadRequestTerminology(
  request: AuthoringRequest,
): Promise<LoadedAuthoringInput<ApprovedTerminology>> {
  const { terminology } = request;
  return reloadRequestInput(
    terminology.status,
    terminology.path,
    terminology.sha256,
    terminology.glossary,
    ApprovedTerminologySchema,
    DEFAULT_TERMINOLOGY,
    "approved terminology",
  );
}

async function reloadRequestInput<T>(
  status: "provided" | "not_provided",
  path: string | null,
  expectedSha256: string | null,
  expectedValue: T,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } } },
  fallback: T,
  label: string,
): Promise<LoadedAuthoringInput<T>> {
  if (status === "not_provided") {
    if (JSON.stringify(expectedValue) !== JSON.stringify(fallback)) {
      throw requestMismatch(`${label}_default`, fallback, expectedValue);
    }
    return { status, path: null, sha256: null, value: fallback };
  }
  if (path === null || expectedSha256 === null) {
    throw requestMismatch(`${label}_provenance`, "path and SHA-256", { path, expectedSha256 });
  }
  const raw = await readJson(path, "KPP_INPUT_AUTHORING_REQUEST_MISMATCH");
  const parsed = schema.safeParse(raw);
  if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(expectedValue)) {
    throw requestMismatch(`${label}_content`, expectedValue, parsed.success ? parsed.data : parsed.error.issues);
  }
  const actualSha256 = await sha256File(path);
  if (actualSha256 !== expectedSha256) {
    throw requestMismatch(`${label}_sha256`, expectedSha256, actualSha256);
  }
  return { status, path: resolve(path), sha256: actualSha256, value: parsed.data };
}

async function validateAuthoringResponse(response: AuthoringResponse, request: AuthoringRequest): Promise<void> {
  const expectedByPageId = new Map(request.blocks.map((block) => [block.pageId, block]));
  assertUnique(response.blocks.map(({ pageId }) => pageId), "response page ID", "response");
  for (const block of response.blocks) {
    const expected = expectedByPageId.get(block.pageId);
    if (expected === undefined) {
      throw evidenceBoundaryError("unknown_page_id", block.pageId);
    }
    if (!sameOrderedValues(block.claimIds, expected.claimIds)) {
      throw evidenceBoundaryError("claim_ids_out_of_scope", {
        pageId: block.pageId,
        expected: expected.claimIds,
        actual: block.claimIds,
      });
    }
    if (!sameOrderedValues(block.evidenceIds, expected.allowedEvidenceIds)) {
      throw evidenceBoundaryError("evidence_ids_out_of_scope", {
        pageId: block.pageId,
        expected: expected.allowedEvidenceIds,
        actual: block.evidenceIds,
      });
    }
    if (block.evaluatorAnswer.trim().length === 0) {
      throw new KppError("KPP_INPUT_AUTHORING_EVALUATOR_ANSWER_MISSING", "평가항목에 대한 직접 답변이 비어 있습니다.", {
        rule: "evaluator_answer_missing",
        actual: block.pageId,
      });
    }
    if ([...block.text].length > expected.lengthBudget.maxCharacters) {
      throw new KppError("KPP_INPUT_AUTHORING_LENGTH", "작성 본문이 페이지별 글자 수 상한을 초과했습니다.", {
        rule: "length_budget_exceeded",
        actual: [...block.text].length,
        expected: expected.lengthBudget.maxCharacters,
      });
    }
    validatePendingBlanks(block, expected.permittedPendingBlankFields);
    await validateNumericTokens(
      `${block.text}\n${block.evaluatorAnswer}`,
      block.evidenceIds,
      request.evidenceProvenance,
    );
  }
  const responsePageIds = response.blocks.map(({ pageId }) => pageId);
  const missingPageIds = request.blocks.map(({ pageId }) => pageId).filter((pageId) => !responsePageIds.includes(pageId));
  if (missingPageIds.length > 0) {
    throw new KppError("KPP_INPUT_AUTHORING_RESPONSE_MISSING", "작성 응답에 필수 페이지가 누락되었습니다.", {
      rule: "response_page_missing",
      actual: missingPageIds,
    });
  }
}

function validatePendingBlanks(
  block: AuthoringResponse["blocks"][number],
  permittedPendingBlankFields: readonly string[],
): void {
  const rawPlaceholders = [...block.text.matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1]!);
  const placeholderIds = rawPlaceholders.filter((fieldId) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(fieldId));
  if (
    rawPlaceholders.length !== placeholderIds.length
    || !sameOrderedValues(block.pendingBlankFieldIds, placeholderIds)
    || block.pendingBlankFieldIds.some((fieldId) => !permittedPendingBlankFields.includes(fieldId))
  ) {
    throw new KppError("KPP_INPUT_AUTHORING_BLANK", "선언되지 않은 pending_blank 필드가 작성 응답에 있습니다.", {
      rule: "pending_blank_out_of_scope",
      actual: { declared: block.pendingBlankFieldIds, placeholders: placeholderIds },
      expected: permittedPendingBlankFields,
    });
  }
}

async function validateNumericTokens(
  text: string,
  evidenceIds: readonly string[],
  evidenceProvenance: readonly AuthoringEvidenceProvenance[],
): Promise<void> {
  const bindingsByEvidenceId = new Map(evidenceProvenance.map((binding) => [binding.evidenceId, binding]));
  const allowedNumericTokens = new Set<string>();
  for (const evidenceId of evidenceIds) {
    const binding = bindingsByEvidenceId.get(evidenceId);
    if (binding === undefined) {
      throw evidenceBoundaryError("unknown_evidence_id", evidenceId);
    }
    await assertEvidenceSource(binding.sourcePath, binding.sourceSha256);
    for (const numericToken of numericTokens(binding.scope)) {
      allowedNumericTokens.add(numericToken);
    }
  }
  const responseText = text.replace(/\{\{[A-Za-z][A-Za-z0-9_-]*\}\}/g, "");
  const unbound = numericTokens(responseText).filter((token) => !allowedNumericTokens.has(token));
  if (unbound.length > 0) {
    throw evidenceBoundaryError("numeric_token_unbound", unbound);
  }
}

function numericTokens(value: string): readonly string[] {
  const normalized = value.normalize("NFKC");
  const arabicTokens = [...normalized.matchAll(/\d{1,3}(?:,\d{3})*(?:\.\d+)?/g)]
    .map((match) => match[0]!);
  const koreanTokens = [...normalized.matchAll(
    /([영공일이삼사오육칠팔구십백천만억조]{1,})(?=\s*(?:쪽|페이지|일|년|명|개|원|회|%|퍼센트|pt|포인트))/g,
  )]
    .map((match) => parseKoreanNumber(match[1]!))
    .filter((token): token is string => token !== null);
  const nativeTokens = [...normalized.matchAll(
    /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(?=(?:명|개|회|가지|년|쪽|페이지|원|일|%|퍼센트|pt|포인트))/g,
  )]
    .map((match) => nativeKoreanNumber(match[1]!));
  return [...arabicTokens, ...koreanTokens, ...nativeTokens];
}

function nativeKoreanNumber(value: string): string {
  const values: Readonly<Record<string, string>> = {
    한: "1",
    두: "2",
    세: "3",
    네: "4",
    다섯: "5",
    여섯: "6",
    일곱: "7",
    여덟: "8",
    아홉: "9",
    열: "10",
  };
  return values[value]!;
}

function parseKoreanNumber(value: string): string | null {
  const digits: Readonly<Record<string, number>> = {
    영: 0,
    공: 0,
    일: 1,
    이: 2,
    삼: 3,
    사: 4,
    오: 5,
    육: 6,
    칠: 7,
    팔: 8,
    구: 9,
  };
  const smallUnits: Readonly<Record<string, number>> = { 십: 10, 백: 100, 천: 1_000 };
  const largeUnits: Readonly<Record<string, number>> = { 만: 10_000, 억: 100_000_000, 조: 1_000_000_000_000 };
  let result = 0;
  let section = 0;
  let digit: number | null = null;
  for (const character of value) {
    if (character in digits) {
      digit = digits[character]!;
      continue;
    }
    if (character in smallUnits) {
      section += (digit ?? 1) * smallUnits[character]!;
      digit = null;
      continue;
    }
    if (character in largeUnits) {
      result += (section + (digit ?? 0)) * largeUnits[character]!;
      section = 0;
      digit = null;
      continue;
    }
    return null;
  }
  return String(result + section + (digit ?? 0));
}

function parseAuthoringResponse(value: unknown): AuthoringResponse {
  if (typeof value === "object" && value !== null && "blocks" in value && Array.isArray(value.blocks)) {
    for (const block of value.blocks) {
      if (typeof block === "object" && block !== null && "status" in block) {
        const status = block.status;
        if (status !== "draft" && status !== "provisional") {
          throw new KppError("KPP_INPUT_AUTHORING_STATUS", "작성 응답은 draft 또는 provisional 상태만 가질 수 있습니다.", {
            rule: "response_status_provisional_only",
            actual: status,
            expected: ["draft", "provisional"],
          });
        }
      }
    }
  }
  const parsed = AuthoringResponseSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new KppError("KPP_INPUT_AUTHORING_RESPONSE_INVALID", "작성 응답 JSON 형식이 올바르지 않습니다.", {
    rule: "response_schema",
    actual: parsed.error.issues,
  });
}

async function readAuthoringRequest(path: string): Promise<AuthoringRequest> {
  const raw = await readJson(path, "KPP_INPUT_AUTHORING_REQUEST_MISSING");
  const parsed = AuthoringRequestSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  throw new KppError("KPP_INPUT_AUTHORING_REQUEST_INVALID", "작성 요청 JSON 형식이 올바르지 않습니다.", {
    path,
    actual: parsed.error.issues,
  });
}

async function readJson(path: string, code: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new KppError(code, "작성 번들 입력 파일을 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new KppError(code, "작성 번들 입력 JSON 형식이 올바르지 않습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

function parseArtifact<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } } },
  value: unknown,
  path: string,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw artifactError("artifact_schema", path, parsed.error.issues);
}

async function assertEvidenceSource(sourcePath: string, expectedSha256: string): Promise<void> {
  const path = resolve(sourcePath);
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new Error("source is not a file");
    }
    const actualSha256 = await sha256File(path);
    if (actualSha256 !== expectedSha256) {
      throw evidenceBoundaryError("evidence_source_sha256_mismatch", {
        path,
        expected: expectedSha256,
        actual: actualSha256,
      });
    }
  } catch (error) {
    if (error instanceof KppError) {
      throw error;
    }
    throw evidenceBoundaryError("evidence_source_unreadable", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

function assertUnique(values: readonly string[], label: string, path: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) {
    throw artifactError("duplicate_identifier", path, { label, duplicates: uniqueInOrder(duplicates) });
  }
}

function uniqueInOrder(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function artifactError(rule: string, path: string, actual: unknown): KppError {
  return new KppError("KPP_INPUT_AUTHORING_ARTIFACT", "잠긴 작성 입력 산출물의 연결이 올바르지 않습니다.", {
    rule,
    path,
    actual,
  });
}

function requestMismatch(rule: string, expected: unknown, actual: unknown): KppError {
  return new KppError("KPP_INPUT_AUTHORING_REQUEST_MISMATCH", "작성 요청의 출처·해시·계획 연결이 현재 잠금 입력과 일치하지 않습니다.", {
    rule,
    expected,
    actual,
  });
}

function evidenceBoundaryError(rule: string, actual: unknown): KppError {
  return new KppError("KPP_EVIDENCE_UNBOUND_CLAIM", "작성 응답이 잠긴 증거·주장 범위를 벗어났습니다.", {
    rule,
    actual,
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
