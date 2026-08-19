import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SectionPlanItemV1 } from "@longtable/kpp-schemas";
import {
  approveRepresentativeSections,
  authorFullDocument,
  buildAgentPacket,
  createSectionPlan,
  adjudicate,
  mergeApprovedPatch,
  recordAgentRun,
  recordAutomaticSectionRevision,
  recordFindingRebuttal,
  recordReviewerFinding,
} from "../src/section-authoring.js";

describe("section-centered authoring", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it("builds a positive, read-only writer packet without page or evaluator metadata", () => {
    const packet = buildAgentPacket({
      inputHash: hash("packet"),
      brief: brief(),
      section: section("problem"),
      researchBundleIds: ["bundle-1"],
      outputDirectory: "/tmp/proposal-agent-output",
      securityClass: "PROJECT_CONFIDENTIAL",
    });

    expect(packet.doctrine).toHaveLength(6);
    expect(packet).toMatchObject({
      inputHash: hash("packet"),
      allowedPurpose: "author_section",
      readerTasks: ["실행 가능성을 판단한다."],
      sectionPurpose: "문제와 필요성을 설명한다.",
      allowedClaimIds: ["claim-1"],
      allowedEvidenceIds: ["evidence-1"],
      openDecisionIds: ["decision-open"],
      approvedReferences: ["reference-1", "reference-2"],
      familyProfile: "general-procurement",
      researchBundleIds: ["bundle-1"],
      outputDirectory: "/tmp/proposal-agent-output",
      securityClass: "PROJECT_CONFIDENTIAL",
    });
    expect("pageId" in packet).toBe(false);
    expect("evaluatorAnswer" in packet).toBe(false);
    expect(JSON.stringify(packet)).not.toContain("secret source text");
  });

  it("persists a section plan that does not require legacy page metadata", async () => {
    const root = await createRoot(temporaryDirectories);
    const plan = await createSectionPlan({ root, projectId: "project-1", sections: [section("problem"), section("method"), section("execution")] });

    expect(plan.sections.map(({ representativeRole }) => representativeRole)).toEqual(["problem", "method", "execution"]);
    const persisted = JSON.parse(await readFile(join(root, "content", "section-plan.json"), "utf8")) as Record<string, unknown>;
    expect(persisted).toMatchObject({ schemaVersion: "section-plan/v1", projectId: "project-1" });
    expect(JSON.stringify(persisted)).not.toContain("pageId");
    expect(JSON.stringify(persisted)).not.toContain("evaluatorAnswer");
  });

  it("requires two independent editorial findings before a prose hold", () => {
    const findings = [finding("Korean Prose Reviewer", "section-1"), finding("Evaluator Red Team", "section-1")];
    const decision = adjudicate({
      findings,
      runs: successfulRuns(findings),
    });

    expect(decision.status).toBe("EDITORIAL_REVIEW_REQUIRED");
    expect(decision.receipt.decisions).toHaveLength(2);
  });

  it("does not let a single editorial reviewer hold a section and blocks hard authority violations", () => {
    const prose = finding("Korean Prose Reviewer", "section-1");
    const compliance = finding("RFP/Compliance Reviewer", "section-1", "issuer", "blocker");
    expect(adjudicate({ findings: [prose], runs: successfulRuns([prose]) }).status).toBe("ACCEPT");
    expect(adjudicate({ findings: [compliance], runs: successfulRuns([compliance]) })).toMatchObject({
      status: "BLOCKED",
    });
  });

  it("allows only Proposal Editor to merge a hash-bound approved patch", () => {
    const source = "현재 문단";
    const patch = {
      originalExcerpt: source,
      originalHash: hash(source),
      replacement: "수정된 문단",
      reason: "근거 범위를 명확히 한다.",
      evidenceIds: ["evidence-1"],
      affectedRequirementIds: ["requirement-1"],
      risk: "low",
    };

    expect(mergeApprovedPatch(source, patch, { actor: "Proposal Editor", adjudication: "accept" })).toBe("수정된 문단");
    expect(() => mergeApprovedPatch(source, patch, { actor: "Korean Prose Reviewer", adjudication: "accept" })).toThrow(
      expect.objectContaining({ code: "PP_PATCH_EDITOR_ONLY" }),
    );
    expect(() => mergeApprovedPatch("changed", patch, { actor: "Proposal Editor", adjudication: "accept" })).toThrow(
      expect.objectContaining({ code: "PP_PATCH_SOURCE_HASH_MISMATCH" }),
    );
  });

  it("blocks full authoring until all three representative roles are approved", async () => {
    const root = await createRoot(temporaryDirectories);
    await expect(authorFullDocument(root)).rejects.toMatchObject({ code: "PP_REPRESENTATIVE_APPROVAL_REQUIRED" });

    await expect(approveRepresentativeSections(root, [
      approval("problem"),
      approval("method"),
    ])).rejects.toMatchObject({ code: "PP_REPRESENTATIVE_APPROVAL_REQUIRED" });

    const approvals = await Promise.all(REPRESENTATIVE_ROLES.map((role) => persistRepresentativeEvidence(root, role)));
    await approveRepresentativeSections(root, approvals);
    await expect(authorFullDocument(root)).resolves.toMatchObject({ status: "READY_FOR_FULL_AUTHORING" });
  });

  it("rejects bare finding words and requires persisted independent records bound to the representative artifact", async () => {
    const root = await createRoot(temporaryDirectories);
    const fakeApprovals = REPRESENTATIVE_ROLES.map((role) => approval(role));

    await expect(approveRepresentativeSections(root, fakeApprovals)).rejects.toMatchObject({
      code: "PP_REPRESENTATIVE_FINDING_UNVERIFIED",
    });
  });

  it("quarantines partial runs and invalidates only findings whose input changed", () => {
    const result = adjudicate({
      findings: [
        { ...finding("Korean Prose Reviewer", "section-1"), inputHash: hash("changed"), runId: "partial" },
        { ...finding("Visual/Render Reviewer", "section-2", "visual"), inputHash: hash("stable"), runId: "stable" },
      ],
      runs: [
        { runId: "partial", status: "PARTIAL", inputHash: hash("changed"), reviewerIdentity: "partial-reviewer" },
        { runId: "timeout", status: "TIMEOUT", inputHash: hash("changed"), reviewerIdentity: "timeout-reviewer" },
        { runId: "stable", status: "SUCCEEDED", inputHash: hash("stable"), reviewerIdentity: "stable-reviewer" },
      ],
      changedInputHashes: [hash("changed")],
    });

    expect(result.quarantinedRunIds).toEqual(["partial", "timeout"]);
    expect(result.excludedFindingIds).toEqual(["Korean Prose Reviewer-section-1"]);
    expect(result.invalidatedFindingIds).toEqual([]);
    expect(result.reusableFindingIds).toEqual(["Visual/Render Reviewer-section-2"]);
  });

  it("excludes a quarantined finding from adjudication so it cannot block or be accepted", () => {
    const quarantined = { ...finding("RFP/Compliance Reviewer", "section-1", "issuer", "blocker"), runId: "quarantined" };
    const result = adjudicate({
      findings: [quarantined],
      runs: [{ runId: "quarantined", status: "QUARANTINED", inputHash: quarantined.inputHash, reviewerIdentity: "agent-q" }],
    });

    expect(result.status).toBe("ACCEPT");
    expect(result.excludedFindingIds).toEqual([quarantined.findingId]);
    expect(result.receipt.decisions).toEqual([]);
  });

  it("persists and enforces per-stage run, finding rebuttal, and section revision limits", async () => {
    const root = await createRoot(temporaryDirectories);
    for (let index = 0; index < 12; index += 1) {
      await expect(recordAgentRun(root, {
        stage: "representative",
        run: { runId: `run-${index}`, status: "SUCCEEDED", inputHash: hash(`run-${index}`), reviewerIdentity: `agent-${index}` },
      })).resolves.toMatchObject({ runId: `run-${index}` });
    }
    await expect(recordAgentRun(root, {
      stage: "representative",
      run: { runId: "run-12", status: "SUCCEEDED", inputHash: hash("run-12"), reviewerIdentity: "agent-12" },
    })).rejects.toMatchObject({ code: "PP_AGENT_STAGE_RUN_LIMIT" });

    const persistedFinding = {
      ...finding("Korean Prose Reviewer", "section-1", "editorial", "warning"),
      runId: "run-0",
      inputHash: hash("run-0"),
    };
    await recordReviewerFinding(root, {
      stage: "representative",
      finding: persistedFinding,
    });
    await expect(recordFindingRebuttal(root, { stage: "representative", findingId: persistedFinding.findingId, rebuttalId: "rebuttal-1" })).resolves.toBeUndefined();
    await expect(recordFindingRebuttal(root, { stage: "representative", findingId: persistedFinding.findingId, rebuttalId: "rebuttal-2" }))
      .rejects.toMatchObject({ code: "PP_AGENT_REBUTTAL_LIMIT" });

    await expect(recordAutomaticSectionRevision(root, { stage: "representative", sectionId: "section-1", revisionId: "revision-1" })).resolves.toBeUndefined();
    await expect(recordAutomaticSectionRevision(root, { stage: "representative", sectionId: "section-1", revisionId: "revision-2" })).resolves.toBeUndefined();
    await expect(recordAutomaticSectionRevision(root, { stage: "representative", sectionId: "section-1", revisionId: "revision-3" }))
      .rejects.toMatchObject({ code: "PP_SECTION_AUTO_REVISION_LIMIT" });
  });
});

