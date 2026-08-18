import { describe, expect, it } from "vitest";
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
