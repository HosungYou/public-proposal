import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDoctorCandidates } from "../src/commands/doctor.js";

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

  it("does not pass worker protocol when only the version environment value is set", async () => {
    const result = await runProcess(process.execPath, ["apps/kpp-cli/dist/main.js", "doctor", "--json"], {
      KPP_WORKER_PATH: undefined,
      KPP_WORKER_PROTOCOL_VERSION: "1.0.0",
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(checkNamed(parseEnvelope(result.stdout), "worker_protocol")).toMatchObject({
      status: "warn",
      detected: { expected: "1.0.0", actual: null },
    });
  });

  it("passes worker protocol only after the configured worker handshake", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-worker-"));
    temporaryDirectories.push(directory);
    const worker = join(directory, "worker.mjs");
    await writeFile(worker, "#!/usr/bin/env node\nif (process.argv[2] === '--protocol-version') process.stdout.write('1.0.0\\n');\n");
    await chmod(worker, 0o755);

    const result = await runProcess(process.execPath, ["apps/kpp-cli/dist/main.js", "doctor", "--json"], {
      KPP_WORKER_PATH: worker,
      KPP_WORKER_PROTOCOL_VERSION: undefined,
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(checkNamed(parseEnvelope(result.stdout), "worker_protocol")).toMatchObject({
      status: "pass",
      detected: { expected: "1.0.0", actual: "1.0.0", worker },
    });
  });

  it("runs the compiled kpp bin directly with executable permissions", async () => {
    const build = await runProcess("npm", ["run", "build"]);
    expect(build).toMatchObject({ code: 0, stderr: "" });

    const executable = join(process.cwd(), "apps/kpp-cli/dist/main.js");
    const metadata = await stat(executable);
    expect(metadata.mode & 0o111).not.toBe(0);

    const result = await runProcess(executable, ["doctor", "--json"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: true,
      code: "KPP_OK",
    });
  });
});

describe("portable doctor candidates", () => {
  it("includes Windows command and font candidates", () => {
    const candidates = getDoctorCandidates("win32", {
      KPP_SOFFICE_PATH: "D:\\LibreOffice\\soffice.exe",
      SystemRoot: "C:\\Windows",
    }, "C:\\Users\\kpp");

    expect(candidates.python).toEqual(expect.arrayContaining(["py", "python"]));
    expect(candidates.soffice).toEqual(expect.arrayContaining([
      "D:\\LibreOffice\\soffice.exe",
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "soffice.exe",
    ]));
    expect(candidates.notoSans).toContain("C:\\Windows\\Fonts\\NotoSansCJKkr-Regular.otf");
    expect(candidates.notoSerif).toContain("C:\\Windows\\Fonts\\NotoSerifCJKkr-Regular.otf");
  });

  it("includes Linux executable and font candidates", () => {
    const candidates = getDoctorCandidates("linux", {}, "/home/kpp");

    expect(candidates.python).toEqual(expect.arrayContaining(["python3", "python"]));
    expect(candidates.soffice).toEqual(expect.arrayContaining(["/usr/bin/soffice", "soffice", "libreoffice"]));
    expect(candidates.notoSans).toContain("/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf");
    expect(candidates.notoSerif).toContain("/usr/share/fonts/opentype/noto/NotoSerifCJKkr-Regular.otf");
  });
});

async function run(args: readonly string[]): Promise<CommandResult> {
  return runProcess(process.execPath, ["--import", "tsx", "apps/kpp-cli/src/main.ts", ...args]);
}

async function runProcess(
  command: string,
  args: readonly string[],
  overrides?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...overrides },
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

function checkNamed(envelope: CliEnvelope, name: string): Record<string, unknown> {
  const checks = envelope.data.checks;
  if (!Array.isArray(checks)) {
    throw new Error("doctor envelope did not include checks");
  }
  const check = checks.find((candidate) => (
    typeof candidate === "object" && candidate !== null && candidate.name === name
  ));
  if (check === undefined) {
    throw new Error(`doctor check ${name} was not returned`);
  }
  return check as Record<string, unknown>;
}
