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
    const decision = adjudicate({
      findings: [finding("prose", "section-1"), finding("evaluator", "section-1")],
    });

    expect(decision.status).toBe("EDITORIAL_REVIEW_REQUIRED");
    expect(decision.receipt.decisions).toHaveLength(2);
  });

  it("does not let a single editorial reviewer hold a section and blocks hard authority violations", () => {
    expect(adjudicate({ findings: [finding("prose", "section-1")] }).status).toBe("ACCEPT");
    expect(adjudicate({ findings: [finding("compliance", "section-1", "issuer", "blocker")] })).toMatchObject({
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

    await approveRepresentativeSections(root, [approval("problem"), approval("method"), approval("execution")]);
    await expect(authorFullDocument(root)).resolves.toMatchObject({ status: "READY_FOR_FULL_AUTHORING" });
  });

  it("quarantines partial runs and invalidates only findings whose input changed", () => {
    const result = adjudicate({
      findings: [
        { ...finding("prose", "section-1"), inputHash: hash("changed") },
        { ...finding("visual", "section-2", "visual"), inputHash: hash("stable") },
      ],
      runs: [
        { runId: "partial", status: "PARTIAL", inputHash: hash("changed") },
        { runId: "timeout", status: "TIMEOUT", inputHash: hash("changed") },
      ],
      changedInputHashes: [hash("changed")],
    });

    expect(result.quarantinedRunIds).toEqual(["partial", "timeout"]);
    expect(result.invalidatedFindingIds).toEqual(["prose-section-1"]);
    expect(result.reusableFindingIds).toEqual(["visual-section-2"]);
  });
});

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
    approvedBy: "proposal-owner",
    approvedAt: "2026-08-19T00:00:00.000Z",
    renderedPageContextPath: `/rendered/${role}.pdf`,
    findingIds: ["prose", "evaluator", "compliance", "evidence", "visual"],
  };
}

async function createRoot(temporaryDirectories: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "public-proposal-section-authoring-"));
  temporaryDirectories.push(root);
  return root;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
