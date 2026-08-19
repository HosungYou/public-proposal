import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { LivingProposalBriefV1, SectionPlanItemV1, SectionPlanV1 } from "@longtable/kpp-schemas";

const SECTION_PLAN_FILE_NAME = "section-plan.json";
const REPRESENTATIVE_APPROVAL_FILE_NAME = "representative-approval.json";
const FULL_AUTHORING_FILE_NAME = "full-authoring-request.json";

export const POSITIVE_PROPOSAL_DOCTRINE = [
  "발주처의 평가 질문에 먼저 직접 답하고, 필요한 전제와 범위를 분명히 한다.",
  "확인된 사실에서 해석을 도출하고 그 해석이 다음 결정이나 행동으로 이어지게 한다.",
  "추상적인 체계보다 누가 무엇을 어떻게 수행하는지를 구체적으로 쓴다.",
  "표와 도식은 비교·이해·판단을 실제로 더 쉽게 만들 때만 사용한다.",
  "미확정 사항은 감추거나 채우지 않고 결정 주체와 다음 행동을 명확히 한다.",
  "형식은 내용과 독자의 읽기 흐름을 돕도록 선택하며 모든 페이지를 같은 틀에 맞추지 않는다.",
] as const;

export type SecurityClass = "PUBLIC" | "PROJECT_CONFIDENTIAL" | "RESTRICTED_PROOF";
export type RepresentativeRole = "problem" | "method" | "execution";
export type AgentRunStatus = "SUCCEEDED" | "PARTIAL" | "TIMEOUT" | "QUARANTINED";

export interface BuildAgentPacketInput {
  readonly inputHash: string;
  readonly brief: LivingProposalBriefV1;
  readonly section: SectionPlanItemV1;
  readonly researchBundleIds: readonly string[];
  readonly outputDirectory: string;
  readonly securityClass: SecurityClass | "SECRET";
  readonly allowedPurpose?: "author_section" | "review_section";
}

export interface AgentPacket {
  readonly inputHash: string;
  readonly allowedPurpose: "author_section" | "review_section";
  readonly redactedContext: readonly string[];
  readonly outputDirectory: string;
  readonly securityClass: SecurityClass;
  readonly doctrine: readonly string[];
  readonly readers: readonly string[];
  readonly readerTasks: readonly string[];
  readonly sectionPurpose: string;
  readonly allowedClaimIds: readonly string[];
  readonly allowedEvidenceIds: readonly string[];
  readonly openDecisionIds: readonly string[];
  readonly approvedReferences: readonly string[];
  readonly familyProfile: string;
  readonly researchBundleIds: readonly string[];
}

export interface CreateSectionPlanInput {
  readonly root: string;
  readonly projectId: string;
  readonly sections: readonly SectionPlanItemV1[];
}

export interface ReviewerFinding {
  readonly findingId: string;
  readonly reviewerRole: string;
  readonly inputHash: string;
  readonly artifactHash: string;
  readonly target: { readonly sectionId?: string; readonly claimId?: string; readonly figureId?: string };
  readonly authorityClass: "issuer" | "evidence" | "method" | "editorial" | "visual" | "privacy" | "release";
  readonly severity: "blocker" | "editorial_hold" | "warning";
  readonly readerImpact: string;
  readonly evidence: readonly string[];
  readonly proposedPatch: PatchProposal | null;
  readonly confidence: number;
  readonly dependencies: readonly string[];
}

export interface PatchProposal {
  readonly originalExcerpt: string;
  readonly originalHash: string;
  readonly replacement: string;
  readonly reason: string;
  readonly evidenceIds: readonly string[];
  readonly affectedRequirementIds: readonly string[];
  readonly risk: string;
}

export interface AgentRun {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly inputHash: string;
}

export interface AdjudicationInput {
  readonly findings: readonly ReviewerFinding[];
  readonly runs?: readonly AgentRun[];
  readonly changedInputHashes?: readonly string[];
  readonly directedCrossReviewCount?: number;
  readonly rebuttalCount?: number;
}

export interface AdjudicationResult {
  readonly status: "ACCEPT" | "EDITORIAL_REVIEW_REQUIRED" | "BLOCKED";
  readonly receipt: {
    readonly schemaVersion: "agent-adjudication/v1";
    readonly decisions: readonly { readonly findingId: string; readonly outcome: "accept" | "modify" | "reject"; readonly reason: string }[];
  };
  readonly quarantinedRunIds: readonly string[];
  readonly invalidatedFindingIds: readonly string[];
  readonly reusableFindingIds: readonly string[];
}

export interface MergeApprovedPatchOptions {
  readonly actor: "Proposal Editor" | string;
  readonly adjudication: "accept" | "modify" | "reject";
}

export interface RepresentativeApproval {
  readonly representativeRole: RepresentativeRole;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly renderedPageContextPath: string;
  readonly findingIds: readonly string[];
}

export interface FullAuthoringResult {
  readonly status: "READY_FOR_FULL_AUTHORING";
  readonly requestPath: string;
}

