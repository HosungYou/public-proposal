import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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

describe("kpp CLI", () => {
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

  it("initializes the approved local structure and reports INIT", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpp-cli-"));
    temporaryDirectories.push(root);

    const initialized = await run(["init", root, "--json"]);
    expect(initialized).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(initialized.stdout)).toMatchObject({
      ok: true,
      code: "KPP_OK",
      data: { projectId: basename(root) },
    });

    const status = await run(["status", root, "--json"]);
    expect(status).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(status.stdout)).toMatchObject({
      ok: true,
      code: "KPP_OK",
      data: { state: "INIT" },
    });

    await expect(readFile(join(root, "kpp.project.yaml"), "utf8")).resolves.toContain("state: INIT");
    await expect(Promise.all([
      stat(join(root, "sources")),
      stat(join(root, "requirements")),
      stat(join(root, "evidence")),
      stat(join(root, "content")),
      stat(join(root, "figures")),
      stat(join(root, "build")),
      stat(join(root, "rendered")),
      stat(join(root, "audit")),
      stat(join(root, "receipts")),
    ])).resolves.toHaveLength(9);
    await expect(readdir(root)).resolves.not.toContain("release");
  });

  it("returns a stable JSON input error when status has no project", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpp-cli-"));
    temporaryDirectories.push(root);

    const result = await run(["status", root, "--json"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: false,
      code: "KPP_INPUT_PROJECT_READ",
    });
  });

  it("reports portable diagnostic checks in the JSON envelope", async () => {
    const result = await run(["doctor", "--json"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const envelope = parseEnvelope(result.stdout);
    expect(envelope).toMatchObject({ ok: true, code: "KPP_OK" });
    expect(envelope.data).toMatchObject({
      platform: process.platform,
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "node" }),
        expect.objectContaining({ name: "python" }),
        expect.objectContaining({ name: "soffice" }),
        expect.objectContaining({ name: "noto_fonts" }),
        expect.objectContaining({ name: "temp_storage" }),
        expect.objectContaining({ name: "worker_protocol" }),
      ]),
    });
  });

  it("runs the compiled doctor executable", async () => {
    const build = await runProcess("npm", ["run", "build"]);
    expect(build).toMatchObject({ code: 0, stderr: "" });

    const result = await runProcess(process.execPath, ["apps/kpp-cli/dist/main.js", "doctor", "--json"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: true,
      code: "KPP_OK",
    });
  });
});

async function run(args: readonly string[]): Promise<CommandResult> {
  return runProcess(process.execPath, ["--import", "tsx", "apps/kpp-cli/src/main.ts", ...args]);
}

async function runProcess(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
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
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseEnvelope(output: string): CliEnvelope {
  return JSON.parse(output) as CliEnvelope;
}
