import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { InstallManifest } from "../src/contracts.js";
import { runUninstall, type UninstallDependencies } from "../src/commands/uninstall.js";
import { runUpdate } from "../src/commands/update.js";

describe("public proposal uninstall and update", () => {
  it("uninstall removes only manifest-owned paths and preserves customer and LongTable state", async () => {
    const removed: string[] = [];
    const manifest = fakeManifest({
      ownedPaths: [
        "/home/ada/.config/public-proposal/plugin",
        "/home/ada/.config/public-proposal/marketplace",
        "/home/ada/.config/public-proposal/.longtable",
        "/work/customer-evidence",
      ],
      codexRegistrations: { pluginAdded: false, marketplaceAdded: false },
    });

    const result = await runUninstall("/home/ada/.config/public-proposal", {
      readManifest: async () => manifest,
      exists: async () => true,
      remove: async (path) => {
        removed.push(path);
      },
    });

    expect(removed).toEqual([
      "/home/ada/.config/public-proposal/plugin",
      "/home/ada/.config/public-proposal/marketplace",
      "/home/ada/.config/public-proposal/installation.json",
    ]);
    expect(result.preserved).toEqual(["/home/ada/.config/public-proposal/.longtable", "/work/customer-evidence"]);
  });

  it("uninstall deregisters Codex entries owned by this installation before removing its files", async () => {
    const commands: string[] = [];
    const removed: string[] = [];

    await runUninstall(
      "/home/ada/.config/public-proposal",
      uninstallDependencies({
        manifest: manifestWithCodexRegistrations({ pluginAdded: true, marketplaceAdded: true }),
        commands,
        removed,
      }),
    );

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
      "codex plugin remove public-proposal@public-proposal --json",
      "codex plugin marketplace remove public-proposal --json",
    ]);
    expect(removed).toEqual([
      "/home/ada/.config/public-proposal/plugin",
      "/home/ada/.config/public-proposal/marketplace",
      "/home/ada/.config/public-proposal/worker",
      "/home/ada/.config/public-proposal/installation.json",
    ]);
  });

  it("uninstall preserves Codex entries that predate this installation", async () => {
    const commands: string[] = [];

    await runUninstall(
      "/home/ada/.config/public-proposal",
      uninstallDependencies({
        manifest: manifestWithCodexRegistrations({ pluginAdded: false, marketplaceAdded: false }),
        commands,
      }),
    );

    expect(commands).toEqual([]);
  });

  it("uninstall refuses to remove a Codex marketplace that now points at another installation", async () => {
    const commands: string[] = [];
    const removed: string[] = [];

    await expect(
      runUninstall(
        "/home/ada/.config/public-proposal",
        uninstallDependencies({
          manifest: manifestWithCodexRegistrations({ pluginAdded: true, marketplaceAdded: true }),
          commands,
          removed,
          marketplacePath: "/workspace/other-public-proposal/marketplace",
        }),
      ),
    ).rejects.toMatchObject({ code: "PP_UNINSTALL_REGISTRATION_CONFLICT" });

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
    ]);
    expect(removed).toEqual([]);
  });

  it("uninstall reconstructs ownership for a receipt that predates Codex registration tracking", async () => {
    const commands: string[] = [];

    await runUninstall(
      "/home/ada/.config/public-proposal",
      uninstallDependencies({
        manifest: legacyManifestWithoutCodexRegistrations(),
        commands,
      }),
    );

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
      "codex plugin remove public-proposal@public-proposal --json",
      "codex plugin marketplace remove public-proposal --json",
    ]);
  });

  it("uninstall preserves a legacy receipt when Codex registration ownership cannot be proven", async () => {
    const commands: string[] = [];
    const removed: string[] = [];

    await expect(
      runUninstall(
        "/home/ada/.config/public-proposal",
        uninstallDependencies({
          manifest: legacyManifestWithoutCodexRegistrations(),
          commands,
          removed,
          marketplacePath: null,
          pluginInstalled: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "PP_UNINSTALL_REGISTRATION_OWNERSHIP_UNKNOWN" });

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
    ]);
    expect(removed).toEqual([]);
  });

  it("uninstall resumes cleanup when a legacy receipt's Codex registrations are already absent", async () => {
    const commands: string[] = [];
    const removed: string[] = [];

    await runUninstall(
      "/home/ada/.config/public-proposal",
      uninstallDependencies({
        manifest: legacyManifestWithoutCodexRegistrations(),
        commands,
        removed,
        marketplacePath: null,
        pluginInstalled: false,
      }),
    );

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
    ]);
    expect(removed).toEqual([
      "/home/ada/.config/public-proposal/plugin",
      "/home/ada/.config/public-proposal/marketplace",
      "/home/ada/.config/public-proposal/worker",
      "/home/ada/.config/public-proposal/installation.json",
    ]);
  });

  it("uninstall resumes cleanup when recorded Codex registrations were already removed", async () => {
    const commands: string[] = [];
    const removed: string[] = [];

    await runUninstall(
      "/home/ada/.config/public-proposal",
      uninstallDependencies({
        manifest: manifestWithCodexRegistrations({ pluginAdded: true, marketplaceAdded: true }),
        commands,
        removed,
        marketplacePath: null,
        pluginInstalled: false,
      }),
    );

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
    ]);
    expect(removed).toEqual([
      "/home/ada/.config/public-proposal/plugin",
      "/home/ada/.config/public-proposal/marketplace",
      "/home/ada/.config/public-proposal/worker",
      "/home/ada/.config/public-proposal/installation.json",
    ]);
  });

  it("uninstall restores an already-deregistered plugin and preserves files when marketplace deregistration fails", async () => {
    const commands: string[] = [];
    const removed: string[] = [];

    await expect(
      runUninstall(
        "/home/ada/.config/public-proposal",
        uninstallDependencies({
          manifest: manifestWithCodexRegistrations({ pluginAdded: true, marketplaceAdded: true }),
          commands,
          removed,
          failures: new Map([["codex plugin marketplace remove public-proposal --json", {
            code: 1,
            stdout: "",
            stderr: "marketplace busy",
          }]]),
        }),
      ),
    ).rejects.toMatchObject({ code: "PP_UNINSTALL_DEREGISTRATION_FAILED" });

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
      "codex plugin remove public-proposal@public-proposal --json",
      "codex plugin marketplace remove public-proposal --json",
      "codex plugin add public-proposal@public-proposal",
    ]);
    expect(removed).toEqual([]);
  });

  it("uninstall rejects manifest path traversal before recursive removal", async () => {
    const removed: string[] = [];

    await expect(
      runUninstall("/home/ada/.config/public-proposal", {
        readManifest: async () =>
          fakeManifest({
            ownedPaths: ["/home/ada/.config/public-proposal/plugin/../../ssh"],
          }),
        exists: async () => true,
        remove: async (path) => {
          removed.push(path);
        },
      }),
    ).rejects.toMatchObject({ code: "PP_UNINSTALL_PATH_REJECTED" });
    expect(removed).toEqual([]);
  });

  it("uninstall validates every manifest path before changing Codex registrations", async () => {
    const commands: string[] = [];

    await expect(
      runUninstall(
        "/home/ada/.config/public-proposal",
        uninstallDependencies({
          manifest: {
            ...manifestWithCodexRegistrations({ pluginAdded: true, marketplaceAdded: true }),
            ownedPaths: ["/home/ada/.config/public-proposal/plugin/../../ssh"],
          },
          commands,
        }),
      ),
    ).rejects.toMatchObject({ code: "PP_UNINSTALL_PATH_REJECTED" });

    expect(commands).toEqual([]);
  });

  it("uninstall reports a partial uninstall when file cleanup fails after deregistration", async () => {
    const commands: string[] = [];

    await expect(
      runUninstall(
        "/home/ada/.config/public-proposal",
        uninstallDependencies({
          manifest: manifestWithCodexRegistrations({ pluginAdded: true, marketplaceAdded: true }),
          commands,
          removeFailure: new Error("disk is read-only"),
        }),
      ),
    ).rejects.toMatchObject({ code: "PP_UNINSTALL_PARTIAL_FAILED" });

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
      "codex plugin remove public-proposal@public-proposal --json",
      "codex plugin marketplace remove public-proposal --json",
      "codex plugin marketplace add /home/ada/.config/public-proposal/marketplace",
      "codex plugin add public-proposal@public-proposal",
    ]);
  });

  it("uninstall reports a rollback failure when cleanup recovery cannot restore the marketplace", async () => {
    const commands: string[] = [];

    await expect(
      runUninstall(
        "/home/ada/.config/public-proposal",
        uninstallDependencies({
          manifest: manifestWithCodexRegistrations({ pluginAdded: true, marketplaceAdded: true }),
          commands,
          removeFailure: new Error("disk is read-only"),
          failures: new Map([[
            "codex plugin marketplace add /home/ada/.config/public-proposal/marketplace",
            { code: 1, stdout: "", stderr: "marketplace restore failed" },
          ]]),
        }),
      ),
    ).rejects.toMatchObject({ code: "PP_UNINSTALL_ROLLBACK_FAILED" });

    expect(commands).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
      "codex plugin remove public-proposal@public-proposal --json",
      "codex plugin marketplace remove public-proposal --json",
      "codex plugin marketplace add /home/ada/.config/public-proposal/marketplace",
    ]);
  });

  it("uninstall rejects symlink escapes after canonical realpath resolution", async () => {
    const removed: string[] = [];
    const dependencies = {
      readManifest: async () =>
        fakeManifest({
          ownedPaths: ["/home/ada/.config/public-proposal/plugin"],
        }),
      exists: async () => true,
      realpath: async (path: string) =>
        path === "/home/ada/.config/public-proposal/plugin" ? "/tmp/escaped-plugin" : path,
      remove: async (path: string) => {
        removed.push(path);
      },
    };

    await expect(runUninstall("/home/ada/.config/public-proposal", dependencies)).rejects.toMatchObject({
      code: "PP_UNINSTALL_PATH_REJECTED",
    });
    expect(removed).toEqual([]);
  });

  it("uninstall rejects a receipt copied from another installation root", async () => {
    await expect(
      runUninstall("/home/ada/.config/public-proposal", {
        readManifest: async () => fakeManifest({ installRoot: "/other/root", ownedPaths: ["/other/root/plugin"] }),
        exists: async () => true,
        remove: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "PP_INSTALL_MANIFEST_MISMATCH" });
  });

  it("update previews compatibility changes without applying setup", async () => {
    const setupCalls: string[] = [];

    const result = await runUpdate(
      { installRoot: "/home/ada/.config/public-proposal", apply: false },
      {
        readMatrix: async () => ({
          kppVersion: "0.3.0",
          longtableVersion: "0.1.72",
          publicProposalVersion: "0.1.1",
        }),
        checkCompatibility: async () => [
          { name: "authority", status: "pass", detected: "0.1.1", message: "Compatible update available." },
        ],
        setup: async (options) => {
          setupCalls.push(options.installRoot ?? "derived");
          throw new Error("preview must not apply setup");
        },
      },
    );

    expect(result).toEqual({
      mode: "preview",
      changes: ["@longtable/public-proposal 0.1.1"],
    });
    expect(setupCalls).toEqual([]);
  });

  it("update applies only when explicitly requested", async () => {
    const result = await runUpdate(
      { installRoot: "/home/ada/.config/public-proposal", apply: true },
      {
        readMatrix: async () => ({ publicProposalVersion: "0.1.1" }),
        checkCompatibility: async () => [
          { name: "authority", status: "pass", detected: "0.1.1", message: "Compatible update available." },
        ],
        setup: async () => ({
          ok: true,
          plan: [],
          writes: ["/home/ada/.config/public-proposal/installation.json"],
          checks: [],
          manifestPath: "/home/ada/.config/public-proposal/installation.json",
          manifest: fakeManifest(),
        }),
      },
    );

    expect(result.mode).toBe("applied");
    expect(result.manifest).toMatchObject({
      installRoot: "/home/ada/.config/public-proposal",
      kppVersion: "0.3.0",
      longtableVersion: "0.1.72",
    });
  });

  it("update apply returns a failed result when delegated setup reports failure", async () => {
    const result = await runUpdate(
      { installRoot: "/home/ada/.config/public-proposal", apply: true },
      {
        readMatrix: async () => ({ publicProposalVersion: "0.1.1" }),
        checkCompatibility: async () => [
          { name: "authority", status: "pass", detected: "0.1.1", message: "Compatible update available." },
        ],
        setup: async () => ({
          ok: false,
          plan: [],
          writes: [],
          checks: [],
          error: { code: "PP_MARKETPLACE_CONFLICT", message: "conflict" },
        }),
      },
    );

    expect(result).toEqual({
      mode: "preview",
      changes: ["blocked: PP_MARKETPLACE_CONFLICT"],
    });
  });

  it("update apply returns a failed result when delegated setup throws", async () => {
    const result = await runUpdate(
      { installRoot: "/home/ada/.config/public-proposal", apply: true },
      {
        readMatrix: async () => ({ publicProposalVersion: "0.1.1" }),
        checkCompatibility: async () => [
          { name: "authority", status: "pass", detected: "0.1.1", message: "Compatible update available." },
        ],
        setup: async () => {
          throw Object.assign(new Error("setup exploded"), { code: "PP_SETUP_COMMAND_FAILED" });
        },
      },
    );

    expect(result).toEqual({
      mode: "preview",
      changes: ["blocked: PP_SETUP_COMMAND_FAILED"],
    });
  });

  it("CLI update --apply emits a failed JSON envelope when setup is blocked", async () => {
    const installRoot = await mkdtemp(join(tmpdir(), "public-proposal-update-conflict-"));
    try {
      await mkdir(join(installRoot, "marketplace"), { recursive: true });
      await writeFile(join(installRoot, "marketplace", "marketplace.json"), "{\"name\":\"other\"}\n", "utf8");

      const result = await runCli(["update", "--install-root", installRoot, "--apply", "--json"]);
      const envelope = JSON.parse(result.stdout) as { ok: boolean; code: string; data: unknown };

      expect(result.code).toBe(1);
      expect(envelope).toMatchObject({
        ok: false,
        code: "PP_MARKETPLACE_CONFLICT",
      });
      await expect(readFile(join(installRoot, "installation.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(installRoot, { force: true, recursive: true });
    }
  });
});

function fakeManifest(input?: Partial<InstallManifest>): InstallManifest {
  const installRoot = input?.installRoot ?? "/home/ada/.config/public-proposal";
  return {
    schemaVersion: "1.0.0",
    packageVersion: "0.1.0",
    kppVersion: "0.3.0",
    longtableVersion: "0.1.72",
    pluginVersion: "0.2.3",
    workerProtocol: "1.0.0",
    installRoot,
    pluginManifestSha256: "sha256:plugin",
    bundleManifestSha256: "sha256:bundle",
    ownedPaths: ["/home/ada/.config/public-proposal/plugin"],
    createdAt: "2026-08-18T00:00:00.000Z",
    ...input,
    worker: input?.worker ?? {
      executable: `${installRoot}/worker/bin/python`,
      protocolVersion: "1.0.0",
      sha256: `sha256:${"a".repeat(64)}`,
    },
  };
}

function manifestWithCodexRegistrations(
  registrations: { pluginAdded: boolean; marketplaceAdded: boolean },
): InstallManifest {
  return {
    ...fakeManifest({
      ownedPaths: [
        "/home/ada/.config/public-proposal/plugin",
        "/home/ada/.config/public-proposal/marketplace",
        "/home/ada/.config/public-proposal/worker",
      ],
    }),
    codexRegistrations: registrations,
  } as InstallManifest;
}

function legacyManifestWithoutCodexRegistrations(): InstallManifest {
  const manifest = manifestWithCodexRegistrations({ pluginAdded: true, marketplaceAdded: true });
  delete (manifest as Partial<InstallManifest>).codexRegistrations;
  return manifest;
}

function uninstallDependencies(input: {
  manifest: InstallManifest;
  commands: string[];
  removed?: string[];
  failures?: Map<string, { code: number; stdout: string; stderr: string }>;
  removeFailure?: Error;
  marketplacePath?: string | null;
  pluginInstalled?: boolean;
}): UninstallDependencies {
  return {
    readManifest: async () => input.manifest,
    exists: async () => true,
    remove: async (path) => {
      if (input.removeFailure) throw input.removeFailure;
      input.removed?.push(path);
    },
    spawn: async (command, args) => {
      const rendered = [command, ...args].join(" ");
      input.commands.push(rendered);
      if (rendered === "codex plugin marketplace list --json") {
        return {
          code: 0,
          stdout: JSON.stringify({
            marketplaces: input.marketplacePath === null ? [] : [{
              name: "public-proposal",
              path: input.marketplacePath ?? "/home/ada/.config/public-proposal/marketplace",
            }],
          }),
          stderr: "",
        };
      }
      if (rendered === "codex plugin list --json") {
        return {
          code: 0,
          stdout: JSON.stringify({
            installed: input.pluginInstalled === false ? [] : [{
              pluginId: "public-proposal@public-proposal",
              installed: true,
            }],
          }),
          stderr: "",
        };
      }
      return input.failures?.get(rendered) ?? { code: 0, stdout: "", stderr: "" };
    },
  } as UninstallDependencies;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
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
