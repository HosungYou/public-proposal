import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

let core: typeof import("@longtable/kpp-core");

describe("LongTable research requirement gate", () => {
  const roots: string[] = [];

  beforeAll(async () => {
    core = await import("@longtable/kpp-core");
  });

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("classifies the three research classes and conditional general procurement", () => {
    expect(core.requiresResearchLock("academic_research", false)).toBe(true);
    expect(core.requiresResearchLock("research_service", false)).toBe(true);
    expect(core.requiresResearchLock("policy_research", false)).toBe(true);
    expect(core.requiresResearchLock("general_procurement", true)).toBe(true);
    expect(core.requiresResearchLock("general_procurement", false)).toBe(false);
    expect(core.requiresResearchLock("document_restyle", true)).toBe(false);
  });

  it("blocks research-service content approval without a research lock", async () => {
    const root = await createProjectAt(roots, "DESIGN_LOCKED");

    const result = await runCli(["content-approve", root, "--approved-by", "owner", "--json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "PP_RESEARCH_LOCK_MISSING",
      data: { stage: "CONTENT_APPROVED" },
    });
    await expect(access(join(root, "receipts", "content-approval.json"))).rejects.toBeDefined();
    await expect(access(join(root, "content", "content-approval-decision.json"))).rejects.toBeDefined();
  });

  it("blocks research-service authoring export without a research lock", async () => {
    const root = await createProjectAt(roots, "REQUIREMENTS_LOCKED");

    const result = await runCli(["export-authoring", root, "--json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "PP_RESEARCH_LOCK_MISSING",
      data: { stage: "CONTENT_APPROVED" },
    });
    await expect(access(join(root, "content", "authoring-request.json"))).rejects.toBeDefined();
  });

  it("requires LongTable for general procurement only when an academic evidence slot is locked", async () => {
    const root = await createProjectAt(roots, "REQUIREMENTS_LOCKED", {
      proposalClass: "general_procurement",
      targetPageRole: "academic_evidence",
    });

    await expect(core.verifyResearchRequirement(root)).rejects.toMatchObject({
      code: "PP_RESEARCH_LOCK_MISSING",
      details: { stage: "CONTENT_APPROVED" },
    });
  });

  it("reports a missing LongTable handoff, open checkpoint, and version mismatch at CONTENT_APPROVED", async () => {
    const noHandoffRoot = await createProjectAt(roots, "REQUIREMENTS_LOCKED");
    const artifact = join(noHandoffRoot, "evidence", "research-lock-artifact.txt");
    await writeFile(artifact, "not a LongTable handoff\n");
    await core.writeReceipt({
      stage: "EVIDENCE_LOCKED",
      files: [artifact],
      inputReceiptHashes: [await core.sha256File(artifact)],
      output: join(noHandoffRoot, "receipts", "research-lock.json"),
    });
    await expect(core.verifyResearchRequirement(noHandoffRoot)).rejects.toMatchObject({
      code: "PP_LONGTABLE_REQUIRED",
      details: { stage: "CONTENT_APPROVED" },
    });

    const openRoot = await createProjectAt(roots, "REQUIREMENTS_LOCKED");
    await createResearchReceipt(openRoot, { openRequiredCheckpoints: ["checkpoint-1"] });
    await expect(core.verifyResearchRequirement(openRoot)).rejects.toMatchObject({
      code: "PP_RESEARCH_CHECKPOINT_OPEN",
      details: { stage: "CONTENT_APPROVED" },
    });

    const versionRoot = await createProjectAt(roots, "REQUIREMENTS_LOCKED");
    await createResearchReceipt(versionRoot, { longtableVersion: "0.1.71" });
    await expect(core.verifyResearchRequirement(versionRoot)).rejects.toMatchObject({
      code: "PP_LONGTABLE_VERSION_MISMATCH",
      details: { stage: "CONTENT_APPROVED" },
    });
  });
});

