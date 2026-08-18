import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_KPP_VERSION, SUPPORTED_LONGTABLE_VERSION, WORKER_PROTOCOL_VERSION, type ProcessResult } from "../src/contracts.js";
import { installationRoot } from "../src/paths.js";
import { runSetup, type SetupDependencies } from "../src/commands/setup.js";

describe("public proposal setup", () => {
  it("derives the no-argument setup roots from scope, cwd, and home", () => {
    expect(installationRoot("user", "/workspace/proposal", "/home/ada")).toBe(
      "/home/ada/.config/public-proposal",
    );
    expect(installationRoot("project", "/workspace/proposal", "/home/ada")).toBe(
      "/workspace/proposal/.public-proposal",
    );
  });

  it("dry-run reports every planned component without writing the home directory", async () => {
    const fake = fakeSetupDependencies();

    const result = await runSetup(
      { provider: "codex", installScope: "user", dryRun: true, cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(true);
    expect(result.writes).toEqual([]);
    expect(result.plan).toEqual(
      expect.arrayContaining([
        "public-proposal plugin",
        "@longtable/kpp-cli@0.2.1",
        "@longtable/cli@0.1.72",
        "managed worker protocol 1.0.0",
      ]),
    );
    expect(fake.writes).toEqual([]);
    expect(fake.commands).toEqual([]);
  });

  it("registers the packaged marketplace once and writes a 0600 manifest only after checks pass", async () => {
    const fake = fakeSetupDependencies();

    const first = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );
    const second = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fake.commands.filter((command) => command.includes("plugin marketplace add"))).toHaveLength(1);
    expect(fake.commands.filter((command) => command.includes("plugin add public-proposal@public-proposal"))).toHaveLength(1);
    expect(fake.writes).toContain("/home/ada/.config/public-proposal/installation.json.tmp");
    expect(fake.renames).toContainEqual({
      from: "/home/ada/.config/public-proposal/installation.json.tmp",
      to: "/home/ada/.config/public-proposal/installation.json",
    });
    expect(fake.modes["/home/ada/.config/public-proposal/installation.json.tmp"]).toBe(0o600);
    expect(JSON.parse(fake.files["/home/ada/.config/public-proposal/installation.json"])).toMatchObject({
      kppVersion: SUPPORTED_KPP_VERSION,
      longtableVersion: SUPPORTED_LONGTABLE_VERSION,
      workerProtocol: WORKER_PROTOCOL_VERSION,
      worker: {
        executable: "/home/ada/.config/public-proposal/worker/bin/python",
        protocolVersion: WORKER_PROTOCOL_VERSION,
        sha256: "sha256:/home/ada/.config/public-proposal/worker/bin/python",
      },
      ownedPaths: expect.arrayContaining([
        "/home/ada/.config/public-proposal/plugin",
        "/home/ada/.config/public-proposal/marketplace",
        "/home/ada/.config/public-proposal/codex-skills",
        "/home/ada/.config/public-proposal/worker",
      ]),
    });
  });

  it("persists a canonical receipt and remains idempotent when setup receives a relative install root", async () => {
    const fake = fakeSetupDependencies();
    const relativeRoot = `.public-proposal-relative-${process.pid}`;
    const canonicalRoot = resolve(relativeRoot);

    const first = await runSetup({ provider: "codex", installRoot: relativeRoot }, fake);
    const second = await runSetup({ provider: "codex", installRoot: relativeRoot }, fake);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.writes).toEqual([]);
    expect(JSON.parse(fake.files[`${canonicalRoot}/installation.json`])).toMatchObject({
      installRoot: canonicalRoot,
      ownedPaths: [
        `${canonicalRoot}/plugin`,
        `${canonicalRoot}/marketplace`,
        `${canonicalRoot}/codex-skills`,
        `${canonicalRoot}/worker`,
      ],
    });
    expect(fake.commands.filter((command) => command.includes("plugin marketplace add"))).toHaveLength(1);
  });

  it("rolls back owned setup paths and does not publish a manifest when a post-mutation step fails", async () => {
    const fake = fakeSetupDependencies({
      commandFailures: new Map([["codex plugin add public-proposal@public-proposal", { code: 1, stdout: "", stderr: "install failed" }]]),
    });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PP_SETUP_COMMAND_FAILED");
    expect(fake.removed).toEqual(
      expect.arrayContaining([
        "/home/ada/.config/public-proposal/plugin",
        "/home/ada/.config/public-proposal/marketplace",
        "/home/ada/.config/public-proposal/codex-skills",
        "/home/ada/.config/public-proposal/worker",
      ]),
    );
    expect(fake.files["/home/ada/.config/public-proposal/installation.json"]).toBeUndefined();
  });

  it("stops before mutation when an existing marketplace path is not installer-owned", async () => {
    const fake = fakeSetupDependencies();
    fake.files["/home/ada/.config/public-proposal/marketplace/marketplace.json"] = JSON.stringify({
      name: "other-marketplace",
      plugins: [],
    });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PP_MARKETPLACE_CONFLICT");
    expect(fake.commands).toEqual([]);
    expect(fake.writes).toEqual([]);
  });

  it("stops before mutation when codex-skills already exists and preserves it on later failures", async () => {
    const conflictFake = fakeSetupDependencies();
    conflictFake.files["/home/ada/.config/public-proposal/codex-skills/existing-skill.txt"] = "keep";

    const conflict = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      conflictFake,
    );

    expect(conflict.ok).toBe(false);
    expect(conflict.error?.code).toBe("PP_INSTALL_TARGET_CONFLICT");
    expect(conflictFake.commands).toEqual([]);
    expect(conflictFake.files["/home/ada/.config/public-proposal/codex-skills/existing-skill.txt"]).toBe("keep");

    const failureFake = fakeSetupDependencies({
      commandFailures: new Map([["codex plugin add public-proposal@public-proposal", { code: 1, stdout: "", stderr: "install failed" }]]),
    });
    failureFake.preexisting.add("/home/ada/.config/public-proposal");

    const failure = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      failureFake,
    );

    expect(failure.ok).toBe(false);
    expect(failureFake.removed).toEqual([
      "/home/ada/.config/public-proposal/worker",
      "/home/ada/.config/public-proposal/codex-skills",
      "/home/ada/.config/public-proposal/marketplace",
      "/home/ada/.config/public-proposal/plugin",
    ]);
    expect(failureFake.removed).not.toContain("/home/ada/.config/public-proposal");
  });

  it("rejects stale manifests instead of treating them as idempotent success", async () => {
    const fake = fakeSetupDependencies();
    fake.files["/home/ada/.config/public-proposal/installation.json"] = JSON.stringify({
      schemaVersion: "1.0.0",
      packageVersion: "0.1.0",
      kppVersion: "0.2.1",
      longtableVersion: "0.1.72",
      pluginVersion: "0.1.0",
      workerProtocol: "1.0.0",
      installRoot: "/other/root",
      pluginManifestSha256: "sha256:/pkg/plugin/.codex-plugin/plugin.json",
      bundleManifestSha256: "sha256:/pkg/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json",
      ownedPaths: ["/other/root/plugin"],
      createdAt: "2026-08-18T00:00:00.000Z",
    });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PP_INSTALL_MANIFEST_MISMATCH");
    expect(fake.commands).toEqual([]);
  });

  it("rejects same-root receipts with empty or arbitrary owned paths", async () => {
    const emptyFake = fakeSetupDependencies();
    emptyFake.files["/home/ada/.config/public-proposal/installation.json"] = JSON.stringify(
      fakeManifest({ ownedPaths: [] }),
    );

    const emptyResult = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      emptyFake,
    );

    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.error?.code).toBe("PP_INSTALL_MANIFEST_MISMATCH");

    const arbitraryFake = fakeSetupDependencies();
    arbitraryFake.files["/home/ada/.config/public-proposal/installation.json"] = JSON.stringify(
      fakeManifest({
      ownedPaths: [
        "/home/ada/.config/public-proposal/plugin",
        "/home/ada/.config/public-proposal/marketplace",
        "/home/ada/.config/public-proposal/codex-skills",
        "/home/ada/.config/public-proposal/worker",
        "/home/ada/.config/public-proposal/plugin/../../ssh",
      ],
      }),
    );
    arbitraryFake.files["/home/ada/.config/public-proposal/plugin/.dir"] = "dir";
    arbitraryFake.files["/home/ada/.config/public-proposal/marketplace/.dir"] = "dir";
    arbitraryFake.files["/home/ada/.config/public-proposal/codex-skills/.dir"] = "dir";
    arbitraryFake.files["/home/ada/.config/public-proposal/worker/.dir"] = "dir";

    const arbitraryResult = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      arbitraryFake,
    );

    expect(arbitraryResult.ok).toBe(false);
    expect(arbitraryResult.error?.code).toBe("PP_INSTALL_MANIFEST_MISMATCH");
  });

  it("does not truncate an external file when a fixed manifest temp path is a symlink", async () => {
    const installRoot = await mkdtemp(join(tmpdir(), "public-proposal-setup-symlink-"));
    const externalTarget = join(tmpdir(), `public-proposal-external-${process.pid}-${Date.now()}.txt`);
    await writeFile(externalTarget, "do-not-touch", "utf8");
    await symlink(externalTarget, join(installRoot, "installation.json.tmp"));

    try {
      const fake = fakeSetupDependencies({
        installRoot,
        realFilesystemWrites: true,
      });

      const result = await runSetup(
        { provider: "codex", installScope: "user", installRoot },
        fake,
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("PP_SETUP_COMMAND_FAILED");
      await expect(readFile(externalTarget, "utf8")).resolves.toBe("do-not-touch");
      await expect(readFile(join(installRoot, "installation.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(installRoot, { force: true, recursive: true });
      await rm(externalTarget, { force: true });
    }
  });
});

interface FakeSetupDependencies extends SetupDependencies {
  readonly files: Record<string, string>;
  readonly preexisting: Set<string>;
  readonly writes: string[];
  readonly renames: Array<{ from: string; to: string }>;
  readonly removed: string[];
  readonly commands: string[];
  readonly modes: Record<string, number | undefined>;
}

function fakeSetupDependencies(input?: {
  commandFailures?: Map<string, ProcessResult>;
  installRoot?: string;
  realFilesystemWrites?: boolean;
}): FakeSetupDependencies {
  const installRoot = input?.installRoot ?? "/home/ada/.config/public-proposal";
  const files: Record<string, string> = {
    "/pkg/plugin/.codex-plugin/plugin.json": JSON.stringify({ name: "public-proposal", version: "0.1.0" }),
    "/pkg/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json": JSON.stringify({ schemaVersion: "1.0.0" }),
    "/pkg/marketplace/marketplace.json": JSON.stringify({
      name: "public-proposal",
      plugins: [{ name: "public-proposal", source: { path: "../plugin" } }],
    }),
    "/pkg/worker/pyproject.toml": "[project]\nname = \"kpp-docx-worker\"\n",
    "/pkg/worker/uv.lock": "version = 1\n",
    "/pkg/worker/src/kpp_docx/protocol.py": "PROTOCOL_VERSION = \"1.0.0\"\n",
  };
  const writes: string[] = [];
  const preexisting = new Set<string>();
  const renames: Array<{ from: string; to: string }> = [];
  const removed: string[] = [];
  const commands: string[] = [];
  const modes: Record<string, number | undefined> = {};

  return {
    packageRoot: "/pkg",
    files,
    preexisting,
    writes,
    renames,
    removed,
    commands,
    modes,
    now: () => "2026-08-18T00:00:00.000Z",
    sha256: async (path) => `sha256:${path}`,
    mkdir: async (path) => {
      files[`${path}/.dir`] = "dir";
    },
    readFile: async (path) => {
      if (input?.realFilesystemWrites && path.startsWith(installRoot)) {
        return readFile(path, "utf8");
      }
      if (!(path in files)) {
        throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      }
      return files[path];
    },
    writeFile: async (path, contents, mode) => {
      if (input?.realFilesystemWrites && path.startsWith(installRoot)) {
        const { writeFileWithMode } = await import("../src/process.js");
        await writeFileWithMode(path, contents, mode);
        writes.push(path);
        modes[path] = mode;
        return;
      }
      files[path] = contents;
      writes.push(path);
      modes[path] = mode;
    },
    rename: async (from, to) => {
      if (input?.realFilesystemWrites && from.startsWith(installRoot)) {
        const { rename } = await import("node:fs/promises");
        await rename(from, to);
        renames.push({ from, to });
        return;
      }
      files[to] = files[from];
      delete files[from];
      renames.push({ from, to });
    },
    remove: async (path) => {
      for (const key of Object.keys(files)) {
        if (key === path || key.startsWith(`${path}/`)) {
          delete files[key];
        }
      }
      removed.push(path);
    },
    installWorker: async (root) => {
      const executable = `${root}/worker/bin/python`;
      files[`${root}/worker/.dir`] = "dir";
      files[executable] = "#!/usr/bin/env sh\n";
      writes.push(`${root}/worker`);
      return {
        executable,
        protocolVersion: WORKER_PROTOCOL_VERSION,
        sha256: `sha256:${executable}`,
      };
    },
    copyDir: async (from, to) => {
      if (input?.realFilesystemWrites && to.startsWith(installRoot)) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(to, { recursive: true });
        if (to.endsWith("/plugin")) {
          await mkdir(join(to, ".codex-plugin"), { recursive: true });
          await mkdir(join(to, "skills", "korean-public-proposal"), { recursive: true });
          await writeFile(join(to, ".codex-plugin", "plugin.json"), files["/pkg/plugin/.codex-plugin/plugin.json"], "utf8");
          await writeFile(
            join(to, "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json"),
            files["/pkg/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json"],
            "utf8",
          );
        }
        if (to.endsWith("/marketplace")) {
          await writeFile(join(to, "marketplace.json"), files["/pkg/marketplace/marketplace.json"], "utf8");
        }
        writes.push(to);
        return;
      }
      files[`${to}/.copied-from`] = from;
      writes.push(to);
    },
    exists: async (path) => {
      if (input?.realFilesystemWrites && path.startsWith(installRoot)) {
        const { stat } = await import("node:fs/promises");
        try {
          await stat(path);
          return true;
        } catch {
          return false;
        }
      }
      return Object.keys(files).some((key) => key === path || key.startsWith(`${path}/`));
    },
    spawn: async (command, args) => {
      const rendered = [command, ...args].join(" ");
      commands.push(rendered);
      const failure = input?.commandFailures?.get(rendered);
      if (failure) {
        return failure;
      }
      if (rendered === "node --version") return ok("v22.20.0\n");
      if (rendered === "npm --version") return ok("11.6.0\n");
      if (rendered === "codex --version") return ok("codex 0.144.5\n");
      if (rendered === "python3 --version") return ok("Python 3.13.0\n");
      if (rendered === "soffice --version") return ok("LibreOffice 25.8\n");
      if (rendered === "kpp --version") return ok(`${SUPPORTED_KPP_VERSION}\n`);
      if (rendered === "longtable --version") return ok(`${SUPPORTED_LONGTABLE_VERSION}\n`);
      if (rendered === "longtable scholar-research doctor --json") return ok("{\"ok\":true}\n");
      if (rendered === "kpp worker doctor --json") return ok(`{"ok":true,"protocol":"${WORKER_PROTOCOL_VERSION}"}\n`);
      if (rendered.startsWith("fc-match ")) return ok("NotoSansCJKkr-Regular.otf\n");
      if (rendered.startsWith("longtable codex install-skills ")) return ok("");
      if (rendered.startsWith("codex plugin marketplace list")) return ok("{\"marketplaces\":[]}\n");
      if (rendered.startsWith("codex plugin list")) return ok("{\"plugins\":[]}\n");
      if (rendered.startsWith("codex plugin marketplace add ")) return ok("");
      if (rendered.startsWith("codex plugin add ")) return ok("");
      if (rendered === "uv sync --locked --no-dev") return ok("");
      if (rendered.endsWith("-c from kpp_docx.protocol import PROTOCOL_VERSION; print(PROTOCOL_VERSION)")) return ok("1.0.0\n");
      return { code: 127, stdout: "", stderr: `unexpected host command: ${rendered}` };
    },
  };
}

function fakeManifest(input?: Partial<{
  installRoot: string;
  ownedPaths: readonly string[];
}>): Record<string, unknown> {
  const installRoot = input?.installRoot ?? "/home/ada/.config/public-proposal";
  return {
    schemaVersion: "1.0.0",
    packageVersion: "0.1.0",
    kppVersion: "0.2.1",
    longtableVersion: "0.1.72",
    pluginVersion: "0.1.0",
    workerProtocol: "1.0.0",
    installRoot,
    pluginManifestSha256: `sha256:${installRoot}/plugin/.codex-plugin/plugin.json`,
    bundleManifestSha256: `sha256:${installRoot}/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json`,
    worker: {
      executable: `${installRoot}/worker/bin/python`,
      protocolVersion: "1.0.0",
      sha256: `sha256:${installRoot}/worker/bin/python`,
    },
    ownedPaths: input?.ownedPaths ?? [
      `${installRoot}/plugin`,
      `${installRoot}/marketplace`,
      `${installRoot}/codex-skills`,
      `${installRoot}/worker`,
    ],
    createdAt: "2026-08-18T00:00:00.000Z",
  };
}

function ok(stdout: string): ProcessResult {
  return { code: 0, stdout, stderr: "" };
}
