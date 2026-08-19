import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  approveRepresentativeSections,
  authorFullDocument,
  createTestAgentExecutionIntegrityAdapter,
  createSectionPlan,
  adjudicate,
  recordAgentRun,
  recordAutomaticSectionRevision,
  recordFindingRebuttal,
  recordReviewerFinding,
  sha256File,
  verifyReceipt,
  writeReceipt,
} from "@longtable/kpp-core";
import type { SectionPlanItemV1 } from "@longtable/kpp-schemas";
import { buildAgentPacket, mergeApprovedPatch } from "../src/section-authoring.js";

const execFileAsync = promisify(execFile);

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

  it("requires two independent persisted editorial findings before a prose hold", async () => {
    const root = await createRoot(temporaryDirectories);
    const findings = [finding("Korean Prose Reviewer", "section-1"), finding("Evaluator Red Team", "section-1")];
    await persistAdjudicationEvidence(root, "editorial", findings);
    const decision = await adjudicate({ root, stage: "editorial" });

    expect(decision.status).toBe("EDITORIAL_REVIEW_REQUIRED");
    expect(decision.receipt.decisions).toHaveLength(2);
  });

  it("does not let a single persisted editorial reviewer hold a section and blocks hard authority violations", async () => {
    const root = await createRoot(temporaryDirectories);
    const prose = finding("Korean Prose Reviewer", "section-1");
    const compliance = finding("RFP/Compliance Reviewer", "section-1", "issuer", "blocker");
    await persistAdjudicationEvidence(root, "prose-only", [prose]);
    expect((await adjudicate({ root, stage: "prose-only" })).status).toBe("ACCEPT");
    await persistAdjudicationEvidence(root, "compliance", [compliance]);
    await expect(adjudicate({ root, stage: "compliance" })).resolves.toMatchObject({
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

  it("includes the execution-ledger anchor in the canonical representative-review receipt when a KPP chain exists", async () => {
    const root = await createRoot(temporaryDirectories);
    const designInputPath = join(root, "content", "design-lock-input.json");
    const designReceiptPath = join(root, "receipts", "design-lock.json");
    await mkdir(join(root, "content"), { recursive: true });
    await writeFile(designInputPath, "{}\n", "utf8");
    await writeReceipt({ stage: "DESIGN_LOCKED", files: [designInputPath], output: designReceiptPath });

    const approvals = await Promise.all(REPRESENTATIVE_ROLES.map((role) => persistRepresentativeEvidence(root, role)));
    await approveRepresentativeSections(root, approvals);

    const anchorPath = join(root, "receipts", "agent-execution-integrity.json");
    const anchor = await verifyReceipt(anchorPath);
    const receipt = await verifyReceipt(join(root, "receipts", "representative-review.json"));
    expect(anchor.receipt.toolVersion).toBe("kpp-agent-execution/v1");
    expect(receipt.valid).toBe(true);
    expect(receipt.receipt.toolVersion).toBe("kpp-agent-execution/v1");
    expect(receipt.receipt.inputReceiptHashes).toEqual(expect.arrayContaining([await sha256File(designReceiptPath), await sha256File(anchorPath)]));
    expect(receipt.receipt.inputs).toContainEqual({ name: "agent-execution-integrity", path: anchorPath, sha256: await sha256File(anchorPath) });
  });

  it("quarantines non-successful persisted runs and invalidates only persisted findings whose input changed", async () => {
    const root = await createRoot(temporaryDirectories);
    const changed = { ...finding("Korean Prose Reviewer", "section-1"), inputHash: hash("changed") };
    const stable = { ...finding("Visual/Render Reviewer", "section-2", "visual"), inputHash: hash("stable") };
    await persistAdjudicationEvidence(root, "adjudication", [changed, stable]);
    await recordAgentRun(root, { stage: "adjudication", run: { runId: "partial", status: "PARTIAL", inputHash: hash("changed"), reviewerIdentity: "partial-reviewer" } });
    await recordAgentRun(root, { stage: "adjudication", run: { runId: "timeout", status: "TIMEOUT", inputHash: hash("changed"), reviewerIdentity: "timeout-reviewer" } });
    const result = await adjudicate({ root, stage: "adjudication", changedInputHashes: [hash("changed")] });

    expect(result.quarantinedRunIds).toEqual(["partial", "timeout"]);
    expect(result.excludedFindingIds).toEqual([]);
    expect(result.invalidatedFindingIds).toEqual([changed.findingId]);
    expect(result.reusableFindingIds).toEqual(["Visual/Render Reviewer-section-2"]);
  });

  it("rejects fabricated caller success records so they cannot revive a persisted quarantined run", async () => {
    const root = await createRoot(temporaryDirectories);
    const quarantined = { ...finding("RFP/Compliance Reviewer", "section-1", "issuer", "blocker"), runId: "quarantined" };
    await recordAgentRun(root, {
      stage: "quarantined",
      run: { runId: "quarantined", status: "QUARANTINED", inputHash: quarantined.inputHash, reviewerIdentity: "agent-q" },
    });
    await recordReviewerFinding(root, { stage: "quarantined", finding: quarantined });
    await expect(adjudicate({
      root,
      stage: "quarantined",
      findings: [quarantined],
      runs: [{ runId: "quarantined", status: "SUCCEEDED", inputHash: quarantined.inputHash, reviewerIdentity: "forged-success" }],
    } as unknown as Parameters<typeof adjudicate>[0])).rejects.toMatchObject({ code: "PP_ADJUDICATION_CALLER_RECORDS_FORBIDDEN" });

    const result = await adjudicate({ root, stage: "quarantined" });
    expect(result.status).toBe("ACCEPT");
    expect(result.quarantinedRunIds).toEqual(["quarantined"]);
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

  it("serializes concurrent mutations across independent Node processes so each durable cap admits only one final operation", async () => {
    const root = await createRoot(temporaryDirectories);
    for (let index = 0; index < 11; index += 1) {
      await recordAgentRun(root, {
        stage: "concurrent-runs",
        run: { runId: `run-${index}`, status: "SUCCEEDED", inputHash: hash(`concurrent-run-${index}`), reviewerIdentity: `agent-${index}` },
      });
    }
    const runResults = await Promise.all([
      runMutationInChild("recordAgentRun", root, { stage: "concurrent-runs", run: { runId: "run-11", status: "SUCCEEDED", inputHash: hash("concurrent-run-11"), reviewerIdentity: "agent-11" } }),
      runMutationInChild("recordAgentRun", root, { stage: "concurrent-runs", run: { runId: "run-12", status: "SUCCEEDED", inputHash: hash("concurrent-run-12"), reviewerIdentity: "agent-12" } }),
    ]);
    expect(runResults.sort()).toEqual(["PP_AGENT_STAGE_RUN_LIMIT", "fulfilled"]);

    const persistedFinding = finding("Korean Prose Reviewer", "section-concurrent", "editorial", "warning");
    await persistAdjudicationEvidence(root, "concurrent-actions", [persistedFinding]);
    const rebuttalResults = await Promise.all([
      runMutationInChild("recordFindingRebuttal", root, { stage: "concurrent-actions", findingId: persistedFinding.findingId, rebuttalId: "rebuttal-a" }),
      runMutationInChild("recordFindingRebuttal", root, { stage: "concurrent-actions", findingId: persistedFinding.findingId, rebuttalId: "rebuttal-b" }),
    ]);
    expect(rebuttalResults.sort()).toEqual(["PP_AGENT_REBUTTAL_LIMIT", "fulfilled"]);

    await recordAutomaticSectionRevision(root, { stage: "concurrent-actions", sectionId: "section-concurrent", revisionId: "revision-a" });
    const revisionResults = await Promise.all([
      runMutationInChild("recordAutomaticSectionRevision", root, { stage: "concurrent-actions", sectionId: "section-concurrent", revisionId: "revision-b" }),
      runMutationInChild("recordAutomaticSectionRevision", root, { stage: "concurrent-actions", sectionId: "section-concurrent", revisionId: "revision-c" }),
    ]);
    expect(revisionResults.sort()).toEqual(["PP_SECTION_AUTO_REVISION_LIMIT", "fulfilled"]);
  });

  it("fails closed when the persisted execution ledger is malformed or tampered", async () => {
    const root = await createRoot(temporaryDirectories);
    const integrityAdapter = createTestAgentExecutionIntegrityAdapter();
    await recordAgentRun(root, {
      stage: "tampered",
      run: { runId: "run-1", status: "SUCCEEDED", inputHash: hash("tampered"), reviewerIdentity: "agent-1" },
    }, { integrityAdapter });
    await writeFile(join(root, "content", "agent-execution-state.json"), JSON.stringify({
      schemaVersion: "agent-execution-state/v1",
      stages: { tampered: { runs: [{ runId: "run-1", status: "FORGED" }], findings: [], rebuttals: [], automaticRevisions: [] } },
    }), "utf8");

    await expect(adjudicate({ root, stage: "tampered", integrityAdapter })).rejects.toMatchObject({ code: "PP_AGENT_EXECUTION_INTEGRITY_FAILED" });

    await writeFile(join(root, "content", "agent-execution-state.json"), JSON.stringify({
      schemaVersion: "agent-execution-state/v1",
      stages: {
        tampered: {
          runs: [{ runId: "run-1", status: "SUCCEEDED", inputHash: hash("tampered"), reviewerIdentity: "agent-1" }],
          findings: [{ findingId: "missing-required-reviewer-finding-fields" }],
          rebuttals: [],
          automaticRevisions: [],
        },
      },
    }), "utf8");

    await integrityAdapter.write(root, join(root, "content", "agent-execution-state.json"));
    await expect(adjudicate({ root, stage: "tampered", integrityAdapter })).rejects.toMatchObject({ code: "PP_AGENT_EXECUTION_STATE_INVALID" });
  });

  it("fails closed when schema-valid tampering changes a quarantined run to succeeded", async () => {
    const root = await createRoot(temporaryDirectories);
    const integrityAdapter = createTestAgentExecutionIntegrityAdapter();
    const quarantined = { ...finding("RFP/Compliance Reviewer", "section-integrity", "issuer", "blocker"), runId: "quarantined" };
    await recordAgentRun(root, {
      stage: "integrity",
      run: { runId: quarantined.runId, status: "QUARANTINED", inputHash: quarantined.inputHash, reviewerIdentity: "agent-q" },
    }, { integrityAdapter });
    await recordReviewerFinding(root, { stage: "integrity", finding: quarantined }, { integrityAdapter });
    const ledgerPath = join(root, "content", "agent-execution-state.json");
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as { stages: Record<string, { runs: Array<{ status: string }> }> };
    ledger.stages.integrity!.runs[0]!.status = "SUCCEEDED";
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

    await expect(adjudicate({ root, stage: "integrity", integrityAdapter })).rejects.toMatchObject({ code: "PP_AGENT_EXECUTION_INTEGRITY_FAILED" });
  });

  it("adjudicates the single anchored byte snapshot when status flips after verification", async () => {
    const root = await createRoot(temporaryDirectories);
    const integrityAdapter = createTestAgentExecutionIntegrityAdapter();
    const quarantined = { ...finding("RFP/Compliance Reviewer", "section-snapshot", "issuer", "blocker"), runId: "snapshot-run" };
    await recordAgentRun(root, {
      stage: "snapshot",
      run: { runId: quarantined.runId, status: "QUARANTINED", inputHash: quarantined.inputHash, reviewerIdentity: "agent-q" },
    }, { integrityAdapter });
    await recordReviewerFinding(root, { stage: "snapshot", finding: quarantined }, { integrityAdapter });

    const ledgerPath = join(root, "content", "agent-execution-state.json");
    const raceAdapter = postVerificationStatusFlipAdapter(integrityAdapter, "snapshot", quarantined.runId);
    let ledgerReads = 0;
    const result = await adjudicate({
      root,
      stage: "snapshot",
      integrityAdapter: raceAdapter,
      ledgerByteReader: async (path: string) => {
        ledgerReads += 1;
        return readFile(path);
      },
    });

    expect(ledgerReads).toBe(1);
    expect(result).toMatchObject({
      status: "ACCEPT",
      quarantinedRunIds: [quarantined.runId],
      excludedFindingIds: [quarantined.findingId],
    });
    expect(await persistedRunStatus(ledgerPath, "snapshot", quarantined.runId)).toBe("SUCCEEDED");
  });

  it("does not approve a quarantined representative run flipped after verification", async () => {
    const root = await createRoot(temporaryDirectories);
    const approvals = await Promise.all(REPRESENTATIVE_ROLES.map((role) => persistRepresentativeEvidence(root, role)));
    const integrityAdapter = createTestAgentExecutionIntegrityAdapter();
    const ledgerPath = join(root, "content", "agent-execution-state.json");
    const problemRunId = `run-${approvals[0]!.findingIds[0]}`;
    await setPersistedRunStatus(ledgerPath, "representative-problem", problemRunId, "QUARANTINED");
    await integrityAdapter.write(root, ledgerPath);

    const raceAdapter = postVerificationStatusFlipAdapter(integrityAdapter, "representative-problem", problemRunId);
    let ledgerReads = 0;
    await expect(approveRepresentativeSections(root, approvals, {
      integrityAdapter: raceAdapter,
      ledgerByteReader: async (path: string) => {
        ledgerReads += 1;
        return readFile(path);
      },
    })).rejects.toMatchObject({ code: "PP_REPRESENTATIVE_FINDING_RUN_INELIGIBLE" });

    expect(ledgerReads).toBe(1);
    expect(await persistedRunStatus(ledgerPath, "representative-problem", problemRunId)).toBe("SUCCEEDED");
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

async function persistAdjudicationEvidence(
  root: string,
  stage: string,
  findings: readonly ReturnType<typeof finding>[],
): Promise<void> {
  for (const entry of findings) {
    await recordAgentRun(root, {
      stage,
      run: {
        runId: entry.runId,
        status: "SUCCEEDED",
        inputHash: entry.inputHash,
        reviewerIdentity: `agent-${stage}-${entry.reviewerRole}`,
      },
    });
    await recordReviewerFinding(root, { stage, finding: entry });
  }
}

type ChildMutation = "recordAgentRun" | "recordFindingRebuttal" | "recordAutomaticSectionRevision";

async function runMutationInChild(method: ChildMutation, root: string, input: Record<string, unknown>): Promise<string> {
  const moduleUrl = new URL("../../../packages/core/src/section-authoring.ts", import.meta.url).href;
  const program = [
    `import { ${method} } from ${JSON.stringify(moduleUrl)};`,
    "try {",
    `  await ${method}(${JSON.stringify(root)}, ${JSON.stringify(input)});`,
    '  process.stdout.write("fulfilled");',
    "} catch (error) {",
    '  process.stdout.write(error && typeof error === "object" && "code" in error ? String(error.code) : "unknown-error");',
    "}",
  ].join("\n");
  const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", program], {
    cwd: process.cwd(),
  });
  return stdout.trim();
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

function postVerificationStatusFlipAdapter(
  integrityAdapter: ReturnType<typeof createTestAgentExecutionIntegrityAdapter>,
  stage: string,
  runId: string,
) {
  return {
    async write(root: string, ledgerPath: string): Promise<void> {
      await integrityAdapter.write(root, ledgerPath);
    },
    async verify(root: string, ledgerPath: string, ledgerSha256: string): Promise<void> {
      await integrityAdapter.verify(root, ledgerPath, ledgerSha256);
      await setPersistedRunStatus(ledgerPath, stage, runId, "SUCCEEDED");
    },
  };
}

async function setPersistedRunStatus(
  ledgerPath: string,
  stage: string,
  runId: string,
  status: "SUCCEEDED" | "QUARANTINED",
): Promise<void> {
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
    stages: Record<string, { runs: Array<{ runId: string; status: string }> }>;
  };
  const run = ledger.stages[stage]?.runs.find((entry) => entry.runId === runId);
  if (run === undefined) throw new Error(`Missing test run ${runId}`);
  run.status = status;
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

async function persistedRunStatus(ledgerPath: string, stage: string, runId: string): Promise<string | undefined> {
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
    stages: Record<string, { runs: Array<{ runId: string; status: string }> }>;
  };
  return ledger.stages[stage]?.runs.find((entry) => entry.runId === runId)?.status;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
