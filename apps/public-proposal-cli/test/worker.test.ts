import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProcessResult } from "../src/contracts.js";
import { installManagedWorker, resolveManagedWorker, resolveVerifiedManagedWorker, verifyWorkerProtocol } from "../src/worker.js";

describe("managed DOCX worker", () => {
  it("resolves the worker from the Public Proposal installation manifest", async () => {
    const worker = await resolveManagedWorker("apps/public-proposal-cli/test/fixtures/installation.json");

    expect(worker).toBe("/fixture/.public-proposal/worker/bin/python");
  });

  it("returns null for stale or unowned manifest worker paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "public-proposal-worker-resolve-"));
    const manifestPath = join(root, "installation.json");
    await writeJson(manifestPath, {
      schemaVersion: "1.0.0",
      packageVersion: "0.1.0",
      kppVersion: "0.3.0",
      longtableVersion: "0.1.72",
      pluginVersion: "0.2.2",
      workerProtocol: "1.0.0",
      installRoot: root,
      pluginManifestSha256: "sha256:plugin",
      bundleManifestSha256: "sha256:bundle",
      worker: {
        executable: join(dirname(root), "escaped", "bin", "python"),
        protocolVersion: "1.0.0",
        sha256: "sha256:worker",
      },
      ownedPaths: [
        join(root, "plugin"),
        join(root, "marketplace"),
        join(root, "worker"),
      ],
      createdAt: "2026-08-18T00:00:00.000Z",
    });

    await expect(resolveManagedWorker(manifestPath)).resolves.toBeNull();
  });

  it("rejects a worker with a protocol other than 1.0.0", async () => {
    await expect(verifyWorkerProtocol("2.0.0")).rejects.toMatchObject({
      code: "PP_WORKER_PROTOCOL_MISMATCH",
    });
  });

  it("rejects a manifest when the executable hash does not match the receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "public-proposal-worker-hash-"));
    const executable = join(root, "worker", "bin", "python");
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(executable, "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
    const manifestPath = join(root, "installation.json");
    await writeJson(manifestPath, manifestFor(root, {
      executable,
      sha256: `sha256:${"0".repeat(64)}`,
    }));

    await expect(resolveVerifiedManagedWorker(manifestPath)).rejects.toMatchObject({
      code: "PP_WORKER_INTEGRITY_FAILED",
    });
  });

  it("rejects a worker symlink that resolves outside the canonical worker root", async () => {
    const root = await mkdtemp(join(tmpdir(), "public-proposal-worker-symlink-"));
    const external = join(await mkdtemp(join(tmpdir(), "public-proposal-worker-external-")), "python");
    await writeFile(external, "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
    const executable = join(root, "worker", "bin", "python");
    await mkdir(dirname(executable), { recursive: true });
    await symlink(external, executable);
    const manifestPath = join(root, "installation.json");
    await writeJson(manifestPath, manifestFor(root, {
      executable,
      sha256: await sha256File(external),
    }));

    await expect(resolveVerifiedManagedWorker(manifestPath)).rejects.toMatchObject({
      code: "PP_WORKER_INTEGRITY_FAILED",
    });
  });

  it("installs the packaged worker under the owned worker root with locked uv metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "public-proposal-worker-install-"));
    const commands: string[] = [];
    const runner = async (command: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<ProcessResult> => {
      commands.push([command, ...args].join(" "));
      expect(options?.cwd).toBe(join(root, "worker", "source"));
      expect(options?.env?.UV_PROJECT_ENVIRONMENT).toBe(join(root, "worker", ".venv"));
      if (command === "uv" && args.join(" ") === "sync --locked --no-dev") return ok("");
      if (args.join(" ") === "-c from kpp_docx.protocol import PROTOCOL_VERSION; print(PROTOCOL_VERSION)") return ok("1.0.0\n");
      return { code: 127, stdout: "", stderr: "unexpected command" };
    };

    const installed = await installManagedWorker(root, runner);

    expect(installed).toMatchObject({
      executable: join(root, "worker", "bin", "python"),
      protocolVersion: "1.0.0",
    });
    expect(installed.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(commands).toEqual([
      "uv sync --locked --no-dev",
      `${join(root, "worker", "bin", "python")} -c from kpp_docx.protocol import PROTOCOL_VERSION; print(PROTOCOL_VERSION)`,
    ]);
    await expect(stat(join(root, "worker", "source", "uv.lock"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(readFile(join(root, "worker", "source", "pyproject.toml"), "utf8")).resolves.toContain("kpp-docx-worker");
  });
});

function manifestFor(root: string, worker: { executable: string; sha256: string; protocolVersion?: string }): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0",
    packageVersion: "0.1.0",
    kppVersion: "0.3.0",
    longtableVersion: "0.1.72",
    pluginVersion: "0.2.2",
    workerProtocol: "1.0.0",
    installRoot: root,
    pluginManifestSha256: "sha256:plugin",
    bundleManifestSha256: "sha256:bundle",
    worker: {
      executable: worker.executable,
      protocolVersion: worker.protocolVersion ?? "1.0.0",
      sha256: worker.sha256,
    },
    ownedPaths: [
      join(root, "plugin"),
      join(root, "marketplace"),
      join(root, "worker"),
    ],
    createdAt: "2026-08-18T00:00:00.000Z",
  };
}

async function sha256File(path: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ok(stdout: string): ProcessResult {
  return { code: 0, stdout, stderr: "" };
}