export function buildAgentPacket(input: BuildAgentPacketInput): AgentPacket {
  if (input.securityClass === "SECRET") {
    throw new SectionAuthoringError("PP_AGENT_PACKET_SECRET_FORBIDDEN", "SECRET 자료는 agent packet에 포함할 수 없습니다.");
  }
  if (input.brief.approvedReferences.length < 2) {
    throw new SectionAuthoringError("PP_AGENT_PACKET_REFERENCE_REQUIRED", "작성 packet에는 승인 reference가 두 개 이상 필요합니다.");
  }

  const activeOpenDecisionIds = new Set(input.brief.openDecisions.map(({ decisionId }) => decisionId));
  return {
    inputHash: input.inputHash,
    allowedPurpose: input.allowedPurpose ?? "author_section",
    redactedContext: input.brief.evidenceBoundary.map(redactContext),
    outputDirectory: input.outputDirectory,
    securityClass: input.securityClass,
    doctrine: POSITIVE_PROPOSAL_DOCTRINE,
    readers: input.brief.primaryReaders.map(({ reader }) => reader),
    readerTasks: input.section.readerTasks,
    sectionPurpose: input.section.purpose,
    allowedClaimIds: input.section.claimIds,
    allowedEvidenceIds: input.section.evidenceIds,
    openDecisionIds: input.section.openDecisionIds.filter((decisionId) => activeOpenDecisionIds.has(decisionId)),
    approvedReferences: input.brief.approvedReferences.slice(0, 3).map(({ referenceId }) => referenceId),
    familyProfile: familyProfile(input.brief.proposalClass),
    researchBundleIds: [...input.researchBundleIds],
  };
}

export async function createSectionPlan(input: CreateSectionPlanInput): Promise<SectionPlanV1> {
  const plan: SectionPlanV1 = {
    schemaVersion: "section-plan/v1",
    projectId: input.projectId,
    sections: input.sections.map((section) => ({
      ...section,
      readerTasks: [...section.readerTasks],
      requirementIds: [...section.requirementIds],
      claimIds: [...section.claimIds],
      evidenceIds: [...section.evidenceIds],
      argumentMoves: [...section.argumentMoves],
      visualNeeds: section.visualNeeds.map((need) => ({ ...need, evidenceIds: [...need.evidenceIds] })),
      openDecisionIds: [...section.openDecisionIds],
    })),
  };
  assertValidSectionPlan(plan);
  await writeJsonAtomically(join(resolve(input.root), "content", SECTION_PLAN_FILE_NAME), plan);
  return plan;
}

export function mergeApprovedPatch(source: string, patch: PatchProposal, options: MergeApprovedPatchOptions): string {
  if (options.actor !== "Proposal Editor") {
    throw new SectionAuthoringError("PP_PATCH_EDITOR_ONLY", "Proposal Editor만 승인 patch를 적용할 수 있습니다.");
  }
  if (options.adjudication === "reject") return source;
  if (sha256(source) !== patch.originalHash || source !== patch.originalExcerpt) {
    throw new SectionAuthoringError("PP_PATCH_SOURCE_HASH_MISMATCH", "Patch의 원문 해시가 현재 source와 일치하지 않습니다.");
  }
  return patch.replacement;
}

export function adjudicate(input: AdjudicationInput): AdjudicationResult {
  if ((input.directedCrossReviewCount ?? 0) > 1) {
    throw new SectionAuthoringError("PP_AGENT_CROSS_REVIEW_LIMIT", "Directed cross-review는 한 번만 허용됩니다.");
  }
  if ((input.rebuttalCount ?? 0) > 1) {
    throw new SectionAuthoringError("PP_AGENT_REBUTTAL_LIMIT", "동일 finding의 rebuttal은 한 번만 허용됩니다.");
  }

  const changedInputHashes = new Set(input.changedInputHashes ?? []);
  const invalidated = input.findings.filter((finding) => changedInputHashes.has(finding.inputHash));
  const activeFindings = input.findings.filter((finding) => !changedInputHashes.has(finding.inputHash));
  const quarantinedRunIds = (input.runs ?? [])
    .filter((run) => run.status === "PARTIAL" || run.status === "TIMEOUT" || run.status === "QUARANTINED")
    .map(({ runId }) => runId);
  const hardBlocker = activeFindings.some((finding) => finding.severity === "blocker" && finding.authorityClass !== "editorial");
  const editorialHold = hasIndependentEditorialHold(activeFindings);
  const status = hardBlocker ? "BLOCKED" : editorialHold ? "EDITORIAL_REVIEW_REQUIRED" : "ACCEPT";

  return {
    status,
    receipt: {
      schemaVersion: "agent-adjudication/v1",
      decisions: activeFindings.map((finding) => ({
        findingId: finding.findingId,
        outcome: finding.severity === "blocker" ? "reject" : finding.proposedPatch === null ? "accept" : "modify",
        reason: finding.readerImpact,
      })),
    },
    quarantinedRunIds,
    invalidatedFindingIds: invalidated.map(({ findingId }) => findingId),
    reusableFindingIds: activeFindings.map(({ findingId }) => findingId),
  };
}

