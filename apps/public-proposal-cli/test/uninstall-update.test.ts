import { describe, expect, it } from "vitest";
import type { InstallManifest } from "../src/contracts.js";
import { runUninstall } from "../src/commands/uninstall.js";
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
    ]);
    expect(result.preserved).toEqual(["/home/ada/.config/public-proposal/.longtable", "/work/customer-evidence"]);
  });

  it("update previews compatibility changes without applying setup", async () => {
    const setupCalls: string[] = [];

    const result = await runUpdate(
      { installRoot: "/home/ada/.config/public-proposal", apply: false },
      {
        readMatrix: async () => ({
          kppVersion: "0.2.1",
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
      kppVersion: "0.2.1",
      longtableVersion: "0.1.72",
    });
  });
});

function fakeManifest(input?: Partial<InstallManifest>): InstallManifest {
  return {
    schemaVersion: "1.0.0",
    packageVersion: "0.1.0",
    kppVersion: "0.2.1",
    longtableVersion: "0.1.72",
    pluginVersion: "0.1.0",
    workerProtocol: "1.0.0",
    installRoot: "/home/ada/.config/public-proposal",
    pluginManifestSha256: "sha256:plugin",
    bundleManifestSha256: "sha256:bundle",
    ownedPaths: ["/home/ada/.config/public-proposal/plugin"],
    createdAt: "2026-08-18T00:00:00.000Z",
    ...input,
  };
}