const REPRESENTATIVE_ROLES = ["problem", "method", "execution"] as const;

function brief() {
  return {
    schemaVersion: "living-proposal-brief/v1" as const,
    projectId: "project-1",
    proposalClass: "general_procurement" as const,
    problem: "공고 요구사항에 맞는 실행 제안이 필요하다.",
    primaryReaders: [{ reader: "평가위원", task: "실행 가능성을 판단한다." }],
    doctrineVersion: "positive-doctrine/v1",
    evidenceBoundary: ["verified evidence only", "secret source text"],
    activeDecisions: [],
    openDecisions: [{ decisionId: "decision-open", question: "실행 순서를 확정한다.", affects: ["section-1"], critical: false }],
    approvedReferences: [
      { referenceId: "reference-1", sourcePath: "/reference-1", sourceSha256: hash("reference-1"), useBoundary: "문체 참고" },
      { referenceId: "reference-2", sourcePath: "/reference-2", sourceSha256: hash("reference-2"), useBoundary: "구성 참고" },
    ],
    nextHumanGate: "대표 섹션 승인",
  };
}

function section(representativeRole: "problem" | "method" | "execution"): SectionPlanItemV1 {
  return {
    sectionId: `section-${representativeRole}`,
    parentSectionId: null,
    purpose: representativeRole === "problem" ? "문제와 필요성을 설명한다." : `${representativeRole} 대표 섹션을 작성한다.`,
    readerTasks: ["실행 가능성을 판단한다."],
    requirementIds: ["requirement-1"],
    claimIds: ["claim-1"],
    evidenceIds: ["evidence-1"],
    argumentMoves: ["problem", "evidence", "action"],
    visualNeeds: [],
    openDecisionIds: ["decision-open"],
    representativeRole,
  };
}

