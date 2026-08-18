import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
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

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "core",
  "test",
  "fixtures",
  "research-lock",
);

describe("kpp research-lock", () => {
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

  it("imports a LongTable handoff through a stable JSON envelope", async () => {
    const root = await createResearchProject(temporaryDirectories);

    const result = await run([
      "research-lock",
      root,
      "--handoff",
      join(fixtureDirectory, "valid-handoff.json"),
      "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: true,
      code: "KPP_OK",
      data: {
        state: "PASS",
        receiptPath: join(root, "receipts", "research-lock.json"),
      },
    });
  });

  it("reports open required checkpoints as a stable research error", async () => {
    const root = await createResearchProject(temporaryDirectories);

    const result = await run([
      "research-lock",
      root,
      "--handoff",
      join(fixtureDirectory, "open-checkpoint-handoff.json"),
      "--json",
    ]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: false,
      code: "PP_RESEARCH_CHECKPOINT_OPEN",
    });
  });
});

async function createResearchProject(temporaryDirectories: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-cli-research-lock-"));
  temporaryDirectories.push(root);
  expect(await run([
    "init",
    root,
    "--project-id",
    "research-lock-fixture",
    "--proposal-class",
    "research_service",
    "--json",
  ])).toMatchObject({ code: 0, stderr: "" });
  await cp(join(fixtureDirectory, "evidence"), join(root, "evidence"), { recursive: true });
  return root;
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
