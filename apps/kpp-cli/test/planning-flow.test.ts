import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { advanceProject, sha256File, writeReceipt } from "@kpp/core";

interface CliEnvelope {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

describe("KPP planning flow", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    expect(await runProcess("npm", ["run", "build"])).toMatchObject({ code: 0, stderr: "" });
  });

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it("locks copied sources, preserves confirmed page order, and blocks a critical missing claim", async () => {
    const fixture = await createFixture(temporaryDirectories);

    expect(await run(["init", fixture.root, "--json"])).toMatchObject({ code: 0, stderr: "" });
    const ingested = await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);
    expect(ingested).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(ingested.stdout)).toMatchObject({
      ok: true,
      code: "KPP_OK",
      data: { state: "SOURCE_LOCKED" },
    });

    const planned = await run([
      "plan",
      fixture.root,
      "--requirements",
      fixture.confirmedRequirementsPath,
      "--json",
    ]);
    expect(planned).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(planned.stdout)).toMatchObject({
      ok: true,
      code: "KPP_OK",
      data: { state: "EVIDENCE_LOCKED" },
    });

    const manifest = JSON.parse(
      await readFile(join(fixture.root, "sources", "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest).toEqual({
      schemaVersion: "1.0.0",
      sources: [{
        sourceId: "SRC-001",
        role: "rfp",
        originalPath: fixture.rfpPath,
        copiedPath: join(fixture.root, "sources", basename(fixture.rfpPath)),
        sha256: "76d1c0e388643674716ba868e85e4a36cd1471c4440308e9c58f69d433e9133f",
      }],
    });

    const requirements = JSON.parse(
      await readFile(join(fixture.root, "requirements", "requirements.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(requirements).toMatchObject({
      confirmationStatus: "confirmed",
      confirmedBy: "proposal-owner",
      requirements: [
        { requirementId: "REQ-002", critical: false },
        { requirementId: "REQ-001", critical: true },
      ],
    });

    const pagePlan = JSON.parse(
      await readFile(join(fixture.root, "content", "page-plan.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(pagePlan).toEqual({
      schemaVersion: "1.0.0",
      pages: [
        {
          pageId: "PAGE-001",
          requirementId: "REQ-002",
          pageRole: "approach_overview",
          surfaceTemplateId: "narrative-v1",
          claimIds: ["CLAIM-002", "CLAIM-000"],
          figureSpecs: [
            {
              figureId: "FIG-002",
              requirementId: "REQ-002",
              pageId: "PAGE-001",
              title: "수행 절차",
              intent: "flow",
              dataShape: "process_flow",
              decisionTask: "수행 절차를 검토한다.",
              claimIds: ["CLAIM-002"],
              evidenceIds: ["EVID-002"],
              family: "flow",
              renderer: "svg-flow",
            },
            {
              figureId: "FIG-001",
              requirementId: "REQ-002",
              pageId: "PAGE-001",
              title: "수행 일정",
              intent: "schedule",
              dataShape: "time_axis",
              decisionTask: "수행 일정을 검토한다.",
              claimIds: ["CLAIM-002"],
              evidenceIds: ["EVID-002"],
              family: "gantt",
              renderer: "svg-gantt",
            },
          ],
        },
        {
          pageId: "PAGE-002",
          requirementId: "REQ-001",
          pageRole: "qualification_evidence",
          surfaceTemplateId: "evidence-grid-v1",
          claimIds: ["CLAIM-001"],
          figureSpecs: [],
        },
      ],
    });

    const ledger = JSON.parse(
      await readFile(join(fixture.root, "evidence", "evidence-ledger.json"), "utf8"),
    ) as { claims: Array<{ claimId: string; status: string }>; bindings: unknown[] };
    expect(ledger.claims).toEqual([
      { claimId: "CLAIM-002", status: "bounded", evidenceIds: ["EVID-002"] },
      { claimId: "CLAIM-000", status: "pending_blank", evidenceIds: [] },
      { claimId: "CLAIM-001", status: "blocked", evidenceIds: [] },
    ]);
    expect(ledger.bindings).toHaveLength(1);

    await expect(readFile(join(fixture.root, "receipts", "source-lock.json"), "utf8"))
      .resolves.toContain('"stage": "SOURCE_LOCKED"');
    await expect(readFile(join(fixture.root, "receipts", "requirements-lock.json"), "utf8"))
      .resolves.toContain('"stage": "REQUIREMENTS_LOCKED"');
    await expect(readFile(join(fixture.root, "receipts", "evidence-lock.json"), "utf8"))
      .resolves.toContain('"stage": "EVIDENCE_LOCKED"');
  });

  it("never advances parser-pending requirements as user-confirmed", async () => {
    const fixture = await createFixture(temporaryDirectories);
    const pendingPath = join(fixture.fixtureDirectory, "pending-requirements.json");
    await writeFile(pendingPath, `${JSON.stringify({
      schemaVersion: "1.0.0",
      confirmationStatus: "pending",
      confirmedBy: null,
      requirements: [],
    }, null, 2)}\n`);

    await run(["init", fixture.root, "--json"]);
    await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);
    const result = await run([
      "plan",
      fixture.root,
      "--requirements",
      pendingPath,
      "--json",
    ]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: false,
      code: "KPP_INPUT_REQUIREMENTS_UNCONFIRMED",
    });
    const status = parseEnvelope((await run(["status", fixture.root, "--json"])).stdout);
    expect(status.data).toMatchObject({ state: "SOURCE_LOCKED" });
    await expect(readFile(join(fixture.root, "receipts", "requirements-lock.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks generic-card and unbound semantic figures before requirements lock", async () => {
    const fixture = await createFixture(temporaryDirectories);
    const raw = JSON.parse(await readFile(fixture.confirmedRequirementsPath, "utf8")) as {
      requirements: Array<{ figureSpecs: Array<Record<string, unknown>> }>;
    };
    raw.requirements[0]!.figureSpecs[0] = {
      ...raw.requirements[0]!.figureSpecs[0],
      family: "generic_cards",
    };
    await writeFile(fixture.confirmedRequirementsPath, `${JSON.stringify(raw, null, 2)}\n`);

    await run(["init", fixture.root, "--json"]);
    await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);
    const genericResult = await run([
      "plan", fixture.root, "--requirements", fixture.confirmedRequirementsPath, "--json",
    ]);
    expect(parseEnvelope(genericResult.stdout)).toMatchObject({
      ok: false,
      code: "KPP_INPUT_REQUIREMENTS_INVALID",
    });

    raw.requirements[0]!.figureSpecs[0] = {
      ...raw.requirements[0]!.figureSpecs[0],
      family: "flow",
      renderer: "svg-flow",
      evidenceIds: ["EV-404"],
    };
    await writeFile(fixture.confirmedRequirementsPath, `${JSON.stringify(raw, null, 2)}\n`);
    const unboundResult = await run([
      "plan", fixture.root, "--requirements", fixture.confirmedRequirementsPath, "--json",
    ]);
    expect(parseEnvelope(unboundResult.stdout)).toMatchObject({
      ok: false,
      code: "KPP_EVIDENCE_FIGURE_UNBOUND",
    });
    expect(parseEnvelope((await run(["status", fixture.root, "--json"])).stdout).data)
      .toMatchObject({ state: "SOURCE_LOCKED" });
  });

  it("rejects planning after the locked source copy is mutated", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await run(["init", fixture.root, "--json"]);
    await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);
    await writeFile(join(fixture.root, "sources", basename(fixture.rfpPath)), "mutated source");

    const result = await run([
      "plan",
      fixture.root,
      "--requirements",
      fixture.confirmedRequirementsPath,
      "--json",
    ]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: false,
      code: "KPP_INPUT_RECEIPT_INVALID",
      data: { stage: "SOURCE_LOCKED" },
    });
    const status = parseEnvelope((await run(["status", fixture.root, "--json"])).stdout);
    expect(status.data).toMatchObject({ state: "INIT" });
  });

  it("persists a verified local evidence binding scoped to its planned page", async () => {
    const fixture = await createFixture(temporaryDirectories);
    const evidencePath = join(fixture.fixtureDirectory, "qualification-evidence.txt");
    await writeFile(evidencePath, "bounded evidence\n");
    const confirmed = await readConfirmedRequirements(fixture.confirmedRequirementsPath);
    confirmed.requirements[0]!.claims[0]!.evidenceIds = ["EVID-001"];
    confirmed.requirements[0]!.figureSpecs = confirmed.requirements[0]!.figureSpecs.map((figure) => ({
      ...figure,
      evidenceIds: ["EVID-001"],
    }));
    confirmed.evidenceBindings = [{
      evidenceId: "EVID-001",
      sourcePath: evidencePath,
      sourceSha256: "7cff0d584ffede54caedd0b1ea816a1a91d66ca9aa92f978eddf3f43cb612e60",
      scope: "사업 수행 방법의 근거 문구",
      claimIds: ["CLAIM-002"],
      targetRequirementId: "REQ-002",
      targetPageId: "PAGE-001",
      targetPageRole: "approach_overview",
    }];
    await writeFile(fixture.confirmedRequirementsPath, `${JSON.stringify(confirmed, null, 2)}\n`);

    await run(["init", fixture.root, "--json"]);
    await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);
    const result = await run([
      "plan", fixture.root, "--requirements", fixture.confirmedRequirementsPath, "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    const ledger = JSON.parse(
      await readFile(join(fixture.root, "evidence", "evidence-ledger.json"), "utf8"),
    ) as { bindings: unknown[]; claims: unknown[] };
    expect(ledger.bindings).toEqual(confirmed.evidenceBindings);
    expect(ledger.claims).toContainEqual({
      claimId: "CLAIM-002",
      status: "bounded",
      evidenceIds: ["EVID-001"],
    });
    const evidenceReceipt = JSON.parse(
      await readFile(join(fixture.root, "receipts", "evidence-lock.json"), "utf8"),
    ) as { files: Array<{ path: string }> };
    expect(evidenceReceipt.files.map(({ path }) => path)).toContain(evidencePath);
  });

  it("rejects an evidence id without a resolvable binding before requirements advance", async () => {
    const fixture = await createFixture(temporaryDirectories);
    const confirmed = await readConfirmedRequirements(fixture.confirmedRequirementsPath);
    confirmed.requirements[0]!.claims[0]!.evidenceIds = ["FABRICATED-EVIDENCE"];
    await writeFile(fixture.confirmedRequirementsPath, `${JSON.stringify(confirmed, null, 2)}\n`);

    await run(["init", fixture.root, "--json"]);
    await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);
    const result = await run([
      "plan", fixture.root, "--requirements", fixture.confirmedRequirementsPath, "--json",
    ]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: false,
      code: "KPP_INPUT_EVIDENCE_UNRESOLVED",
    });
    expect(parseEnvelope((await run(["status", fixture.root, "--json"])).stdout).data)
      .toMatchObject({ state: "SOURCE_LOCKED" });
    await expect(readFile(join(fixture.root, "receipts", "requirements-lock.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects evidence whose source hash or target page does not match the binding", async () => {
    for (const invalid of [
      {
        sourceSha256: "a".repeat(64),
        targetPageId: "PAGE-001",
      },
      {
        sourceSha256: "7cff0d584ffede54caedd0b1ea816a1a91d66ca9aa92f978eddf3f43cb612e60",
        targetPageId: "PAGE-999",
      },
    ]) {
      const fixture = await createFixture(temporaryDirectories);
      const evidencePath = join(fixture.fixtureDirectory, "qualification-evidence.txt");
      await writeFile(evidencePath, "bounded evidence\n");
      const confirmed = await readConfirmedRequirements(fixture.confirmedRequirementsPath);
      confirmed.requirements[0]!.claims[0]!.evidenceIds = ["EVID-001"];
      confirmed.evidenceBindings = [{
        evidenceId: "EVID-001",
        sourcePath: evidencePath,
        sourceSha256: invalid.sourceSha256,
        scope: "사업 수행 방법의 근거 문구",
        claimIds: ["CLAIM-002"],
        targetRequirementId: "REQ-002",
        targetPageId: invalid.targetPageId,
        targetPageRole: "approach_overview",
      }];
      await writeFile(fixture.confirmedRequirementsPath, `${JSON.stringify(confirmed, null, 2)}\n`);
      await run(["init", fixture.root, "--json"]);
      await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);

      const result = await run([
        "plan", fixture.root, "--requirements", fixture.confirmedRequirementsPath, "--json",
      ]);

      expect(result).toMatchObject({ code: 1, stderr: "" });
      expect(parseEnvelope(result.stdout)).toMatchObject({
        ok: false,
        code: "KPP_INPUT_EVIDENCE_UNRESOLVED",
      });
      expect(parseEnvelope((await run(["status", fixture.root, "--json"])).stdout).data)
        .toMatchObject({ state: "SOURCE_LOCKED" });
    }
  });

  it("resumes a persisted REQUIREMENTS_LOCKED intermediate with identical input", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await run(["init", fixture.root, "--json"]);
    await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);
    await persistRequirementsLockedIntermediate(fixture);

    const result = await run([
      "plan", fixture.root, "--requirements", fixture.confirmedRequirementsPath, "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: true,
      data: { state: "EVIDENCE_LOCKED" },
    });
    await expect(readFile(join(fixture.root, "receipts", "evidence-lock.json"), "utf8"))
      .resolves.toContain('"stage": "EVIDENCE_LOCKED"');
    await expect(readFile(join(fixture.root, "release"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not replace a valid requirements lock with changed recovery input", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await run(["init", fixture.root, "--json"]);
    await run(["ingest", fixture.root, fixture.rfpPath, "--json"]);
    await persistRequirementsLockedIntermediate(fixture);
    const changed = await readConfirmedRequirements(fixture.confirmedRequirementsPath);
    changed.requirements[0]!.title = "changed after lock";
    await writeFile(fixture.confirmedRequirementsPath, `${JSON.stringify(changed, null, 2)}\n`);

    const result = await run([
      "plan", fixture.root, "--requirements", fixture.confirmedRequirementsPath, "--json",
    ]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: false,
      code: "KPP_INPUT_REQUIREMENTS_RECOVERY_MISMATCH",
    });
    expect(parseEnvelope((await run(["status", fixture.root, "--json"])).stdout).data)
      .toMatchObject({ state: "REQUIREMENTS_LOCKED" });
    await expect(readFile(join(fixture.root, "receipts", "evidence-lock.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

interface ConfirmedRequirementsFixture {
  schemaVersion: string;
  confirmationStatus: "confirmed";
  confirmedBy: string;
  evidenceBindings: Array<Record<string, unknown>>;
  requirements: Array<{
    requirementId: string;
    title: string;
    critical: boolean;
    pageRole: string;
    surfaceTemplateId: string;
    claims: Array<{ claimId: string; critical: boolean; evidenceIds: string[] }>;
    figureSpecs: Array<{
      figureId: string;
      title: string;
      intent: string;
      dataShape: string;
      decisionTask: string;
      claimIds: string[];
      evidenceIds: string[];
      family: string;
      renderer: string;
    }>;
  }>;
}

async function createFixture(temporaryDirectories: string[]): Promise<{
  readonly root: string;
  readonly fixtureDirectory: string;
  readonly rfpPath: string;
  readonly confirmedRequirementsPath: string;
}> {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "kpp-planning-fixture-"));
  const root = await mkdtemp(join(tmpdir(), "kpp-planning-project-"));
  temporaryDirectories.push(fixtureDirectory, root);
  const rfpPath = join(fixtureDirectory, "rfp.txt");
  const methodEvidencePath = join(fixtureDirectory, "method-evidence.txt");
  const confirmedRequirementsPath = join(fixtureDirectory, "confirmed-requirements.json");
  await writeFile(rfpPath, "official RFP\n");
  await writeFile(methodEvidencePath, "method evidence\n");
  const methodEvidenceSha256 = await sha256File(methodEvidencePath);
  await writeFile(confirmedRequirementsPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    confirmationStatus: "confirmed",
    confirmedBy: "proposal-owner",
    evidenceBindings: [{
      evidenceId: "EVID-002",
      sourcePath: methodEvidencePath,
      sourceSha256: methodEvidenceSha256,
      scope: "사업 수행 방법의 확인 근거",
      claimIds: ["CLAIM-002"],
      targetRequirementId: "REQ-002",
      targetPageId: "PAGE-001",
      targetPageRole: "approach_overview",
    }],
    requirements: [
      {
        requirementId: "REQ-002",
        title: "사업 수행 방법",
        critical: false,
        pageRole: "approach_overview",
        surfaceTemplateId: "narrative-v1",
        claims: [
          { claimId: "CLAIM-002", critical: false, evidenceIds: ["EVID-002"] },
          { claimId: "CLAIM-000", critical: false, evidenceIds: [] },
        ],
        figureSpecs: [
          {
            figureId: "FIG-002",
            title: "수행 절차",
            intent: "flow",
            dataShape: "process_flow",
            decisionTask: "수행 절차를 검토한다.",
            claimIds: ["CLAIM-002"],
            evidenceIds: ["EVID-002"],
            family: "flow",
            renderer: "svg-flow",
          },
          {
            figureId: "FIG-001",
            title: "수행 일정",
            intent: "schedule",
            dataShape: "time_axis",
            decisionTask: "수행 일정을 검토한다.",
            claimIds: ["CLAIM-002"],
            evidenceIds: ["EVID-002"],
            family: "gantt",
            renderer: "svg-gantt",
          },
        ],
      },
      {
        requirementId: "REQ-001",
        title: "입찰 자격",
        critical: true,
        pageRole: "qualification_evidence",
        surfaceTemplateId: "evidence-grid-v1",
        claims: [{ claimId: "CLAIM-001", critical: true, evidenceIds: [] }],
        figureSpecs: [],
      },
    ],
  }, null, 2)}\n`);

  return { root, fixtureDirectory, rfpPath, confirmedRequirementsPath };
}

async function readConfirmedRequirements(path: string): Promise<ConfirmedRequirementsFixture> {
  return JSON.parse(await readFile(path, "utf8")) as ConfirmedRequirementsFixture;
}

async function persistRequirementsLockedIntermediate(fixture: {
  readonly root: string;
  readonly confirmedRequirementsPath: string;
}): Promise<void> {
  const input = await readConfirmedRequirements(fixture.confirmedRequirementsPath);
  const requirements = structuredClone(input);
  const pagePlan = {
    schemaVersion: "1.0.0",
    pages: requirements.requirements.map((requirement, index) => ({
      pageId: `PAGE-${String(index + 1).padStart(3, "0")}`,
      requirementId: requirement.requirementId,
      pageRole: requirement.pageRole,
      surfaceTemplateId: requirement.surfaceTemplateId,
      claimIds: requirement.claims.map(({ claimId }) => claimId),
      figureSpecs: requirement.figureSpecs.map((figure) => ({
        ...figure,
        requirementId: requirement.requirementId,
        pageId: `PAGE-${String(index + 1).padStart(3, "0")}`,
      })),
    })),
  };
  const persistedRequirementsPath = join(fixture.root, "requirements", "requirements.json");
  const pagePlanPath = join(fixture.root, "content", "page-plan.json");
  const sourceReceiptPath = join(fixture.root, "receipts", "source-lock.json");
  await writeFile(persistedRequirementsPath, `${JSON.stringify(requirements, null, 2)}\n`);
  await writeFile(pagePlanPath, `${JSON.stringify(pagePlan, null, 2)}\n`);
  await writeReceipt({
    stage: "REQUIREMENTS_LOCKED",
    files: [persistedRequirementsPath, pagePlanPath],
    inputReceiptHashes: [await sha256File(sourceReceiptPath)],
    output: join(fixture.root, "receipts", "requirements-lock.json"),
  });
  await advanceProject(fixture.root, "REQUIREMENTS_LOCKED");
}

async function run(args: readonly string[]): Promise<CommandResult> {
  return runProcess(process.execPath, [
    "--import",
    "tsx",
    "apps/kpp-cli/src/main.ts",
    ...args,
  ]);
}

async function runProcess(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
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

function parseEnvelope(output: string): CliEnvelope {
  return JSON.parse(output) as CliEnvelope;
}
