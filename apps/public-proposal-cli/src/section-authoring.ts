import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { sha256File, verifyReceipt, writeReceipt } from "@longtable/kpp-core";
import { ReceiptSchema, ReviewerFindingV1Schema, type LivingProposalBriefV1, type SectionPlanItemV1, type SectionPlanV1 } from "@longtable/kpp-schemas";

const SECTION_PLAN_FILE_NAME = "section-plan.json";
const REPRESENTATIVE_APPROVAL_FILE_NAME = "representative-approval.json";
const FULL_AUTHORING_FILE_NAME = "full-authoring-request.json";
const AGENT_EXECUTION_FILE_NAME = "agent-execution-state.json";
const AGENT_EXECUTION_RECEIPT_FILE_NAME = "agent-execution-integrity.json";
const AGENT_EXECUTION_TEST_ANCHOR_FILE_NAME = "agent-execution-test-anchor.json";
const AGENT_EXECUTION_LOCK_DIRECTORY = ".agent-execution-state.lock";
const AGENT_EXECUTION_LOCK_ATTEMPTS = 400;
const AGENT_EXECUTION_LOCK_DELAY_MS = 5;

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
  readonly runId: string;
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
  readonly reviewerIdentity: string;
}

export interface AgentExecutionState {
  readonly schemaVersion: "agent-execution-state/v1";
  readonly stages: Readonly<Record<string, AgentStageExecutionState>>;
}

export interface AgentStageExecutionState {
  readonly runs: readonly AgentRun[];
  readonly findings: readonly ReviewerFinding[];
  readonly rebuttals: readonly { readonly findingId: string; readonly rebuttalId: string }[];
  readonly automaticRevisions: readonly { readonly sectionId: string; readonly revisionId: string }[];
}

export interface AdjudicationInput {
  readonly root: string;
  readonly stage: string;
  readonly changedInputHashes?: readonly string[];
  readonly integrityAdapter?: AgentExecutionIntegrityAdapter;
  readonly ledgerByteReader?: AgentExecutionLedgerByteReader;
}

export interface AgentExecutionIntegrityAdapter {
  write(root: string, ledgerPath: string): Promise<void>;
  verify(root: string, ledgerPath: string, ledgerSha256: string): Promise<void>;
}

export type AgentExecutionLedgerByteReader = (ledgerPath: string) => Promise<Uint8Array>;

export interface AgentExecutionOptions {
  readonly integrityAdapter?: AgentExecutionIntegrityAdapter;
  readonly ledgerByteReader?: AgentExecutionLedgerByteReader;
}

export interface AdjudicationResult {
  readonly status: "ACCEPT" | "EDITORIAL_REVIEW_REQUIRED" | "BLOCKED";
  readonly receipt: {
    readonly schemaVersion: "agent-adjudication/v1";
    readonly decisions: readonly { readonly findingId: string; readonly outcome: "accept" | "modify" | "reject"; readonly reason: string }[];
  };
  readonly quarantinedRunIds: readonly string[];
  readonly excludedFindingIds: readonly string[];
  readonly invalidatedFindingIds: readonly string[];
  readonly reusableFindingIds: readonly string[];
}

export interface MergeApprovedPatchOptions {
  readonly actor: "Proposal Editor" | string;
  readonly adjudication: "accept" | "modify" | "reject";
}