async function createResearchReceipt(
  root: string,
  overrides: { readonly longtableVersion?: string; readonly openRequiredCheckpoints?: readonly string[] } = {},
): Promise<void> {
  const researchRoot = join(root, "evidence", "research-lock");
  await mkdir(researchRoot, { recursive: true });
  const artifacts = [
    join(researchRoot, "research-specification.json"),
    join(researchRoot, "citation-slot-matrix.json"),
    join(researchRoot, "source-ledger.json"),
    join(researchRoot, "claim-transfer-ledger.json"),
  ] as const;
  await Promise.all(artifacts.map((path, index) => writeFile(path, `${JSON.stringify({ index })}\n`)));
  const hashes = await Promise.all(artifacts.map((path) => core.sha256File(path)));
  const handoffPath = join(researchRoot, "handoff.json");
  await writeFile(handoffPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    longtableVersion: overrides.longtableVersion ?? "0.1.72",
    projectId: "research-gate-fixture",
    proposalClass: "research_service",
    researchSpecificationPath: "evidence/research-lock/research-specification.json",
    researchSpecificationSha256: hashes[0],
    citationSlotMatrixPath: "evidence/research-lock/citation-slot-matrix.json",
    citationSlotMatrixSha256: hashes[1],
    sourceLedgerPath: "evidence/research-lock/source-ledger.json",
    sourceLedgerSha256: hashes[2],
    claimTransferLedgerPath: "evidence/research-lock/claim-transfer-ledger.json",
    claimTransferLedgerSha256: hashes[3],
    openRequiredCheckpoints: overrides.openRequiredCheckpoints ?? [],
    createdAt: "2026-08-18T00:00:00.000Z",
  }, null, 2)}\n`);
  await core.writeReceipt({
    stage: "EVIDENCE_LOCKED",
    files: [handoffPath, ...artifacts],
    inputReceiptHashes: hashes,
    output: join(root, "receipts", "research-lock.json"),
  });
}

async function createProjectAt(
  roots: string[],
  target: "REQUIREMENTS_LOCKED" | "DESIGN_LOCKED",
  options: {
    readonly proposalClass?: "research_service" | "general_procurement";
    readonly targetPageRole?: string;
  } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-research-gate-"));
  roots.push(root);
  await core.initializeProject(root, {
    projectId: "research-gate-fixture",
    proposalClass: options.proposalClass ?? "research_service",
  });
  const requirementsPath = join(root, "requirements", "requirements.json");
  await writeFile(requirementsPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    confirmationStatus: "confirmed",
    confirmedBy: "owner",
    requirements: [{
      requirementId: "REQ-RESEARCH",
      title: "연구 방법",
      critical: true,
      pageRole: "research_method",
      surfaceTemplateId: "r08-research-method-v1",
      claims: [{ claimId: "CLAIM-RESEARCH", critical: true, evidenceIds: ["EV-RESEARCH"] }],
      figureSpecs: [],
    }],
    evidenceBindings: [{
      evidenceId: "EV-RESEARCH",
      sourcePath: requirementsPath,
      sourceSha256: "0".repeat(64),
      scope: "학술 근거 슬롯",
      claimIds: ["CLAIM-RESEARCH"],
      targetRequirementId: "REQ-RESEARCH",
      targetPageId: "PAGE-RESEARCH",
      targetPageRole: options.targetPageRole ?? "research_method",
    }],
  }, null, 2)}\n`);

  const stages = ["SOURCE_LOCKED", "REQUIREMENTS_LOCKED", "EVIDENCE_LOCKED", "DESIGN_LOCKED"] as const;
  const filenames = {
    SOURCE_LOCKED: "source-lock.json",
    REQUIREMENTS_LOCKED: "requirements-lock.json",
    EVIDENCE_LOCKED: "evidence-lock.json",
    DESIGN_LOCKED: "design-lock.json",
  } as const;
  let predecessor: string | undefined;
  for (const stage of stages) {
    const artifact = join(root, "receipts", `${stage.toLowerCase()}.txt`);
    await writeFile(artifact, `${stage}\n`);
    const receipt = join(root, "receipts", filenames[stage]);
    await core.writeReceipt({
      stage,
      files: stage === "REQUIREMENTS_LOCKED" ? [artifact, requirementsPath] : [artifact],
      inputReceiptHashes: predecessor === undefined ? [] : [await core.sha256File(predecessor)],
      output: receipt,
    });
    await core.advanceProject(root, stage);
    predecessor = receipt;
    if (stage === target) break;
  }
  return root;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "apps/kpp-cli/src/main.ts", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error: Error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
