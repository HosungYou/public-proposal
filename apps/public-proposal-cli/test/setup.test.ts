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
        "@longtable/kpp-cli@0.3.0",
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
        sha256: `sha256:${"a".repeat(64)}`,
      },
      codexRegistrations: {
        pluginAdded: true,
        marketplaceAdded: true,
      },
      ownedPaths: expect.arrayContaining([
        "/home/ada/.config/public-proposal/plugin",
        "/home/ada/.config/public-proposal/marketplace",
        "/home/ada/.config/public-proposal/worker",
      ]),
    });
  });

  it("records the installed meta-installer package version in the receipt", async () => {
    const fake = fakeSetupDependencies();
    fake.files["/pkg/package.json"] = JSON.stringify({ name: "@longtable/public-proposal", version: "0.1.1" });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result).toMatchObject({ ok: true, manifest: { packageVersion: "0.1.1" } });
  });

  it("records pre-existing Codex registrations as preserved by uninstall", async () => {
    const fake = fakeSetupDependencies({
      preexistingMarketplaceRegistration: true,
      preexistingPluginRegistration: true,
    });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result).toMatchObject({
      ok: true,
      manifest: {
        codexRegistrations: {
          pluginAdded: false,
          marketplaceAdded: false,
        },
      },
    });
  });

  it("treats a canonical macOS marketplace path as the same pre-existing registration", async () => {
    const base = fakeSetupDependencies({
      preexistingMarketplaceRegistration: true,
      preexistingPluginRegistration: true,
      preexistingMarketplacePath: "/private/home/ada/.config/public-proposal/marketplace",
    });
    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      {
        ...base,
        realpath: async (path: string) => path === "/home/ada/.config/public-proposal/marketplace"
          ? "/private/home/ada/.config/public-proposal/marketplace"
          : path,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      manifest: { codexRegistrations: { pluginAdded: false, marketplaceAdded: false } },
    });
  });

  it("refuses a global Codex marketplace selector that already names another installation", async () => {
    const fake = fakeSetupDependencies({
      preexistingMarketplaceRegistration: true,
      preexistingMarketplacePath: "/workspace/other-public-proposal/marketplace",
    });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "PP_MARKETPLACE_CONFLICT" } });
    expect(fake.commands).toContain("codex plugin marketplace list --json");
    expect(fake.commands.some((command) => command.startsWith("codex plugin marketplace add "))).toBe(false);
  });

  it("reconciles a current receipt that predates Codex registration tracking before returning idempotently", async () => {
    const fake = fakeSetupDependencies();
    const installRoot = "/home/ada/.config/public-proposal";
    seedInstalledPlugin(fake, installRoot);
    fake.files[`${installRoot}/marketplace/marketplace.json`] = JSON.stringify({ name: "public-proposal" });
    fake.files[`${installRoot}/worker/bin/python`] = "#!/usr/bin/env sh\n";
    fake.files[`${installRoot}/installation.json`] = JSON.stringify(fakeManifest());

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result).toMatchObject({
      ok: true,
      manifest: {
        codexRegistrations: { pluginAdded: true, marketplaceAdded: true },
      },
    });
    expect(JSON.parse(fake.files[`${installRoot}/installation.json`])).toMatchObject({
      codexRegistrations: { pluginAdded: true, marketplaceAdded: true },
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
        "/home/ada/.config/public-proposal/worker",
      ]),
    );
    expect(fake.files["/home/ada/.config/public-proposal/installation.json"]).toBeUndefined();
  });

  it("compensates only Codex registrations added by this setup when the worker fails", async () => {
    const fake = fakeSetupDependencies({ workerFailure: new Error("worker failed") });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(false);
    expect(fake.commands).toContain("codex plugin remove public-proposal@public-proposal --json");
    expect(fake.commands).toContain("codex plugin marketplace remove public-proposal --json");
    expect(fake.removed).toEqual(expect.arrayContaining([
      "/home/ada/.config/public-proposal/plugin",
      "/home/ada/.config/public-proposal/marketplace",
      "/home/ada/.config/public-proposal/worker",
    ]));
  });

  it("preserves pre-existing Codex registrations when a later setup step fails", async () => {
    const fake = fakeSetupDependencies({
      workerFailure: new Error("worker failed"),
      preexistingMarketplaceRegistration: true,
      preexistingPluginRegistration: true,
    });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(false);
    expect(fake.commands.some((command) => command.startsWith("codex plugin remove "))).toBe(false);
    expect(fake.commands.some((command) => command.startsWith("codex plugin marketplace remove "))).toBe(false);
  });

  it("reports a failed Codex compensation instead of claiming a clean rollback", async () => {
    const fake = fakeSetupDependencies({
      workerFailure: new Error("worker failed"),
      commandFailures: new Map([["codex plugin remove public-proposal@public-proposal --json", {
        code: 1, stdout: "", stderr: "remove failed",
      }]]),
    });

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "PP_SETUP_ROLLBACK_FAILED" } });
    expect(result.error?.message).toContain("remove failed");
  });

  it("keeps LongTable internal and exposes only the Korean public-proposal skill", async () => {
    const fake = fakeSetupDependencies();

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(true);
    expect(fake.commands.some((command) => command.startsWith("longtable codex install-skills"))).toBe(false);
    expect(fake.files["/home/ada/.config/public-proposal/plugin/skills/korean-public-proposal/SKILL.md"]).toBeDefined();
    expect(fake.files["/home/ada/.config/public-proposal/plugin/skills/longtable/SKILL.md"]).toBeUndefined();
    expect(fake.files["/home/ada/.config/public-proposal/plugin/skills/longtable-research/SKILL.md"]).toBeUndefined();
    expect(fake.files["/home/ada/.config/public-proposal/plugin/skills/public-proposal/SKILL.md"]).toBeUndefined();
    expect(fake.files["/home/ada/.config/public-proposal/plugin/skills/korean-public-proposal/vendor/hwpx-skill/UPSTREAM-SKILL.md"])
      .toContain("# HWPX");
  });

  it("allows setup when LongTable exposes no --version command but the pinned package metadata is present", async () => {
    const base = fakeSetupDependencies();
    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      {
        ...base,
        packageVersion: async (packageName: string) => packageName === "@longtable/cli" ? SUPPORTED_LONGTABLE_VERSION : null,
        spawn: async (command, args, options) => {
          if (command === "longtable" && args.join(" ") === "--version") {
            return { code: 1, stdout: "", stderr: "Unknown command: --version" };
          }
          return base.spawn(command, args, options);
        },
      },
    );

    expect(result.ok).toBe(true);
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

  it("leaves an unrelated legacy codex-skills directory untouched", async () => {
    const conflictFake = fakeSetupDependencies();
    conflictFake.files["/home/ada/.config/public-proposal/codex-skills/existing-skill.txt"] = "keep";

    const conflict = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      conflictFake,
    );

    expect(conflict.ok).toBe(true);
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
      kppVersion: "0.3.0",
      longtableVersion: "0.1.72",
      pluginVersion: "0.2.2",
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

  it("migrates a valid Task 3 receipt by adding the managed worker root", async () => {
    const fake = fakeSetupDependencies();
    const installRoot = "/home/ada/.config/public-proposal";
    fake.files[`${installRoot}/installation.json`] = JSON.stringify(task3Manifest(installRoot));
    seedInstalledPlugin(fake, installRoot);
    fake.files[`${installRoot}/marketplace/.dir`] = "dir";
    fake.files[`${installRoot}/codex-skills/.dir`] = "dir";

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(true);
    expect(fake.removed).toEqual([]);
    expect(fake.writes).toEqual(expect.arrayContaining([
      `${installRoot}/worker`,
      `${installRoot}/installation.json.tmp`,
    ]));
    const manifest = JSON.parse(fake.files[`${installRoot}/installation.json`]);
    expect(manifest).toMatchObject({
      installRoot,
      worker: {
        executable: `${installRoot}/worker/bin/python`,
        protocolVersion: WORKER_PROTOCOL_VERSION,
      },
      ownedPaths: [
        `${installRoot}/plugin`,
        `${installRoot}/marketplace`,
        `${installRoot}/worker`,
      ],
    });
  });

  it("rolls back only the new worker root when Task 3 receipt migration fails", async () => {
    const fake = fakeSetupDependencies({ workerFailure: new Error("worker install failed") });
    const installRoot = "/home/ada/.config/public-proposal";
    fake.files[`${installRoot}/installation.json`] = JSON.stringify(task3Manifest(installRoot));
    seedInstalledPlugin(fake, installRoot);
    fake.files[`${installRoot}/marketplace/.dir`] = "dir";
    fake.files[`${installRoot}/codex-skills/.dir`] = "dir";

    const result = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PP_SETUP_COMMAND_FAILED");
    expect(fake.removed).toEqual([`${installRoot}/worker`]);
    expect(fake.files[`${installRoot}/plugin/.codex-plugin/plugin.json`]).toContain("public-proposal");
    expect(fake.files[`${installRoot}/marketplace/.dir`]).toBe("dir");
    expect(fake.files[`${installRoot}/codex-skills/.dir`]).toBe("dir");
    expect(JSON.parse(fake.files[`${installRoot}/installation.json`])).not.toHaveProperty("worker");
  });

  it("preserves exact Task 3 receipt bytes after post-install migration failure and retries", async () => {
    const fake = fakeSetupDependencies();
    const installRoot = "/home/ada/.config/public-proposal";
    const legacyBytes = JSON.stringify(task3Manifest(installRoot));
    fake.files[`${installRoot}/installation.json`] = legacyBytes;
    seedInstalledPlugin(fake, installRoot);
    fake.files[`${installRoot}/marketplace/.dir`] = "dir";
    fake.files[`${installRoot}/codex-skills/.dir`] = "dir";
    fake.workerProtocol = "2.0.0";

    const failed = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(failed.ok).toBe(false);
    expect(failed.error?.code).toBe("PP_WORKER_PROTOCOL_MISMATCH");
    expect(fake.files[`${installRoot}/installation.json`]).toBe(legacyBytes);
    expect(fake.removed).toEqual([`${installRoot}/worker`]);
    expect(fake.files[`${installRoot}/plugin/.codex-plugin/plugin.json`]).toContain("public-proposal");
    expect(fake.files[`${installRoot}/marketplace/.dir`]).toBe("dir");
    expect(fake.files[`${installRoot}/codex-skills/.dir`]).toBe("dir");

    fake.removed.length = 0;
    fake.workerProtocol = WORKER_PROTOCOL_VERSION;
    const retried = await runSetup(
      { provider: "codex", installScope: "user", cwd: "/work", home: "/home/ada" },
      fake,
    );

    expect(retried.ok).toBe(true);
    expect(JSON.parse(fake.files[`${installRoot}/installation.json`])).toMatchObject({
      worker: {
        executable: `${installRoot}/worker/bin/python`,
        protocolVersion: WORKER_PROTOCOL_VERSION,
      },
      ownedPaths: [
        `${installRoot}/plugin`,
        `${installRoot}/marketplace`,
        `${installRoot}/worker`,
      ],
    });
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
  workerProtocol: string;
}

function seedInstalledPlugin(fake: FakeSetupDependencies, installRoot: string): void {
  fake.files[`${installRoot}/plugin/.codex-plugin/plugin.json`] = JSON.stringify({ name: "public-proposal", version: "0.1.0" });
  fake.files[`${installRoot}/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json`] = JSON.stringify({ schemaVersion: "1.0.0", files: [] });
}

function fakeSetupDependencies(input?: {
  commandFailures?: Map<string, ProcessResult>;
  installRoot?: string;
  realFilesystemWrites?: boolean;
  workerFailure?: Error;
  preexistingMarketplaceRegistration?: boolean;
  preexistingMarketplacePath?: string;
  preexistingPluginRegistration?: boolean;
}): FakeSetupDependencies {
  const installRoot = input?.installRoot ?? "/home/ada/.config/public-proposal";
  const files: Record<string, string> = {
    "/pkg/plugin/.codex-plugin/plugin.json": JSON.stringify({ name: "public-proposal", version: "0.1.0" }),
    "/pkg/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json": JSON.stringify({ schemaVersion: "1.0.0" }),
    "/pkg/plugin/skills/korean-public-proposal/SKILL.md": "# Korean Public Proposal\n",
    "/pkg/plugin/skills/korean-public-proposal/HWPX-ENGINE.json": JSON.stringify({ schemaVersion: "1.0.0" }),
    "/pkg/marketplace/marketplace.json": JSON.stringify({
      name: "public-proposal",
      plugins: [{ name: "public-proposal", source: { source: "local", path: "./plugin" } }],
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
  const state = {
    workerProtocol: WORKER_PROTOCOL_VERSION,
    marketplaceRegistered: input?.preexistingMarketplaceRegistration ?? false,
    pluginRegistered: input?.preexistingPluginRegistration ?? false,
    marketplacePath: input?.preexistingMarketplacePath ?? `${installRoot}/marketplace`,
  };

  return {
    packageRoot: "/pkg",
    files,
    preexisting,
    writes,
    renames,
    removed,
    commands,
    modes,
    get workerProtocol() {
      return state.workerProtocol;
    },
    set workerProtocol(value: string) {
      state.workerProtocol = value;
    },
    now: () => "2026-08-18T00:00:00.000Z",
    sha256: async (path) => path.endsWith("/worker/bin/python") ? `sha256:${"a".repeat(64)}` : `sha256:${path}`,
    realpath: async (path) => path,
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
    installWorker: async (root, _runner, options) => {
      const executable = `${root}/worker/bin/python`;
      files[`${root}/worker/.dir`] = "dir";
      files[executable] = "#!/usr/bin/env sh\n";
      writes.push(`${root}/worker`);
      if (options?.updateManifest !== false && files[`${root}/installation.json`] !== undefined) {
        const parsed = JSON.parse(files[`${root}/installation.json`]);
        parsed.worker = {
          executable,
          protocolVersion: WORKER_PROTOCOL_VERSION,
          sha256: `sha256:${"a".repeat(64)}`,
        };
        files[`${root}/installation.json`] = JSON.stringify(parsed);
      }
      if (input?.workerFailure !== undefined) {
        throw input.workerFailure;
      }
      return {
        executable,
        protocolVersion: WORKER_PROTOCOL_VERSION,
        sha256: `sha256:${"a".repeat(64)}`,
      };
    },
    installHwpxEngine: async (skillRoot) => {
      files[`${skillRoot}/vendor/hwpx-skill/UPSTREAM-SKILL.md`] = "# HWPX\n";
      return {
        commit: "96a2633f23a08f707679d7e212ebdc59948260e6",
        root: `${skillRoot}/vendor/hwpx-skill`,
        verified: true,
        fileCount: 118,
      };
    },
    verifyHwpxEngine: async (skillRoot) => ({
      commit: "96a2633f23a08f707679d7e212ebdc59948260e6",
      root: `${skillRoot}/vendor/hwpx-skill`,
      verified: true,
      fileCount: 118,
    }),
    listDir: async (path) => {
      if (input?.realFilesystemWrites && path.startsWith(installRoot)) {
        const { readdir } = await import("node:fs/promises");
        return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      }
      const prefix = `${path}/`;
      return [...new Set(Object.keys(files)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length).split("/")[0])
        .filter(Boolean))].sort();
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
          await writeFile(join(to, "skills", "korean-public-proposal", "SKILL.md"), files["/pkg/plugin/skills/korean-public-proposal/SKILL.md"], "utf8");
          await writeFile(join(to, "skills", "korean-public-proposal", "HWPX-ENGINE.json"), files["/pkg/plugin/skills/korean-public-proposal/HWPX-ENGINE.json"], "utf8");
        }
        if (to.endsWith("/marketplace")) {
          await writeFile(join(to, "marketplace.json"), files["/pkg/marketplace/marketplace.json"], "utf8");
        }
        writes.push(to);
        return;
      }
      if (from === "/pkg/plugin") {
        files[`${to}/.codex-plugin/plugin.json`] = files["/pkg/plugin/.codex-plugin/plugin.json"];
        files[`${to}/skills/korean-public-proposal/BUNDLE-MANIFEST.json`] = files["/pkg/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json"];
        files[`${to}/skills/korean-public-proposal/SKILL.md`] = files["/pkg/plugin/skills/korean-public-proposal/SKILL.md"];
        files[`${to}/skills/korean-public-proposal/HWPX-ENGINE.json`] = files["/pkg/plugin/skills/korean-public-proposal/HWPX-ENGINE.json"];
      }
      if (to.endsWith("/plugin/skills")) {
        for (const [path, contents] of Object.entries(files)) {
          if (path.startsWith(`${from}/`)) files[`${to}/${path.slice(from.length + 1)}`] = contents;
        }
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
      if (rendered.startsWith("codex plugin marketplace list")) return ok(state.marketplaceRegistered || files[`${installRoot}/installation.json`] !== undefined
        ? JSON.stringify({ marketplaces: [{ name: "public-proposal", path: state.marketplacePath }] })
        : "{\"marketplaces\":[]}\n");
      if (rendered.startsWith("codex plugin list")) return ok(state.pluginRegistered || files[`${installRoot}/installation.json`] !== undefined
        ? "{\"installed\":[{\"pluginId\":\"public-proposal@public-proposal\",\"installed\":true}],\"available\":[]}\n"
        : "{\"installed\":[],\"available\":[]}\n");
      if (rendered.startsWith("codex plugin marketplace add ")) {
        state.marketplaceRegistered = true;
        state.marketplacePath = rendered.slice("codex plugin marketplace add ".length);
        return ok("");
      }
      if (rendered.startsWith("codex plugin add ")) { state.pluginRegistered = true; return ok(""); }
      if (rendered.startsWith("codex plugin remove ")) { state.pluginRegistered = false; return ok("{\"ok\":true}\n"); }
      if (rendered.startsWith("codex plugin marketplace remove ")) { state.marketplaceRegistered = false; return ok("{\"ok\":true}\n"); }
      if (rendered === "uv sync --locked --no-dev") return ok("");
      if (rendered.endsWith("-c from kpp_docx.protocol import PROTOCOL_VERSION; print(PROTOCOL_VERSION)")) return ok(`${state.workerProtocol}\n`);
      return { code: 127, stdout: "", stderr: `unexpected host command: ${rendered}` };
    },
  };
}

function task3Manifest(installRoot: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0",
    packageVersion: "0.1.0",
    kppVersion: "0.3.0",
    longtableVersion: "0.1.72",
    pluginVersion: "0.2.2",
    workerProtocol: "1.0.0",
    installRoot,
    pluginManifestSha256: `sha256:${installRoot}/plugin/.codex-plugin/plugin.json`,
    bundleManifestSha256: `sha256:${installRoot}/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json`,
    ownedPaths: [
      `${installRoot}/plugin`,
      `${installRoot}/marketplace`,
      `${installRoot}/codex-skills`,
    ],
    createdAt: "2026-08-18T00:00:00.000Z",
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
    kppVersion: "0.3.0",
    longtableVersion: "0.1.72",
    pluginVersion: "0.2.2",
    workerProtocol: "1.0.0",
    installRoot,
    pluginManifestSha256: `sha256:${installRoot}/plugin/.codex-plugin/plugin.json`,
    bundleManifestSha256: `sha256:${installRoot}/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json`,
    worker: {
      executable: `${installRoot}/worker/bin/python`,
      protocolVersion: "1.0.0",
      sha256: `sha256:${"a".repeat(64)}`,
    },
    ownedPaths: input?.ownedPaths ?? [
      `${installRoot}/plugin`,
      `${installRoot}/marketplace`,
      `${installRoot}/worker`,
    ],
    createdAt: "2026-08-18T00:00:00.000Z",
  };
}

function ok(stdout: string): ProcessResult {
  return { code: 0, stdout, stderr: "" };
}