export interface RepresentativeApproval {
  readonly representativeRole: RepresentativeRole;
  readonly stage: string;
  readonly sectionId: string;
  readonly artifactHash: string;
  readonly inputHash: string;
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

export async function recordAgentRun(
  rootInput: string,
  input: { readonly stage: string; readonly run: AgentRun },
  options: AgentExecutionOptions = {},
): Promise<AgentRun> {
  const root = resolve(rootInput);
  assertValidAgentRun(input.run);
  return mutateAgentExecutionState(root, options.integrityAdapter ?? KppReceiptExecutionIntegrityAdapter, options.ledgerByteReader ?? readFile, (state) => {
    const stage = mutableStage(state, input.stage);
    if (stage.runs.some(({ runId }) => runId === input.run.runId)) {
      throw new SectionAuthoringError("PP_AGENT_RUN_DUPLICATE", "Agent run ID는 stage 안에서 고유해야 합니다.", { runId: input.run.runId });
    }
    if (stage.runs.length >= 12) {
      throw new SectionAuthoringError("PP_AGENT_STAGE_RUN_LIMIT", "한 stage에는 최대 12개의 agent run만 허용됩니다.", { stage: input.stage, limit: 12 });
    }
    if (!input.run.reviewerIdentity.trim()) {
      throw new SectionAuthoringError("PP_AGENT_REVIEWER_IDENTITY_REQUIRED", "Agent run에는 reviewer identity가 필요합니다.");
    }
    stage.runs.push({ ...input.run });
    return input.run;
  });
}

export async function recordReviewerFinding(
  rootInput: string,
  input: { readonly stage: string; readonly finding: ReviewerFinding },
  options: AgentExecutionOptions = {},
): Promise<ReviewerFinding> {
  const root = resolve(rootInput);
  const parsed = ReviewerFindingV1Schema.safeParse(input.finding);
  if (!parsed.success) {
    throw new SectionAuthoringError("PP_REVIEWER_FINDING_INVALID", "Reviewer finding 형식이 올바르지 않습니다.", { actual: parsed.error.issues });
  }
  return mutateAgentExecutionState(root, options.integrityAdapter ?? KppReceiptExecutionIntegrityAdapter, options.ledgerByteReader ?? readFile, (state) => {
    const stage = mutableStage(state, input.stage);
    if (stage.findings.some(({ findingId }) => findingId === input.finding.findingId)) {
      throw new SectionAuthoringError("PP_REVIEWER_FINDING_DUPLICATE", "Reviewer finding ID는 stage 안에서 고유해야 합니다.", { findingId: input.finding.findingId });
    }
    const run = stage.runs.find(({ runId }) => runId === input.finding.runId);
    assertFindingRunBinding(input.finding, run);
    stage.findings.push(copyFinding(input.finding));
    return input.finding;
  });
}

export async function recordFindingRebuttal(
  rootInput: string,
  input: { readonly stage: string; readonly findingId: string; readonly rebuttalId: string },
  options: AgentExecutionOptions = {},
): Promise<void> {
  const root = resolve(rootInput);
  await mutateAgentExecutionState(root, options.integrityAdapter ?? KppReceiptExecutionIntegrityAdapter, options.ledgerByteReader ?? readFile, (state) => {
    const stage = mutableStage(state, input.stage);
    if (!stage.findings.some(({ findingId }) => findingId === input.findingId)) {
      throw new SectionAuthoringError("PP_AGENT_REBUTTAL_FINDING_UNKNOWN", "Rebuttal은 저장된 reviewer finding에만 연결할 수 있습니다.", { findingId: input.findingId });
    }
    if (stage.rebuttals.some(({ rebuttalId }) => rebuttalId === input.rebuttalId)) {
      throw new SectionAuthoringError("PP_AGENT_REBUTTAL_DUPLICATE", "Rebuttal ID는 stage 안에서 고유해야 합니다.", { rebuttalId: input.rebuttalId });
    }
    if (stage.rebuttals.some(({ findingId }) => findingId === input.findingId)) {
      throw new SectionAuthoringError("PP_AGENT_REBUTTAL_LIMIT", "동일 finding의 rebuttal은 한 번만 허용됩니다.", { findingId: input.findingId, limit: 1 });
    }
    stage.rebuttals.push({ findingId: input.findingId, rebuttalId: input.rebuttalId });
  });
}

export async function recordAutomaticSectionRevision(
  rootInput: string,
  input: { readonly stage: string; readonly sectionId: string; readonly revisionId: string },
  options: AgentExecutionOptions = {},
): Promise<void> {
  const root = resolve(rootInput);
  await mutateAgentExecutionState(root, options.integrityAdapter ?? KppReceiptExecutionIntegrityAdapter, options.ledgerByteReader ?? readFile, (state) => {
    const stage = mutableStage(state, input.stage);
    if (stage.automaticRevisions.some(({ revisionId }) => revisionId === input.revisionId)) {
      throw new SectionAuthoringError("PP_SECTION_AUTO_REVISION_DUPLICATE", "Automatic revision ID는 stage 안에서 고유해야 합니다.", { revisionId: input.revisionId });
    }
    if (stage.automaticRevisions.filter(({ sectionId }) => sectionId === input.sectionId).length >= 2) {
      throw new SectionAuthoringError("PP_SECTION_AUTO_REVISION_LIMIT", "동일 section의 자동 수정은 두 번만 허용됩니다.", { sectionId: input.sectionId, limit: 2 });
    }
    stage.automaticRevisions.push({ sectionId: input.sectionId, revisionId: input.revisionId });
  });
}

export async function adjudicate(input: AdjudicationInput): Promise<AdjudicationResult> {
  assertNoCallerSuppliedAdjudicationRecords(input);
  const root = resolve(input.root);
  const state = await readLockedAgentExecutionState(
    root,
    input.integrityAdapter ?? KppReceiptExecutionIntegrityAdapter,
    input.ledgerByteReader ?? readFile,
  );
  const stage = state.stages[input.stage];
  if (stage === undefined) {
    throw new SectionAuthoringError("PP_AGENT_ADJUDICATION_STAGE_UNKNOWN", "Adjudication할 persisted stage를 찾을 수 없습니다.", { stage: input.stage });
  }
  const runsById = new Map(stage.runs.map((run) => [run.runId, run]));
  const changedInputHashes = new Set(input.changedInputHashes ?? []);
  const invalidated: ReviewerFinding[] = [];
  const excluded: ReviewerFinding[] = [];
  const activeFindings: ReviewerFinding[] = [];
  for (const finding of stage.findings) {
    const run = runsById.get(finding.runId);
    assertFindingRunBinding(finding, run, "PP_FINDING_RUN_UNVERIFIED");
    if (run.status !== "SUCCEEDED") {
      excluded.push(finding);
    } else if (changedInputHashes.has(finding.inputHash)) {
      invalidated.push(finding);
    } else {
      activeFindings.push(finding);
    }
  }
  const quarantinedRunIds = stage.runs
    .filter((run) => run.status !== "SUCCEEDED")
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
    excludedFindingIds: excluded.map(({ findingId }) => findingId),
    invalidatedFindingIds: invalidated.map(({ findingId }) => findingId),
    reusableFindingIds: activeFindings.map(({ findingId }) => findingId),
  };
}

