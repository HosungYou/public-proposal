import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  lockLivingBrief,
  recordDecisionAcceptance,
  resolveDecisionScope,
  resolvePositivePolicy,
  advanceProject,
  initializeProject,
  sha256File,
  writeReceipt,
} from "../src/index.js";

describe("living brief and positive policy", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ));
  });

  it("does not treat a bare acceptance as approval of two decisions", () => {
    const result = recordDecisionAcceptance({
      turnText: "응",
      presentedDecisionIds: ["decision-1", "decision-2"],
    });

    expect(result).toMatchObject({ ok: false, code: "PP_DECISION_ACCEPTANCE_AMBIGUOUS" });
  });

  it("binds a bare acceptance only to one immediately presented decision", () => {
    const result = recordDecisionAcceptance({
      turnText: "제안대로",
      presentedDecisionIds: ["decision-1"],
    });

    expect(result).toEqual({ ok: true, decisionId: "decision-1" });
  });

  it("requires a human promotion receipt before widening a project decision", () => {
    expect(resolveDecisionScope({
      currentScope: "project",
      requestedScope: "proposal_family",
    })).toMatchObject({ ok: false, code: "PP_DECISION_SCOPE_PROMOTION_REQUIRED" });

    expect(resolveDecisionScope({
      currentScope: "project",
      requestedScope: "global",
      promotionReceipt: {
        decisionId: "decision-1",
        approvedBy: "proposal-owner",
        approvedAt: "2026-08-19T00:00:00.000Z",
      },
    })).toEqual({ ok: true, scope: "global" });
  });

  it("rejects issuer conflicts without an explicit current-project exception", () => {
    expect(resolvePositivePolicy({
      issuerRule: { policyId: "page-limit", value: "20" },
      projectDecision: { policyId: "page-limit", value: "30", explicitException: false },
      pluginDefault: { policyId: "page-limit", value: "25" },
    })).toMatchObject({ ok: false, code: "PP_POLICY_ISSUER_CONFLICT" });

    expect(resolvePositivePolicy({
      issuerRule: { policyId: "page-limit", value: "20" },
      projectDecision: { policyId: "page-limit", value: "30", explicitException: true },
      pluginDefault: { policyId: "page-limit", value: "25" },
    })).toMatchObject({ ok: true, source: "project_decision", value: "30" });
  });

  it("locks a brief with its doctrine, active decisions, and input hash", async () => {
    const root = await createRequirementsLockedProject(temporaryDirectories);
    const receipt = await lockLivingBrief(root, validBrief());

    expect(receipt.stage).toBe("BRIEF_LOCKED");
    expect(receipt.inputs).toContainEqual(expect.objectContaining({ name: "brief" }));
    expect(receipt.inputs).toContainEqual(expect.objectContaining({ name: "doctrine" }));
  });
});

function validBrief() {
  return {
    schemaVersion: "living-proposal-brief/v1",
    projectId: "sample",
    proposalClass: "general_procurement",
    problem: "공고 요구사항에 맞는 실행 제안이 필요하다.",
    primaryReaders: [{ reader: "평가위원", task: "실행 가능성을 판단한다." }],
    doctrineVersion: "positive-doctrine/v1",
    evidenceBoundary: ["확인된 발주처 자료"],
    activeDecisions: [{
      decisionId: "decision-1",
      scope: "project",
      statement: "실행 계획을 우선 제시한다.",
      rationale: "평가자가 수행 가능성을 먼저 확인한다.",
      source: { threadId: "thread-1", turnId: "turn-1" },
      status: "active",
      supersedes: [],
      affects: ["section-execution"],
      approvedBy: "proposal-owner",
      approvedAt: "2026-08-19T00:00:00.000Z",
    }],
    openDecisions: [{
      decisionId: "decision-2",
      question: "대표 실행 섹션을 확정한다.",
      affects: ["section-execution"],
      critical: true,
    }],
    approvedReferences: [{
      referenceId: "reference-1",
      sourcePath: "sources/rfp.pdf",
      sourceSha256: "a".repeat(64),
      useBoundary: "구조와 제출조건만 참고한다.",
    }],
    nextHumanGate: "대표 섹션 검토",
  };
}

async function createRequirementsLockedProject(temporaryDirectories: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-brief-policy-"));
  temporaryDirectories.push(root);
  await initializeProject(root, { projectId: "sample" });
  await writeStageReceipt(root, "SOURCE_LOCKED");
  await advanceProject(root, "SOURCE_LOCKED");
  await writeStageReceipt(root, "REQUIREMENTS_LOCKED", {
    inputReceiptHashes: [await sha256File(join(root, "receipts", "source-lock.json"))],
  });
  await advanceProject(root, "REQUIREMENTS_LOCKED");
  return root;
}

async function writeStageReceipt(
  root: string,
  stage: "SOURCE_LOCKED" | "REQUIREMENTS_LOCKED",
  options: { readonly inputReceiptHashes?: readonly string[] } = {},
): Promise<void> {
  const artifact = join(root, "artifacts", `${stage.toLowerCase()}.txt`);
  await mkdir(join(root, "artifacts"), { recursive: true });
  await writeFile(artifact, `${stage} artifact`, { encoding: "utf8", flag: "w" });
  await writeReceipt({
    stage,
    files: [artifact],
    inputReceiptHashes: options.inputReceiptHashes,
    output: join(root, "receipts", stage === "SOURCE_LOCKED" ? "source-lock.json" : "requirements-lock.json"),
  });
}