function finding(
  reviewerRole: string,
  sectionId: string,
  authorityClass: "issuer" | "evidence" | "method" | "editorial" | "visual" | "privacy" | "release" = "editorial",
  severity: "blocker" | "editorial_hold" | "warning" = "editorial_hold",
) {
  return {
    findingId: `${reviewerRole}-${sectionId}`,
    reviewerRole,
    runId: `run-${reviewerRole}-${sectionId}`,
    inputHash: hash(`${reviewerRole}-${sectionId}-input`),
    artifactHash: hash(`${reviewerRole}-${sectionId}-artifact`),
    target: { sectionId },
    authorityClass,
    severity,
    readerImpact: "평가자가 실행 근거를 판단할 수 없다.",
    evidence: ["evidence-1"],
    proposedPatch: null,
    confidence: 0.9,
    dependencies: [],
  };
}

function approval(role: "problem" | "method" | "execution") {
  return {
    representativeRole: role,
    stage: `representative-${role}`,
    sectionId: `section-${role}`,
    artifactHash: hash(`artifact-${role}`),
    inputHash: hash(`input-${role}`),
    approvedBy: "proposal-owner",
    approvedAt: "2026-08-19T00:00:00.000Z",
    renderedPageContextPath: `/rendered/${role}.pdf`,
    findingIds: ["prose", "evaluator", "compliance", "evidence", "visual"],
  };
}

function successfulRuns(findings: readonly ReturnType<typeof finding>[]) {
  return findings.map((entry) => ({
    runId: entry.runId,
    status: "SUCCEEDED" as const,
    inputHash: entry.inputHash,
    reviewerIdentity: `agent-${entry.reviewerRole}`,
  }));
}

async function persistRepresentativeEvidence(
  root: string,
  role: "problem" | "method" | "execution",
) {
  const base = approval(role);
  const reviewerInputs: Array<[
    string,
    "issuer" | "evidence" | "method" | "editorial" | "visual" | "privacy" | "release",
  ]> = [
    ["Korean Prose Reviewer", "editorial"],
    ["Evaluator Red Team", "editorial"],
    ["RFP/Compliance Reviewer", "issuer"],
    ["Methods/Evidence Reviewer", "evidence"],
    ["Visual/Render Reviewer", "visual"],
  ];
  const findings = reviewerInputs.map(([reviewerRole, authorityClass]) => ({
    ...finding(reviewerRole, base.sectionId, authorityClass, "warning"),
    inputHash: base.inputHash,
    artifactHash: base.artifactHash,
  }));
  for (const entry of findings) {
    await recordAgentRun(root, {
      stage: base.stage,
      run: {
        runId: entry.runId,
        status: "SUCCEEDED",
        inputHash: entry.inputHash,
        reviewerIdentity: `agent-${role}-${entry.reviewerRole}`,
      },
    });
    await recordReviewerFinding(root, { stage: base.stage, finding: entry });
  }
  return { ...base, findingIds: findings.map(({ findingId }) => findingId) };
}

async function createRoot(temporaryDirectories: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "public-proposal-section-authoring-"));
  temporaryDirectories.push(root);
  return root;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