export async function approveRepresentativeSections(
  rootInput: string,
  approvals: readonly RepresentativeApproval[],
  options: AgentExecutionOptions = {},
): Promise<{ readonly approvalPath: string; readonly roles: readonly RepresentativeRole[] }> {
  const root = resolve(rootInput);
  const integrityAdapter = options.integrityAdapter ?? KppReceiptExecutionIntegrityAdapter;
  const executionState = await readLockedAgentExecutionState(root, integrityAdapter, options.ledgerByteReader ?? readFile);
  const expectedRoles: RepresentativeRole[] = ["problem", "method", "execution"];
  const byRole = new Map(approvals.map((approval) => [approval.representativeRole, approval]));
  if (byRole.size !== expectedRoles.length || !expectedRoles.every((role) => byRole.has(role))) {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_APPROVAL_REQUIRED", "문제·방법·실행 대표 섹션의 이름 있는 승인이 모두 필요합니다.");
  }
  for (const role of expectedRoles) {
    const approval = byRole.get(role)!;
    if (!approval.approvedBy.trim() || !approval.renderedPageContextPath.trim()) {
      throw new SectionAuthoringError("PP_REPRESENTATIVE_REVIEW_INCOMPLETE", "대표 섹션에는 rendered context, 독립 reviewer findings, 이름 있는 승인이 필요합니다.", { role });
    }
    verifyRepresentativeFindings(approval, executionState);
  }

  const approvalPath = join(root, "content", REPRESENTATIVE_APPROVAL_FILE_NAME);
  await writeJsonAtomically(approvalPath, {
    schemaVersion: "representative-section-approval/v1",
    approvals: expectedRoles.map((role) => byRole.get(role)),
  });
  if (integrityAdapter === KppReceiptExecutionIntegrityAdapter) {
    await writeCanonicalRepresentativeReviewReceiptWhenAvailable(root, approvalPath);
  }
  return { approvalPath, roles: expectedRoles };
}

