import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

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

  it("locks copied sources and blocks a critical missing claim", async () => {
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
        { requirementId: "REQ-001", critical: true },
        { requirementId: "REQ-002", critical: false },
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
          requirementId: "REQ-001",
          pageRole: "qualification_evidence",
          surfaceTemplateId: "evidence-grid-v1",
          claimIds: ["CLAIM-001"],
          figureSpecs: [],
        },
        {
          pageId: "PAGE-002",
          requirementId: "REQ-002",
          pageRole: "approach_overview",
          surfaceTemplateId: "narrative-v1",
          claimIds: ["CLAIM-002"],
          figureSpecs: [{ figureId: "FIG-001", type: "gantt", title: "수행 일정" }],
        },
      ],
    });

    const ledger = JSON.parse(
      await readFile(join(fixture.root, "evidence", "evidence-ledger.json"), "utf8"),
    ) as { claims: Array<{ claimId: string; status: string }> };
    expect(ledger.claims).toEqual([
      { claimId: "CLAIM-001", status: "blocked", evidenceIds: [] },
      { claimId: "CLAIM-002", status: "pending_blank", evidenceIds: [] },
    ]);

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
});

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
  const confirmedRequirementsPath = join(fixtureDirectory, "confirmed-requirements.json");
  await writeFile(rfpPath, "official RFP\n");
  await writeFile(confirmedRequirementsPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    confirmationStatus: "confirmed",
    confirmedBy: "proposal-owner",
    requirements: [
      {
        requirementId: "REQ-002",
        title: "사업 수행 방법",
        critical: false,
        pageRole: "approach_overview",
        surfaceTemplateId: "narrative-v1",
        claims: [{ claimId: "CLAIM-002", critical: false, evidenceIds: [] }],
        figureSpecs: [{ figureId: "FIG-001", type: "gantt", title: "수행 일정" }],
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
