import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

let lockRequirements: typeof import("@kpp/core").lockRequirements;

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

describe("requirement confirmation and conflict ledger", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    expect(await runProcess("npm", ["run", "build"])).toMatchObject({ code: 0, stderr: "" });
    ({ lockRequirements } = await import("@kpp/core"));
  });

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ));
  });

  it("refuses to lock an unresolved page-limit conflict", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await initializeAndIngest(fixture);

    await expect(lockRequirements(fixture.root, {
      candidates: fixture.candidates,
      decisions: fixture.conflictingDecisions,
    })).rejects.toMatchObject({
      code: "KPP_INPUT_REQUIREMENT_CONFLICT",
    });

    await expect(readFile(join(fixture.root, "receipts", "requirements-lock.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(fixture.root, "requirements", "requirements.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });

    await expect(lockRequirements(fixture.root, {
      candidates: fixture.candidates,
      decisions: fixture.issuerPrecedenceDecisions,
    })).resolves.toMatchObject({ state: "REQUIREMENTS_LOCKED" });
  });

  it("uses the issuer rule over a conflicting cohort convention and records every human decision", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await initializeAndIngest(fixture);

    const result = await lockRequirements(fixture.root, {
      candidates: fixture.candidates,
      decisions: fixture.issuerPrecedenceDecisions,
    });

    expect(result.state).toBe("REQUIREMENTS_LOCKED");
    const requirements = JSON.parse(await readFile(
      join(fixture.root, "requirements", "requirements.json"),
      "utf8",
    )) as Record<string, unknown>;
    expect(requirements).toMatchObject({
      confirmationStatus: "confirmed",
      confirmedBy: "proposal-owner",
      requirements: [expect.objectContaining({ requirementId: "REQ-001" })],
    });

    const matrix = JSON.parse(await readFile(
      join(fixture.root, "requirements", "compliance-matrix.json"),
      "utf8",
    )) as { rows: Array<Record<string, unknown>> };
    expect(matrix.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidateId: "CAND-ISSUER",
        decision: "confirm",
        sourceLocator: "page:17",
        sourceAuthority: "issuer",
        decidedBy: "proposal-owner",
      }),
      expect.objectContaining({
        candidateId: "CAND-COHORT",
        decision: "confirm",
        sourceAuthority: "cohort",
        decisionStatus: "superseded",
      }),
    ]));

    const conflicts = JSON.parse(await readFile(
      join(fixture.root, "requirements", "conflicts.json"),
      "utf8",
    )) as { conflicts: Array<Record<string, unknown>> };
    expect(conflicts.conflicts).toEqual([
      expect.objectContaining({
        constraintKey: "body-page-limit",
        status: "resolved",
        resolution: "issuer_precedence",
        selectedCandidateId: "CAND-ISSUER",
      }),
    ]);

    await expect(readFile(join(fixture.root, "requirements", "decision-ledger.json"), "utf8"))
      .resolves.toContain('"decidedAt"');
    await expect(readFile(join(fixture.root, "receipts", "requirements-lock.json"), "utf8"))
      .resolves.toContain('"stage": "REQUIREMENTS_LOCKED"');
  });

  it("hands a locked requirements artifact to planning without relocking or replacing it", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await initializeAndIngest(fixture);
    const locked = await lockRequirements(fixture.root, {
      candidates: fixture.candidates,
      decisions: fixture.issuerPrecedenceDecisions,
    });

    const result = await run([
      "plan",
      fixture.root,
      "--requirements",
      locked.requirementsPath,
      "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: true,
      data: { state: "EVIDENCE_LOCKED" },
    });
  });

  it("canonicalizes relative candidate source paths before binding them into the receipt", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await initializeAndIngest(fixture);
    const relativeCandidates = {
      ...fixture.candidates,
      candidates: fixture.candidates.candidates.map((candidate) => ({
        ...candidate,
        sourcePath: relative(process.cwd(), candidate.sourcePath),
      })),
    };

    await lockRequirements(fixture.root, {
      candidates: relativeCandidates,
      decisions: fixture.issuerPrecedenceDecisions,
    });

    const receipt = JSON.parse(await readFile(
      join(fixture.root, "receipts", "requirements-lock.json"),
      "utf8",
    )) as { files: Array<{ path: string }> };
    expect(receipt.files.map(({ path }) => path)).toEqual(expect.arrayContaining([
      fixture.issuerPath,
      fixture.cohortPath,
    ]));
    expect(receipt.files.some(({ path }) => !path.startsWith("/"))).toBe(false);
  });

  it("does not grant issuer precedence to an unlocked source merely because a decision labels it issuer", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await initializeAndIngest(fixture);
    const declaredIssuer = {
      ...fixture.issuerPrecedenceDecisions,
      decisions: fixture.issuerPrecedenceDecisions.decisions.map((decision) => (
        decision.candidateId === "CAND-COHORT"
          ? { ...decision, sourceAuthority: "issuer" as const }
          : decision
      )),
    };

    await expect(lockRequirements(fixture.root, {
      candidates: fixture.candidates,
      decisions: declaredIssuer,
    })).rejects.toMatchObject({
      code: "KPP_INPUT_REQUIREMENT_SOURCE_UNVERIFIED",
    });
  });

  it("does not auto-confirm candidates and reports a stable decision-missing error through the CLI", async () => {
    const fixture = await createFixture(temporaryDirectories);
    await initializeAndIngest(fixture);
    const candidatesPath = join(fixture.root, "requirements", "candidates.json");
    const decisionsPath = join(fixture.fixtureDirectory, "decisions.json");
    await writeFile(candidatesPath, `${JSON.stringify({
      schemaVersion: "1.0.0",
      candidates: fixture.candidates.candidates,
    }, null, 2)}\n`);
    await writeFile(decisionsPath, `${JSON.stringify({
      ...fixture.issuerPrecedenceDecisions,
      decisions: [fixture.issuerPrecedenceDecisions.decisions[0]],
    }, null, 2)}\n`);

    const result = await run([
      "requirements",
      fixture.root,
      "--candidates",
      candidatesPath,
      "--decisions",
      decisionsPath,
      "--json",
    ]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: false,
      code: "KPP_INPUT_REQUIREMENT_DECISION_MISSING",
    });
    await expect(readFile(join(fixture.root, "receipts", "requirements-lock.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function createFixture(temporaryDirectories: string[]) {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "kpp-requirements-"));
  temporaryDirectories.push(fixtureDirectory);
  const root = join(fixtureDirectory, "project");
  const issuerPath = join(fixtureDirectory, "issuer-rfp.txt");
  const cohortPath = join(fixtureDirectory, "cohort-convention.txt");
  const issuerText = [
    "제안서 본문은 표지 및 간지를 제외하고 50쪽 이내로 한다.",
    "제안서 본문은 표지 및 간지를 제외하고 40쪽 이내로 한다.",
  ].join("\n").concat("\n");
  const cohortText = "동종 기관의 일반 관행은 제안서 본문 40쪽 이내이다.\n";
  await writeFile(issuerPath, issuerText, "utf8");
  await writeFile(cohortPath, cohortText, "utf8");
  const issuerSha256 = sha256(issuerText);
  const cohortSha256 = sha256(cohortText);

  const candidates = {
    schemaVersion: "1.0.0",
    candidates: [
      {
        candidateId: "CAND-ISSUER",
        sourcePath: issuerPath,
        sourceSha256: issuerSha256,
        sourceLocator: "page:17",
        extractedText: "제안서 본문은 표지 및 간지를 제외하고 50쪽 이내로 한다.",
        category: "page_limit",
        confidence: 0.95,
        status: "pending" as const,
      },
      {
        candidateId: "CAND-ISSUER-CONFLICT",
        sourcePath: issuerPath,
        sourceSha256: issuerSha256,
        sourceLocator: "page:18",
        extractedText: "제안서 본문은 표지 및 간지를 제외하고 40쪽 이내로 한다.",
        category: "page_limit",
        confidence: 0.95,
        status: "pending" as const,
      },
      {
        candidateId: "CAND-COHORT",
        sourcePath: cohortPath,
        sourceSha256: cohortSha256,
        sourceLocator: "section:2",
        extractedText: cohortText.trim(),
        category: "page_limit",
        confidence: 0.76,
        status: "pending" as const,
      },
    ],
  };
  const requirements = {
    requirements: [{
      requirementId: "REQ-001",
      title: "수행 방법",
      critical: false,
      pageRole: "approach_overview",
      surfaceTemplateId: "narrative-v1",
      claims: [],
      figureSpecs: [],
    }],
    evidenceBindings: [],
  };
  const decision = (candidate: typeof candidates.candidates[number], sourceAuthority: "issuer" | "cohort") => ({
    candidateId: candidate.candidateId,
    decision: "confirm" as const,
    constraintKey: "body-page-limit",
    sourceLocator: candidate.sourceLocator,
    sourceSha256: candidate.sourceSha256,
    sourceAuthority,
    decidedBy: "proposal-owner",
    decidedAt: "2026-08-17T03:00:00.000Z",
    rationale: "제출 규칙 확인",
  });
  return {
    fixtureDirectory,
    root,
    issuerPath,
    cohortPath,
    candidates,
    conflictingDecisions: {
      schemaVersion: "1.0.0",
      confirmedBy: "proposal-owner",
      requirements,
      decisions: [
        decision(candidates.candidates[0]!, "issuer"),
        decision(candidates.candidates[1]!, "issuer"),
        { ...decision(candidates.candidates[2]!, "cohort"), decision: "reject" as const },
      ],
      resolutions: [],
    },
    issuerPrecedenceDecisions: {
      schemaVersion: "1.0.0",
      confirmedBy: "proposal-owner",
      requirements,
      decisions: [
        decision(candidates.candidates[0]!, "issuer"),
        { ...decision(candidates.candidates[1]!, "issuer"), decision: "reject" as const },
        decision(candidates.candidates[2]!, "cohort"),
      ],
      resolutions: [],
    },
  };
}

async function initializeAndIngest(fixture: { root: string; issuerPath: string }): Promise<void> {
  expect(await run(["init", fixture.root, "--json"])).toMatchObject({ code: 0, stderr: "" });
  expect(await run(["ingest", fixture.root, fixture.issuerPath, "--json"])).toMatchObject({ code: 0, stderr: "" });
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

function parseEnvelope(output: string): CliEnvelope {
  return JSON.parse(output) as CliEnvelope;
}
