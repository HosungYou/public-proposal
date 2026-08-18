import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { parseSetupOptions, type InstallManifest } from "../src/contracts.js";

describe("public proposal installer contracts", () => {
  it("accepts only the Codex provider and the supported exact dependency versions", () => {
    expect(parseSetupOptions({ provider: "codex" })).toEqual({
      provider: "codex",
      installScope: "user",
      dryRun: false,
    });

    const manifest: InstallManifest = {
      schemaVersion: "1.0.0",
      packageVersion: "0.1.0",
      kppVersion: "0.2.1",
      longtableVersion: "0.1.72",
      pluginVersion: "0.2.0",
      workerProtocol: "1.0.0",
      installRoot: "/tmp/public-proposal",
      pluginManifestSha256: "sha256:plugin",
      bundleManifestSha256: "sha256:bundle",
      ownedPaths: ["/tmp/public-proposal"],
      createdAt: "2026-08-18T00:00:00.000Z",
    };

    expect(manifest.kppVersion).toBe("0.2.1");
    expect(manifest.longtableVersion).toBe("0.1.72");
  });

  it("defaults to the user install scope", () => {
    expect(parseSetupOptions({ provider: "codex" })).toEqual({
      provider: "codex",
      installScope: "user",
      dryRun: false,
    });
  });

  it("accepts the project install scope", () => {
    expect(parseSetupOptions({ provider: "codex", installScope: "project" })).toEqual({
      provider: "codex",
      installScope: "project",
      dryRun: false,
    });
  });

  it("accepts dry-run mode", () => {
    expect(parseSetupOptions({ provider: "codex", dryRun: true })).toEqual({
      provider: "codex",
      installScope: "user",
      dryRun: true,
    });
  });

  it("rejects an unsupported provider with a stable error code", () => {
    expect(() => parseSetupOptions({ provider: "atlas" })).toThrowError(
      expect.objectContaining({
        message: "PP_SETUP_PROVIDER_UNSUPPORTED",
      }),
    );
  });
});

describe("public proposal installer CLI", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it("supports the approved no-positional setup command in dry-run mode", async () => {
    const installRoot = await mkdtemp(join(tmpdir(), "public-proposal-setup-"));
    temporaryDirectories.push(installRoot);

    const result = await runCli(["setup", "--install-root", installRoot, "--dry-run", "--json"]);
    const envelope = parseEnvelope(result.stdout);

    expect(result.code).toBe(0);
    expect(envelope).toMatchObject({
      ok: true,
      code: "PP_OK",
      data: expect.objectContaining({
        ok: true,
        writes: [],
        plan: expect.arrayContaining(["public-proposal plugin"]),
      }),
    });
    expect("manifestPath" in (envelope.data as Record<string, unknown>)).toBe(false);
    await expect(readFile(join(installRoot, "installation.json"), "utf8")).rejects.toThrow();
  });

  it("rejects the retired positional setup root", async () => {
    const installRoot = await mkdtemp(join(tmpdir(), "public-proposal-doctor-"));
    temporaryDirectories.push(installRoot);

    const result = await runCli(["setup", installRoot, "--json"]);
    const envelope = parseEnvelope(result.stdout);

    expect(result.code).toBe(1);
    expect(envelope).toMatchObject({
      ok: false,
      code: "commander.excessArguments",
    });
  });
});

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface CliEnvelope {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly data: unknown;
}

async function runCli(args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "apps/public-proposal-cli/src/main.ts", ...args], {
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