export async function authorFullDocument(rootInput: string, options: AgentExecutionOptions = {}): Promise<FullAuthoringResult> {
  const root = resolve(rootInput);
  const approvalPath = join(root, "content", REPRESENTATIVE_APPROVAL_FILE_NAME);
  let approvalInput: unknown;
  try {
    approvalInput = JSON.parse(await readFile(approvalPath, "utf8"));
  } catch {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_APPROVAL_REQUIRED", "전체 작성 전 대표 섹션 승인이 필요합니다.");
  }
  const approvals = extractApprovals(approvalInput);
  await approveRepresentativeSections(root, approvals, options);
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

function verifyRepresentativeFindings(approval: RepresentativeApproval, state: MutableAgentExecutionState): void {
  const stage = state.stages[approval.stage];
  if (stage === undefined) {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_FINDING_UNVERIFIED", "대표 섹션 reviewer finding 기록이 없습니다.", { stage: approval.stage });
  }
  const findingIds = new Set(approval.findingIds);
  if (findingIds.size !== 5 || approval.findingIds.length !== 5) {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_FINDING_UNVERIFIED", "대표 섹션에는 다섯 개의 독립 reviewer finding이 필요합니다.");
  }
  const categories = new Set<RepresentativeFindingCategory>();
  const reviewerIdentities = new Set<string>();
  const runIds = new Set<string>();
  for (const findingId of approval.findingIds) {
    const finding = stage.findings.find((entry) => entry.findingId === findingId);
    if (finding === undefined) {
      throw new SectionAuthoringError("PP_REPRESENTATIVE_FINDING_UNVERIFIED", "대표 승인에 연결된 reviewer finding을 찾을 수 없습니다.", { findingId });
    }
    if (finding.target.sectionId !== approval.sectionId
      || finding.artifactHash !== approval.artifactHash
      || finding.inputHash !== approval.inputHash) {
      throw new SectionAuthoringError("PP_REPRESENTATIVE_FINDING_MISMATCH", "Reviewer finding이 대표 section/artifact/input과 일치하지 않습니다.", { findingId });
    }
    const run = stage.runs.find((entry) => entry.runId === finding.runId);
    assertEligibleFindingRun(finding, run, "PP_REPRESENTATIVE_FINDING_RUN_INELIGIBLE");
    const category = representativeFindingCategory(finding.reviewerRole);
    if (category === undefined || categories.has(category) || reviewerIdentities.has(run.reviewerIdentity) || runIds.has(run.runId)) {
      throw new SectionAuthoringError("PP_REPRESENTATIVE_FINDING_INDEPENDENCE", "대표 승인 reviewer는 다섯 역할과 run identity에서 독립적이어야 합니다.", { findingId });
    }
    categories.add(category);
    reviewerIdentities.add(run.reviewerIdentity);
    runIds.add(run.runId);
  }
  const required: RepresentativeFindingCategory[] = ["prose", "evaluator", "compliance", "evidence", "visual"];
  if (!required.every((category) => categories.has(category))) {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_FINDING_INDEPENDENCE", "대표 승인은 prose, evaluator, compliance, evidence, visual 역할을 각각 포함해야 합니다.");
  }
}

type RepresentativeFindingCategory = "prose" | "evaluator" | "compliance" | "evidence" | "visual";

function representativeFindingCategory(reviewerRole: string): RepresentativeFindingCategory | undefined {
  switch (reviewerRole) {
    case "Korean Prose Reviewer": return "prose";
    case "Evaluator Red Team": return "evaluator";
    case "RFP/Compliance Reviewer": return "compliance";
    case "Methods/Evidence Reviewer":
    case "Institutional Evidence and Data Reviewer": return "evidence";
    case "Visual/Render Reviewer": return "visual";
    default: return undefined;
  }
}

function extractApprovals(input: unknown): RepresentativeApproval[] {
  if (typeof input !== "object" || input === null || !("approvals" in input) || !Array.isArray(input.approvals)) {
    throw new SectionAuthoringError("PP_REPRESENTATIVE_APPROVAL_REQUIRED", "대표 섹션 승인 기록이 올바르지 않습니다.");
  }
  return input.approvals as RepresentativeApproval[];
}

interface MutableAgentExecutionState {
  schemaVersion: "agent-execution-state/v1";
  stages: Record<string, MutableAgentStageExecutionState>;
}

interface MutableAgentStageExecutionState {
  runs: AgentRun[];
  findings: ReviewerFinding[];
  rebuttals: { findingId: string; rebuttalId: string }[];
  automaticRevisions: { sectionId: string; revisionId: string }[];
}

const AgentRunV1Schema = z.object({
  runId: z.string().min(1),
  status: z.enum(["SUCCEEDED", "PARTIAL", "TIMEOUT", "QUARANTINED"]),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/i),
  reviewerIdentity: z.string().min(1),
}).strict();

