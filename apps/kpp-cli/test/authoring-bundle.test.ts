import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

let exportAuthoring: (typeof import("@longtable/kpp-core"))["exportAuthoring"];
let importAuthoring: (typeof import("@longtable/kpp-core"))["importAuthoring"];
let readProject: (typeof import("@longtable/kpp-core"))["readProject"];

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

describe("model-independent authoring bundle exchange", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    expect(await runProcess("npm", ["run", "build"])).toMatchObject({ code: 0, stderr: "" });
    ({ exportAuthoring, importAuthoring, readProject } = await import("@longtable/kpp-core"));
  });

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ));
  });

  it("exports deterministic evidence-bounded blocks and stores only a provisional response", async () => {
    const fixture = await createFixture(temporaryDirectories);
    const first = await exportAuthoring(fixture.root, fixture.authoringSources);
    const firstRequest = await readFile(first.requestPath, "utf8");
    const second = await exportAuthoring(fixture.root, fixture.authoringSources);

    expect(await readFile(second.requestPath, "utf8")).toBe(firstRequest);
    expect(JSON.parse(firstRequest)).toMatchObject({
      blocks: [expect.objectContaining({
        pageId: "PAGE-001",
        requirementId: "REQ-001",
        pageRole: "research_method",
        claimIds: ["CLAIM-001", "CLAIM-BLANK"],
        allowedEvidenceIds: ["EV-001"],
        permittedPendingBlankFields: ["CLAIM-BLANK"],
        requiredEvaluatorAnswer: expect.any(String),
      })],
      issuerProfile: expect.objectContaining({
        status: "provided",
        path: fixture.issuerProfilePath,
        sha256: sha256(fixture.issuerProfileText),
      }),
      terminology: expect.objectContaining({
        status: "provided",
        path: fixture.terminologyPath,
        sha256: sha256(fixture.terminologyText),
      }),
    });

    const before = await readProject(fixture.root);
    const result = await importAuthoring(fixture.root, fixture.validResponse);
    const after = await readProject(fixture.root);

    expect(result).toMatchObject({ responsePath: join(fixture.root, "content", "authoring-response.json") });
    expect(before.state).toBe("EVIDENCE_LOCKED");
    expect(after.state).toBe("EVIDENCE_LOCKED");
    await expect(readFile(join(fixture.root, "evidence", "evidence-ledger.json"), "utf8"))
      .resolves.toBe(fixture.initialLedger);
    expect(JSON.parse(await readFile(result.responsePath, "utf8"))).toMatchObject({
      blocks: [expect.objectContaining({ status: "provisional" })],
    });
  });

  it("rejects a new numeric claim absent from the evidence ledger", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await exportAuthoring(fixture.root, fixture.authoringSources);

    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      text: "본 연구는 근거에 따라 999쪽을 확인한다. {{CLAIM-BLANK}}",
    }))).rejects.toMatchObject({
      code: "KPP_EVIDENCE_UNBOUND_CLAIM",
    });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      evaluatorAnswer: "999개 기준에 직접 답변한다.",
    }))).rejects.toMatchObject({
      code: "KPP_EVIDENCE_UNBOUND_CLAIM",
    });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      text: "본 연구는 근거에 따라 ９９９쪽을 확인한다. {{CLAIM-BLANK}}",
    }))).rejects.toMatchObject({
      code: "KPP_EVIDENCE_UNBOUND_CLAIM",
    });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      text: "본 연구는 근거에 따라 구백구십구쪽을 확인한다. {{CLAIM-BLANK}}",
    }))).rejects.toMatchObject({
      code: "KPP_EVIDENCE_UNBOUND_CLAIM",
    });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      text: "본 연구는 근거에 따라 삼명을 확인한다. {{CLAIM-BLANK}}",
    }))).rejects.toMatchObject({
      code: "KPP_EVIDENCE_UNBOUND_CLAIM",
    });
    for (const unboundNativeNumeral of ["한 명", "두 개", "세 회", "네 가지", "다섯 년", "열 쪽"]) {
      await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
        text: `본 연구는 근거에 따라 ${unboundNativeNumeral}을 확인한다. {{CLAIM-BLANK}}`,
      }))).rejects.toMatchObject({
        code: "KPP_EVIDENCE_UNBOUND_CLAIM",
      });
    }
  });

  it("rejects unknown response page, claim, and evidence IDs", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await exportAuthoring(fixture.root, fixture.authoringSources);

    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      pageId: "PAGE-UNKNOWN",
    }))).rejects.toMatchObject({ code: "KPP_EVIDENCE_UNBOUND_CLAIM" });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      claimIds: ["CLAIM-UNKNOWN"],
    }))).rejects.toMatchObject({ code: "KPP_EVIDENCE_UNBOUND_CLAIM" });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      evidenceIds: ["EV-UNKNOWN"],
    }))).rejects.toMatchObject({ code: "KPP_EVIDENCE_UNBOUND_CLAIM" });
  });

  it("rejects verified status, missing evaluator answer, length overflow, and undeclared blanks", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await exportAuthoring(fixture.root, fixture.authoringSources);

    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      status: "verified",
    }))).rejects.toMatchObject({ code: "KPP_INPUT_AUTHORING_STATUS" });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      evaluatorAnswer: "",
    }))).rejects.toMatchObject({ code: "KPP_INPUT_AUTHORING_EVALUATOR_ANSWER_MISSING" });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      text: "가".repeat(1_201),
      pendingBlankFieldIds: [],
    }))).rejects.toMatchObject({ code: "KPP_INPUT_AUTHORING_LENGTH" });
    await expect(importAuthoring(fixture.root, responseWith(fixture.validResponse, {
      text: "본 연구는 근거에 따라 50쪽을 확인한다. {{FIELD-UNKNOWN}}",
      pendingBlankFieldIds: ["FIELD-UNKNOWN"],
    }))).rejects.toMatchObject({ code: "KPP_INPUT_AUTHORING_BLANK" });
  });

  it("exposes export and import through the CLI without changing project state", async () => {
    const fixture = await createFixture(temporaryDirectories);
    const exportResult = await run([
      "export-authoring",
      fixture.root,
      "--issuer-profile",
      fixture.issuerProfilePath,
      "--terminology",
      fixture.terminologyPath,
      "--json",
    ]);
    expect(exportResult).toMatchObject({ code: 0, stderr: "" });

    const responsePath = join(fixture.fixtureDirectory, "response.json");
    await writeFile(responsePath, `${JSON.stringify(fixture.validResponse, null, 2)}\n`, "utf8");
    const importResult = await run([
      "import-authoring",
      fixture.root,
      "--response",
      responsePath,
      "--json",
    ]);
    expect(importResult).toMatchObject({ code: 0, stderr: "" });
    expect(await readProject(fixture.root)).toMatchObject({ state: "EVIDENCE_LOCKED" });
  });
});

