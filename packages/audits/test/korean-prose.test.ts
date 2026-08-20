import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { lintKoreanProse } from "../src/korean-prose.js";

const glossary = {
  schemaVersion: "1.0.0",
  entries: [{ term: "AX", definition: "업무 전환을 위한 기관 내부 용어" }],
};

let core: typeof import("@longtable/kpp-core");
let audits: typeof import("@longtable/kpp-audits");

describe("Korean public-proposal prose lint", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    expect(await runProcess("npm", ["run", "build"])).toMatchObject({ code: 0, stderr: "" });
    core = await import("@longtable/kpp-core");
    audits = await import("@longtable/kpp-audits");
  });

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ));
  });

  it("blocks an undefined project-specific English acronym", () => {
    const result = lintKoreanProse("AXI 기반의 성과를 측정한다.", glossary);

    expect(result.codes).toContain("KPP_CONTENT_UNDEFINED_TERM");
    expect(result.blockers).toHaveLength(1);
  });

  it("keeps approved glossary terms out of undefined-term blockers", () => {
    const result = lintKoreanProse("AX 기반의 성과를 측정한다.", glossary);

    expect(result.codes).not.toContain("KPP_CONTENT_UNDEFINED_TERM");
  });

  it("blocks vague promises and unresolved placeholders while retaining style warnings separately", () => {
    const result = lintKoreanProse(
      "최적화된 혁신 솔루션으로 성공을 보장합니다. {{기관명}}",
      glossary,
    );

    expect(result.codes).toEqual(expect.arrayContaining([
      "KPP_CONTENT_VAGUE_PROMISE",
      "KPP_CONTENT_PLACEHOLDER",
    ]));
    expect(result.blockers.every((finding) => finding.severity === "blocker")).toBe(true);
    expect(result.warnings.every((finding) => finding.severity === "warning")).toBe(true);
  });

  it("blocks sentence repetition only when it is repeated across content blocks", () => {
    const oneBlock = lintKoreanProse([{
      blockId: "PAGE-001",
      text: "검증 가능한 근거를 제시한다. 검증 가능한 근거를 제시한다.",
    }], glossary);
    const crossBlock = lintKoreanProse([
      { blockId: "PAGE-001", text: "검증 가능한 근거를 제시한다." },
      { blockId: "PAGE-002", text: "검증 가능한 근거를 제시한다." },
    ], glossary);

    expect(oneBlock.codes).not.toContain("KPP_CONTENT_REPETITION");
    expect(crossBlock.codes).toContain("KPP_CONTENT_REPETITION");
  });

  it("blocks mechanical scaffold prose that is not a developed proposal paragraph", () => {
    const result = lintKoreanProse(
      "본문 작성 메모\n이 페이지는 RFP 요구와 기관 자료의 연결부를 본문으로 확장한다.",
      glossary,
    );

    expect(result.codes).toContain("KPP_CONTENT_SCAFFOLD");
    expect(result.blockers.some(({ code }) => code === "KPP_CONTENT_SCAFFOLD")).toBe(true);
  });

  it("warns when a prose block is materially thinner than an ordinary page body", () => {
    const result = lintKoreanProse("짧은 본문입니다.", glossary);

    expect(result.codes).toContain("KPP_CONTENT_THIN_BODY");
    expect(result.warnings.some(({ code }) => code === "KPP_CONTENT_THIN_BODY")).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("rejects direct EVIDENCE_LOCKED approval without writing a receipt or advancing state", async () => {
    const fixture = await createApprovalFixture(temporaryDirectories, { designLocked: false });

    await expect(audits.approveContent(fixture.root, { approvedBy: "proposal-owner" })).rejects.toMatchObject({
      code: "KPP_STATE_INVALID_TRANSITION",
    });
    expect(await core.readProject(fixture.root)).toMatchObject({ state: "EVIDENCE_LOCKED" });
    await expect(access(join(fixture.root, "receipts", "content-approval.json"))).rejects.toThrow();
    await expect(access(join(fixture.root, "content", "content-approval-decision.json"))).rejects.toThrow();
  });

  it("requires explicit human approval without writing a receipt or advancing state", async () => {
    const fixture = await createApprovalFixture(temporaryDirectories);

    await expect(audits.approveContent(fixture.root)).rejects.toMatchObject({
      code: "KPP_INPUT_CONTENT_APPROVAL_REQUIRED",
    });
    expect(await core.readProject(fixture.root)).toMatchObject({ state: "DESIGN_LOCKED" });
    await expect(access(join(fixture.root, "receipts", "content-approval.json"))).rejects.toThrow();
    await expect(access(join(fixture.root, "content", "content-approval-decision.json"))).rejects.toThrow();
  });

  it("blocks prose defects and reuses the stored authoring evidence/numeric boundary", async () => {
    const fixture = await createApprovalFixture(temporaryDirectories);
    const responsePath = join(fixture.root, "content", "authoring-response.json");

    await writeFile(responsePath, `${JSON.stringify(responseWith(fixture.response, {
      text: "본 연구는 999쪽을 확인한다.",
      pendingBlankFieldIds: [],
    }), null, 2)}\n`, "utf8");
    await expect(audits.approveContent(fixture.root, { approvedBy: "proposal-owner" })).rejects.toMatchObject({
      code: "KPP_EVIDENCE_UNBOUND_CLAIM",
    });
    await writeFile(responsePath, `${JSON.stringify(responseWith(fixture.response, {
      text: "최적화된 혁신 솔루션으로 성공을 보장합니다.",
      pendingBlankFieldIds: [],
    }), null, 2)}\n`, "utf8");
    await expect(audits.approveContent(fixture.root, { approvedBy: "proposal-owner" })).rejects.toMatchObject({
      code: "KPP_INPUT_CONTENT_BLOCKED",
    });
    expect(await core.readProject(fixture.root)).toMatchObject({ state: "DESIGN_LOCKED" });
    await expect(access(join(fixture.root, "receipts", "content-approval.json"))).rejects.toThrow();
  });

  it("blocks a pending_blank placeholder that passed the authoring schema", async () => {
    const fixture = await createApprovalFixture(temporaryDirectories, { includePendingBlank: true });

    await expect(audits.approveContent(fixture.root, { approvedBy: "proposal-owner" })).rejects.toMatchObject({
      code: "KPP_INPUT_CONTENT_BLOCKED",
    });
    expect(await core.readProject(fixture.root)).toMatchObject({ state: "DESIGN_LOCKED" });
    await expect(access(join(fixture.root, "receipts", "content-approval.json"))).rejects.toThrow();
  });

  it("records human approval, full provenance, and receipt before the CONTENT_APPROVED transition", async () => {
    const fixture = await createApprovalFixture(temporaryDirectories);
    const result = await audits.approveContent(fixture.root, {
      approvedBy: "proposal-owner",
      approvedAt: "2026-08-17T12:00:00.000Z",
    });
    const decision = JSON.parse(await readFile(result.decisionPath, "utf8"));
    const receipt = await core.verifyReceipt(result.receiptPath);

    expect(result.state).toBe("CONTENT_APPROVED");
    expect(await core.readProject(fixture.root)).toMatchObject({ state: "CONTENT_APPROVED" });
    expect(decision).toMatchObject({
      decision: "approved",
      approvedBy: "proposal-owner",
      approvedAt: "2026-08-17T12:00:00.000Z",
      projectId: "proposal-approval-test",
      glossary: {
        status: "provided",
        path: fixture.terminologyPath,
        sha256: sha256(fixture.terminologyText),
      },
    });
    expect(receipt.valid).toBe(true);
    expect(receipt.receipt).toMatchObject({ stage: "CONTENT_APPROVED", result: "PASS" });
    expect(receipt.receipt.files.map(({ path }) => path)).toEqual(expect.arrayContaining([
      join(fixture.root, "content", "authoring-request.json"),
      join(fixture.root, "content", "authoring-response.json"),
      result.decisionPath,
      fixture.terminologyPath,
    ]));
  });

  it("routes explicit content approval through the CLI", async () => {
    const fixture = await createApprovalFixture(temporaryDirectories);

    const result = await run([
      "content-approve",
      fixture.root,
      "--approved-by",
      "proposal-owner",
      "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { state: "CONTENT_APPROVED" } });
    expect(await core.readProject(fixture.root)).toMatchObject({ state: "CONTENT_APPROVED" });
  });
});

function responseWith(
  response: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const [block] = response.blocks as Array<Record<string, unknown>>;
  return { ...response, blocks: [{ ...block, ...overrides }] };
}

async function createApprovalFixture(
  temporaryDirectories: string[],
  options: { readonly designLocked?: boolean; readonly includePendingBlank?: boolean } = {},
) {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "kpp-content-approval-"));
  temporaryDirectories.push(fixtureDirectory);
  const root = join(fixtureDirectory, "project");
  const rfpPath = join(fixtureDirectory, "issuer-rfp.txt");
  const evidencePath = join(fixtureDirectory, "evidence.txt");
  const issuerProfilePath = join(fixtureDirectory, "issuer-profile.json");
  const terminologyPath = join(fixtureDirectory, "terminology.json");
  const rfpText = "제안서 본문은 표지 및 간지를 제외하고 50쪽 이내로 한다.\n";
  const evidenceText = "공식 확인자료: 본문은 50쪽 이내로 작성한다.\n";
  const issuerProfile = { schemaVersion: "1.0.0", issuerName: "한국환경산업기술원", rules: [] };
  const terminology = {
    schemaVersion: "1.0.0",
    entries: [{ term: "연구 기준선", definition: "연구 시작 시점의 확인 기준" }],
  };
  const terminologyText = `${JSON.stringify(terminology, null, 2)}\n`;
  await Promise.all([
    writeFile(rfpPath, rfpText, "utf8"),
    writeFile(evidencePath, evidenceText, "utf8"),
    writeFile(issuerProfilePath, `${JSON.stringify(issuerProfile, null, 2)}\n`, "utf8"),
    writeFile(terminologyPath, terminologyText, "utf8"),
  ]);

  expect(await run(["init", root, "--project-id", "proposal-approval-test", "--document-mode", "research_service", "--json"])).toMatchObject({ code: 0, stderr: "" });
  expect(await run(["ingest", root, rfpPath, "--json"])).toMatchObject({ code: 0, stderr: "" });
  const requirementsPath = join(fixtureDirectory, "requirements.json");
  await writeFile(requirementsPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    confirmationStatus: "confirmed",
    confirmedBy: "proposal-owner",
    requirements: [{
      requirementId: "REQ-001",
      title: "연구 방법",
      critical: false,
      pageRole: "research_method",
      surfaceTemplateId: "r08-research-method-v1",
      claims: [
        { claimId: "CLAIM-001", critical: false, evidenceIds: ["EV-001"] },
        ...(options.includePendingBlank === true
          ? [{ claimId: "CLAIM-BLANK", critical: false, evidenceIds: [] }]
          : []),
      ],
      figureSpecs: [],
    }],
    evidenceBindings: [{
      evidenceId: "EV-001",
      sourcePath: evidencePath,
      sourceSha256: sha256(evidenceText),
      scope: "본문 분량 50쪽 이내",
      claimIds: ["CLAIM-001"],
      targetRequirementId: "REQ-001",
      targetPageId: "PAGE-001",
      targetPageRole: "research_method",
    }],
  }, null, 2)}\n`, "utf8");
  expect(await run(["plan", root, "--requirements", requirementsPath, "--json"])).toMatchObject({ code: 0, stderr: "" });
  await core.exportAuthoring(root, {
    issuerProfile: { path: issuerProfilePath, value: issuerProfile },
    terminology: { path: terminologyPath, value: terminology },
  });
  const response = {
    schemaVersion: "1.0.0",
    blocks: [{
      pageId: "PAGE-001",
      claimIds: options.includePendingBlank === true ? ["CLAIM-001", "CLAIM-BLANK"] : ["CLAIM-001"],
      evidenceIds: ["EV-001"],
      status: "provisional",
      text: options.includePendingBlank === true
        ? "본 연구는 공식 확인자료에 따라 50쪽 이내 기준을 적용한다. {{CLAIM-BLANK}}"
        : "본 연구는 공식 확인자료에 따라 50쪽 이내 기준을 적용한다.",
      evaluatorAnswer: "확인 가능한 근거와 수행 방법을 함께 제시한다.",
      pendingBlankFieldIds: options.includePendingBlank === true ? ["CLAIM-BLANK"] : [],
    }],
  };
  await core.importAuthoring(root, response);
  if (options.designLocked !== false) {
    const designArtifactPath = join(root, "figures", "design-lock-artifact.json");
    await writeFile(designArtifactPath, `${JSON.stringify({
      schemaVersion: "1.0.0",
      kind: "synthetic-test-design-lock",
      directFinalUse: false,
    }, null, 2)}\n`, "utf8");
    await core.writeReceipt({
      stage: "DESIGN_LOCKED",
      files: [designArtifactPath],
      inputReceiptHashes: [await core.sha256File(join(root, "receipts", "evidence-lock.json"))],
      output: join(root, "receipts", "design-lock.json"),
    });
    await core.advanceProject(root, "DESIGN_LOCKED");
  }
  return { root, response, terminologyPath, terminologyText };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(args: readonly string[]): Promise<CommandResult> {
  return runProcess(process.execPath, ["--import", "tsx", "apps/kpp-cli/src/main.ts", ...args]);
}

async function runProcess(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
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