const AgentExecutionStateV1Schema = z.object({
  schemaVersion: z.literal("agent-execution-state/v1"),
  stages: z.record(z.string().min(1), z.object({
    runs: z.array(AgentRunV1Schema),
    findings: z.array(ReviewerFindingV1Schema),
    rebuttals: z.array(z.object({ findingId: z.string().min(1), rebuttalId: z.string().min(1) }).strict()),
    automaticRevisions: z.array(z.object({ sectionId: z.string().min(1), revisionId: z.string().min(1) }).strict()),
  }).strict()),
}).strict();

function parseAgentExecutionState(ledgerPath: string, ledgerBytes: Uint8Array): MutableAgentExecutionState {
  try {
    const parsed = AgentExecutionStateV1Schema.safeParse(JSON.parse(Buffer.from(ledgerBytes).toString("utf8")));
    if (!parsed.success) {
      throw new SectionAuthoringError("PP_AGENT_EXECUTION_STATE_INVALID", "Agent execution state 형식이 올바르지 않습니다.", {
        path: ledgerPath,
        actual: parsed.error.issues,
      });
    }
    return parsed.data as MutableAgentExecutionState;
  } catch (error) {
    if (error instanceof SectionAuthoringError) throw error;
    throw new SectionAuthoringError("PP_AGENT_EXECUTION_STATE_INVALID", "Agent execution state를 읽을 수 없습니다.", {
      path: ledgerPath,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

async function writeAgentExecutionState(root: string, state: MutableAgentExecutionState): Promise<void> {
  await writeJsonAtomically(join(root, "content", AGENT_EXECUTION_FILE_NAME), state);
}

const KppReceiptExecutionIntegrityAdapter: AgentExecutionIntegrityAdapter = {
  async write(root, ledgerPath): Promise<void> {
    const output = join(root, "receipts", AGENT_EXECUTION_RECEIPT_FILE_NAME);
    await writeReceipt({
      stage: "REPRESENTATIVE_REVIEW_REQUIRED",
      files: [ledgerPath],
      inputReceiptHashes: await currentProjectReceiptInputs(root),
      output,
      toolVersion: "public-proposal-agent-execution/v1",
    });
  },
  async verify(root, ledgerPath, ledgerSha256): Promise<void> {
    const receiptPath = join(root, "receipts", AGENT_EXECUTION_RECEIPT_FILE_NAME);
    try {
      const receiptInput = JSON.parse(await readFile(receiptPath, "utf8"));
      const receipt = ReceiptSchema.parse(receiptInput);
      const boundLedger = receipt.files.find((file) => file.path === ledgerPath);
      if (receipt.files.length !== 1
        || receipt.stage !== "REPRESENTATIVE_REVIEW_REQUIRED"
        || receipt.result !== "PASS"
        || boundLedger?.sha256 !== ledgerSha256) {
        throw new SectionAuthoringError("PP_AGENT_EXECUTION_INTEGRITY_FAILED", "Agent execution ledger receipt가 현재 ledger bytes와 일치하지 않습니다.", {
          ledgerPath,
          receiptPath,
          expected: boundLedger?.sha256,
          actual: ledgerSha256,
        });
      }
    } catch (error) {
      if (error instanceof SectionAuthoringError) throw error;
      throw new SectionAuthoringError("PP_AGENT_EXECUTION_INTEGRITY_FAILED", "Agent execution ledger receipt를 검증할 수 없습니다.", {
        ledgerPath,
        receiptPath,
        actual: error instanceof Error ? error.message : error,
      });
    }
  },
};

/** Explicit adapter for isolated temp-root tests; its anchor remains outside the mutable ledger. */
export function createTestAgentExecutionIntegrityAdapter(): AgentExecutionIntegrityAdapter {
  return {
    async write(root, ledgerPath): Promise<void> {
      await writeJsonAtomically(join(root, "content", AGENT_EXECUTION_TEST_ANCHOR_FILE_NAME), {
        schemaVersion: "agent-execution-test-anchor/v1",
        ledgerPath,
        sha256: await sha256File(ledgerPath),
      });
    },
    async verify(root, ledgerPath, ledgerSha256): Promise<void> {
      const anchorPath = join(root, "content", AGENT_EXECUTION_TEST_ANCHOR_FILE_NAME);
      try {
        const raw = JSON.parse(await readFile(anchorPath, "utf8")) as { schemaVersion?: unknown; ledgerPath?: unknown; sha256?: unknown };
        if (raw.schemaVersion !== "agent-execution-test-anchor/v1" || raw.ledgerPath !== ledgerPath || raw.sha256 !== ledgerSha256) {
          throw new SectionAuthoringError("PP_AGENT_EXECUTION_INTEGRITY_FAILED", "Test execution ledger anchor가 현재 ledger bytes와 일치하지 않습니다.", {
            ledgerPath,
            anchorPath,
            expected: raw.sha256,
            actual: ledgerSha256,
          });
        }
      } catch (error) {
        if (error instanceof SectionAuthoringError) throw error;
        throw new SectionAuthoringError("PP_AGENT_EXECUTION_INTEGRITY_FAILED", "Test execution ledger anchor를 검증할 수 없습니다.", {
          ledgerPath,
          anchorPath,
          actual: error instanceof Error ? error.message : error,
        });
      }
    },
  };
}

async function readLockedAgentExecutionState(
  root: string,
  integrityAdapter: AgentExecutionIntegrityAdapter,
  ledgerByteReader: AgentExecutionLedgerByteReader,
): Promise<MutableAgentExecutionState> {
  return withAgentExecutionStateLock(root, async () => {
    const ledgerPath = agentExecutionStatePath(root);
    return readVerifiedAgentExecutionState(root, ledgerPath, integrityAdapter, ledgerByteReader);
  });
}

async function mutateAgentExecutionState<T>(
  root: string,
  integrityAdapter: AgentExecutionIntegrityAdapter,
  ledgerByteReader: AgentExecutionLedgerByteReader,
  mutate: (state: MutableAgentExecutionState) => T,
): Promise<T> {
  return withAgentExecutionStateLock(root, async () => {
    const ledgerPath = agentExecutionStatePath(root);
    const state = await readVerifiedAgentExecutionState(root, ledgerPath, integrityAdapter, ledgerByteReader);
    const result = mutate(state);
    await writeAgentExecutionState(root, state);
    await integrityAdapter.write(root, ledgerPath);
    return result;
  });
}

async function readVerifiedAgentExecutionState(
  root: string,
  ledgerPath: string,
  integrityAdapter: AgentExecutionIntegrityAdapter,
  ledgerByteReader: AgentExecutionLedgerByteReader,
): Promise<MutableAgentExecutionState> {
  let ledgerBytes: Uint8Array;
  try {
    ledgerBytes = await ledgerByteReader(ledgerPath);
  } catch (error) {
    if (isFileMissing(error)) {
      return { schemaVersion: "agent-execution-state/v1", stages: {} };
    }
    throw new SectionAuthoringError("PP_AGENT_EXECUTION_STATE_INVALID", "Agent execution state를 읽을 수 없습니다.", {
      path: ledgerPath,
      actual: error instanceof Error ? error.message : error,
    });
  }

  const ledgerSha256 = sha256Bytes(ledgerBytes);
  await integrityAdapter.verify(root, ledgerPath, ledgerSha256);
  return parseAgentExecutionState(ledgerPath, ledgerBytes);
}

function agentExecutionStatePath(root: string): string {
  return join(root, "content", AGENT_EXECUTION_FILE_NAME);
}

async function currentProjectReceiptInputs(root: string): Promise<string[]> {
  const candidates = [
    "design-lock.json",
    "research-bundle-lock.json",
    "brief-lock.json",
    "evidence-lock.json",
    "requirements-lock.json",
    "source-lock.json",
  ];
  for (const filename of candidates) {
    const receiptPath = join(root, "receipts", filename);
    try {
      const verification = await verifyReceipt(receiptPath);
      if (verification.valid && verification.receipt.result === "PASS") return [await sha256File(receiptPath)];
    } catch {
      // The project may be an isolated authoring root with no KPP receipt chain yet.
    }
  }
  return [];
}

async function writeCanonicalRepresentativeReviewReceiptWhenAvailable(root: string, approvalPath: string): Promise<void> {
  const designLockPath = join(root, "receipts", "design-lock.json");
  let designLockHash: string;
  try {
    const designLock = await verifyReceipt(designLockPath);
    if (!designLock.valid || designLock.receipt.stage !== "DESIGN_LOCKED" || designLock.receipt.result !== "PASS") return;
    designLockHash = await sha256File(designLockPath);
  } catch {
    return;
  }
  const ledgerPath = agentExecutionStatePath(root);
  const anchorPath = join(root, "receipts", AGENT_EXECUTION_RECEIPT_FILE_NAME);
  const anchorHash = await sha256File(anchorPath);
  await writeReceipt({
    stage: "REPRESENTATIVE_REVIEW_REQUIRED",
    files: [approvalPath, ledgerPath],
    inputs: [{ name: "agent-execution-integrity", path: anchorPath, sha256: anchorHash }],
    inputReceiptHashes: [designLockHash, anchorHash],
    output: join(root, "receipts", "representative-review.json"),
    toolVersion: "public-proposal-agent-execution/v1",
  });
}

async function withAgentExecutionStateLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = join(root, "content", AGENT_EXECUTION_LOCK_DIRECTORY);
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < AGENT_EXECUTION_LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        return await operation();
      } finally {
        await rm(lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await delay(AGENT_EXECUTION_LOCK_DELAY_MS);
    }
  }
  throw new SectionAuthoringError("PP_AGENT_EXECUTION_LOCK_TIMEOUT", "Agent execution state lock을 획득하지 못했습니다.", { root });
}

function mutableStage(state: MutableAgentExecutionState, stageId: string): MutableAgentStageExecutionState {
  const existing = state.stages[stageId];
  if (existing !== undefined) return existing;
  const created: MutableAgentStageExecutionState = { runs: [], findings: [], rebuttals: [], automaticRevisions: [] };
  state.stages[stageId] = created;
  return created;
}

function assertEligibleFindingRun(
  finding: ReviewerFinding,
  run: AgentRun | undefined,
  code = "PP_FINDING_RUN_INELIGIBLE",
): asserts run is AgentRun {
  assertFindingRunBinding(finding, run, code);
  if (run.status !== "SUCCEEDED") {
    throw new SectionAuthoringError(code, "QUARANTINED, PARTIAL, TIMEOUT run의 finding은 사용할 수 없습니다.", {
      findingId: finding.findingId,
      runId: finding.runId,
      status: run.status,
    });
  }
}

function assertValidAgentRun(run: AgentRun): void {
  const parsed = AgentRunV1Schema.safeParse(run);
  if (!parsed.success) {
    throw new SectionAuthoringError("PP_AGENT_RUN_INVALID", "Agent run 형식이 올바르지 않습니다.", { actual: parsed.error.issues });
  }
}

function assertNoCallerSuppliedAdjudicationRecords(input: AdjudicationInput): void {
  const candidate = input as unknown as Record<string, unknown>;
  if ("findings" in candidate || "runs" in candidate) {
    throw new SectionAuthoringError("PP_ADJUDICATION_CALLER_RECORDS_FORBIDDEN", "Adjudication은 caller-provided findings/runs가 아니라 persisted execution ledger만 사용합니다.");
  }
}

function assertFindingRunBinding(
  finding: ReviewerFinding,
  run: AgentRun | undefined,
  code = "PP_FINDING_RUN_UNVERIFIED",
): asserts run is AgentRun {
  if (run === undefined || run.inputHash !== finding.inputHash) {
    throw new SectionAuthoringError(code, "Reviewer finding은 같은 input hash의 실제 agent run에 연결되어야 합니다.", {
      findingId: finding.findingId,
      runId: finding.runId,
    });
  }
}

function copyFinding(finding: ReviewerFinding): ReviewerFinding {
  return {
    ...finding,
    target: { ...finding.target },
    evidence: [...finding.evidence],
    dependencies: [...finding.dependencies],
    proposedPatch: finding.proposedPatch === null ? null : {
      ...finding.proposedPatch,
      evidenceIds: [...finding.proposedPatch.evidenceIds],
      affectedRequirementIds: [...finding.proposedPatch.affectedRequirementIds],
    },
  };
}

function isFileMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