function responseWith(
  response: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const [block] = response.blocks as Array<Record<string, unknown>>;
  return {
    ...response,
    blocks: [{ ...block, ...overrides }],
  };
}

async function createFixture(temporaryDirectories: string[]) {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "kpp-authoring-"));
  temporaryDirectories.push(fixtureDirectory);
  const root = join(fixtureDirectory, "project");
  const rfpPath = join(fixtureDirectory, "issuer-rfp.txt");
  const evidencePath = join(fixtureDirectory, "evidence.txt");
  const issuerProfilePath = join(fixtureDirectory, "issuer-profile.json");
  const terminologyPath = join(fixtureDirectory, "terminology.json");
  const rfpText = "제안서 본문은 표지 및 간지를 제외하고 50쪽 이내로 한다.\n";
  const evidenceText = "공식 확인자료: 본문은 50쪽 이내로 작성한다. 부록에는 무관한 999쪽 정보가 있다.\n";
  const issuerProfile = {
    schemaVersion: "1.0.0",
    issuerName: "한국환경산업기술원",
    rules: [],
  };
  const terminology = {
    schemaVersion: "1.0.0",
    entries: [{ term: "연구 기준선", definition: "연구 시작 시점의 확인 기준" }],
  };
  const issuerProfileText = `${JSON.stringify(issuerProfile, null, 2)}\n`;
  const terminologyText = `${JSON.stringify(terminology, null, 2)}\n`;
  await Promise.all([
    writeFile(rfpPath, rfpText, "utf8"),
    writeFile(evidencePath, evidenceText, "utf8"),
    writeFile(issuerProfilePath, issuerProfileText, "utf8"),
    writeFile(terminologyPath, terminologyText, "utf8"),
  ]);

  expect(await run(["init", root, "--document-mode", "research_service", "--json"])).toMatchObject({ code: 0, stderr: "" });
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
        { claimId: "CLAIM-BLANK", critical: false, evidenceIds: [] },
      ],
      figureSpecs: [{
        figureId: "FIG-001",
        title: "수행 일정",
        intent: "schedule",
        dataShape: "time_axis",
        decisionTask: "수행 일정을 검토한다.",
        semanticValueIntent: "operational_control",
        decisionEffect: "일정의 담당자와 검증 관문을 확정한다.",
        nonDuplicateOf: ["BLK-SCHEDULE-NARRATIVE"],
        encodedVariables: ["owner", "timing", "acceptance"],
        claimIds: ["CLAIM-001"],
        evidenceIds: ["EV-001"],
        family: "gantt",
        renderer: "svg-gantt",
      }],
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
  const initialLedger = await readFile(join(root, "evidence", "evidence-ledger.json"), "utf8");

  const validResponse = {
    schemaVersion: "1.0.0",
    blocks: [{
      pageId: "PAGE-001",
      claimIds: ["CLAIM-001", "CLAIM-BLANK"],
      evidenceIds: ["EV-001"],
      status: "provisional",
      text: "본 연구는 공식 확인자료에 따라 50쪽 이내 기준을 적용한다. {{CLAIM-BLANK}}",
      evaluatorAnswer: "확인 가능한 근거와 수행 방법을 함께 제시한다.",
      pendingBlankFieldIds: ["CLAIM-BLANK"],
    }],
  };

  return {
    fixtureDirectory,
    root,
    issuerProfilePath,
    issuerProfileText,
    terminologyPath,
    terminologyText,
    initialLedger,
    validResponse,
    authoringSources: {
      issuerProfile: { path: issuerProfilePath, value: issuerProfile },
      terminology: { path: terminologyPath, value: terminology },
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function run(args: readonly string[]): Promise<CommandResult> {
  return runProcess(process.execPath, ["--import", "tsx", "apps/kpp-cli/src/main.ts", ...args]);
}

async function runProcess(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
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