export async function approveRepresentativeSections(
  rootInput: string,
  approvals: readonly RepresentativeApproval[],
): Promise<{ readonly approvalPath: string; readonly roles: readonly RepresentativeRole[] }> {
  const root = resolve(rootInput);
  const expectedRoles: RepresentativeRole[] = ["problem", "method", "execution"];
  const byRole = new Map(approvals.map((approval) => [approval.representativeRole, approval]));
  if (byRole.size !== expectedRoles.length || !expectedRoles.every((role) => byRole.has(role))) {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_APPROVAL_REQUIRED", "문제·방법·실행 대표 섹션의 이름 있는 승인이 모두 필요합니다.");
  }
  for (const role of expectedRoles) {
    const approval = byRole.get(role)!;
    if (!approval.approvedBy.trim() || !approval.renderedPageContextPath.trim() || !hasIndependentRepresentativeFindings(approval.findingIds)) {
      throw new SectionAuthoringError("PP_REPRESENTATIVE_REVIEW_INCOMPLETE", "대표 섹션에는 rendered context, 독립 reviewer findings, 이름 있는 승인이 필요합니다.", { role });
    }
  }

  const approvalPath = join(root, "content", REPRESENTATIVE_APPROVAL_FILE_NAME);
  await writeJsonAtomically(approvalPath, {
    schemaVersion: "representative-section-approval/v1",
    approvals: expectedRoles.map((role) => byRole.get(role)),
  });
  return { approvalPath, roles: expectedRoles };
}

export async function authorFullDocument(rootInput: string): Promise<FullAuthoringResult> {
  const root = resolve(rootInput);
  const approvalPath = join(root, "content", REPRESENTATIVE_APPROVAL_FILE_NAME);
  let approvalInput: unknown;
  try {
    approvalInput = JSON.parse(await readFile(approvalPath, "utf8"));
  } catch {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_APPROVAL_REQUIRED", "전체 작성 전 대표 섹션 승인이 필요합니다.");
  }
  const approvals = extractApprovals(approvalInput);
  await approveRepresentativeSections(root, approvals);
  const requestPath = join(root, "content", FULL_AUTHORING_FILE_NAME);
  await writeJsonAtomically(requestPath, {
    schemaVersion: "full-section-authoring-request/v1",
    representativeApprovalPath: approvalPath,
    status: "READY_FOR_FULL_AUTHORING",
  });
  return { status: "READY_FOR_FULL_AUTHORING", requestPath };
}

export class SectionAuthoringError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SectionAuthoringError";
    this.code = code;
    this.details = details;
  }
}

function hasIndependentEditorialHold(findings: readonly ReviewerFinding[]): boolean {
  const byTarget = new Map<string, Set<string>>();
  for (const finding of findings) {
    if (finding.authorityClass !== "editorial" || finding.severity !== "editorial_hold") continue;
    const target = finding.target.sectionId ?? finding.target.claimId ?? finding.target.figureId;
    if (target === undefined) continue;
    const reviewers = byTarget.get(target) ?? new Set<string>();
    reviewers.add(finding.reviewerRole);
    byTarget.set(target, reviewers);
  }
  return [...byTarget.values()].some((reviewers) => reviewers.size >= 2);
}

function hasIndependentRepresentativeFindings(findingIds: readonly string[]): boolean {
  const required = ["prose", "evaluator", "compliance", "evidence", "visual"];
  return required.every((requiredRole) => findingIds.some((findingId) => findingId.toLowerCase().includes(requiredRole)));
}

function extractApprovals(input: unknown): RepresentativeApproval[] {
  if (typeof input !== "object" || input === null || !("approvals" in input) || !Array.isArray(input.approvals)) {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_APPROVAL_REQUIRED", "대표 섹션 승인 기록이 올바르지 않습니다.");
  }
  return input.approvals as RepresentativeApproval[];
}

function assertValidSectionPlan(plan: SectionPlanV1): void {
  const ids = new Set<string>();
  for (const section of plan.sections) {
    if (ids.has(section.sectionId)) {
      throw new SectionAuthoringError("PP_SECTION_PLAN_DUPLICATE", "Section ID는 고유해야 합니다.", { sectionId: section.sectionId });
    }
    ids.add(section.sectionId);
  }
}

function redactContext(value: string): string {
  return /secret|비밀|restricted proof/i.test(value) ? "[REDACTED]" : value;
}

function familyProfile(proposalClass: LivingProposalBriefV1["proposalClass"]): string {
  if (proposalClass === "research_service" || proposalClass === "academic_research" || proposalClass === "policy_research") {
    return "research-service";
  }
  if (proposalClass === "document_restyle") return "document-restyle";
  return "general-procurement";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
  } finally {
    if (created && !renamed) await rm(temporaryPath, { force: true });
  }
}
