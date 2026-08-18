import { describe, expect, it } from "vitest";
import {
  SUPPORTED_KPP_VERSION,
  SUPPORTED_LONGTABLE_VERSION,
  WORKER_PROTOCOL_VERSION,
  type DoctorInput,
  type ProcessResult,
} from "../src/contracts.js";
import { runDoctor, type DoctorDependencies } from "../src/commands/doctor.js";

describe("public proposal doctor", () => {
  it("fails when a required exact KPP version check is missing", async () => {
    const report = await runDoctor(fakeDoctorInput(), fakeDoctorDependencies({ kppVersion: null }));

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "kpp",
        status: "blocker",
        code: "PP_KPP_VERSION_MISMATCH",
      }),
    );
  });

  it("treats missing LongTable as a blocker for research proposal classes", async () => {
    const report = await runDoctor(
      fakeDoctorInput({ projectClass: "research_service" }),
      fakeDoctorDependencies({ longtableVersion: null }),
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "longtable",
        status: "blocker",
        code: "PP_LONGTABLE_REQUIRED",
      }),
    );
  });

  it("treats missing LongTable as a warning when the proposal class is unclassified", async () => {
    const report = await runDoctor(fakeDoctorInput(), fakeDoctorDependencies({ longtableVersion: null }));

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "longtable",
        status: "warning",
        code: "PP_LONGTABLE_REQUIRED",
      }),
    );
  });

  it("accepts LongTable when the CLI has no --version command but its pinned package metadata is available", async () => {
    const base = fakeDoctorDependencies();
    const report = await runDoctor(fakeDoctorInput(), {
      ...base,
      packageVersion: async (packageName: string) => packageName === "@longtable/cli" ? SUPPORTED_LONGTABLE_VERSION : null,
      spawn: async (command, args, options) => {
        if (command === "longtable" && args.join(" ") === "--version") {
          return { code: 1, stdout: "", stderr: "Unknown command: --version" };
        }
        return base.spawn(command, args, options);
      },
    } as DoctorDependencies);

    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "longtable",
      status: "pass",
      detected: expect.objectContaining({ version: SUPPORTED_LONGTABLE_VERSION, source: "package.json" }),
    }));
  });

  it("accepts KPP when the CLI has no --version command but its pinned package metadata is available", async () => {
    const base = fakeDoctorDependencies();
    const report = await runDoctor(fakeDoctorInput(), {
      ...base,
      packageVersion: async (packageName: string) => packageName === "@longtable/kpp-cli" ? SUPPORTED_KPP_VERSION : null,
      spawn: async (command, args, options) => {
        if (command === "kpp" && args.join(" ") === "--version") {
          return { code: 1, stdout: "", stderr: "명령어 입력이 올바르지 않습니다." };
        }
        if (command === "kpp" && args.join(" ") === "doctor --json") {
          return { code: 0, stdout: "{\"ok\":true}\n", stderr: "" };
        }
        return base.spawn(command, args, options);
      },
    } as DoctorDependencies);

    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "kpp",
      status: "pass",
      detected: expect.objectContaining({ version: SUPPORTED_KPP_VERSION, source: "package.json" }),
    }));
  });

  it("blocks setup when plugin integrity fails independently of runtime tools", async () => {
    const report = await runDoctor(fakeDoctorInput(), fakeDoctorDependencies({ pluginManifestSha: "wrong" }));

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
      }),
    );
  });

  it("blocks setup when the managed worker protocol is missing", async () => {
    const report = await runDoctor(fakeDoctorInput(), fakeDoctorDependencies({ workerProtocol: null }));

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "worker",
        status: "blocker",
        code: "PP_WORKER_PROTOCOL_MISSING",
      }),
    );
  });

  it("reports a managed worker protocol mismatch from the receipt", async () => {
    const report = await runDoctor(fakeDoctorInput(), fakeDoctorDependencies({ manifestWorkerProtocol: "2.0.0" }));

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "worker",
        status: "blocker",
        code: "PP_WORKER_PROTOCOL_MISMATCH",
      }),
    );
  });

  it("blocks when the worker wrapper hash no longer matches the receipt", async () => {
    const report = await runDoctor(fakeDoctorInput(), fakeDoctorDependencies({ installedWorkerSha: `sha256:${"f".repeat(64)}` }));

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "worker",
        status: "blocker",
        code: "PP_WORKER_INTEGRITY_FAILED",
      }),
    );
  });

  it("blocks when the installed copied plugin or Korean bundle drifts from the stored manifest hashes", async () => {
    const report = await runDoctor(
      fakeDoctorInput(),
      fakeDoctorDependencies({
        installedPluginSha: "sha256:tampered-installed-plugin",
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
      }),
    );
  });

  it.each(["longtable", "longtable-research"])("blocks when the plugin-discoverable %s skill is missing", async (skill) => {
    const report = await runDoctor(fakeDoctorInput(), fakeDoctorDependencies({ missingSkill: skill }));

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "plugin",
      status: "blocker",
      code: "PP_PLUGIN_NOT_INSTALLED",
    }));
  });

  it("blocks when Codex does not report the marketplace and installed plugin", async () => {
    const report = await runDoctor(fakeDoctorInput(), fakeDoctorDependencies({ codexRegistration: false }));

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "plugin",
      status: "blocker",
      code: "PP_PLUGIN_NOT_INSTALLED",
    }));
  });

  it("accepts a Codex marketplace registration reported through its canonical macOS path", async () => {
    const base = fakeDoctorDependencies();
    const marketplaceRoot = "/home/ada/.config/public-proposal/marketplace";
    const canonicalMarketplaceRoot = "/private/home/ada/.config/public-proposal/marketplace";
    const report = await runDoctor(fakeDoctorInput(), {
      ...base,
      realpath: async (path: string) => path === marketplaceRoot ? canonicalMarketplaceRoot : path,
      spawn: async (command, args, options) => {
        if (command === "codex" && args.join(" ") === "plugin marketplace list --json") {
          return ok(JSON.stringify({ marketplaces: [{ name: "public-proposal", root: canonicalMarketplaceRoot }] }));
        }
        return base.spawn(command, args, options);
      },
    });

    expect(report.checks).toContainEqual(expect.objectContaining({ name: "plugin", status: "pass" }));
  });
});

function fakeDoctorInput(input?: Partial<DoctorInput>): DoctorInput {
  return {
    installRoot: "/home/ada/.config/public-proposal",
    expectedKppVersion: SUPPORTED_KPP_VERSION,
    expectedLongtableVersion: SUPPORTED_LONGTABLE_VERSION,
    expectedWorkerProtocol: WORKER_PROTOCOL_VERSION,
    ...input,
  };
}

interface FakeDoctorDependencies extends DoctorDependencies {
  readonly commands: string[];
}

function fakeDoctorDependencies(input?: {
  kppVersion?: string | null;
  longtableVersion?: string | null;
  workerProtocol?: string | null;
  manifestWorkerProtocol?: string;
  pluginManifestSha?: string;
  installedPluginSha?: string;
    installedWorkerSha?: string;
    missingSkill?: string;
    codexRegistration?: boolean;
}): FakeDoctorDependencies {
  const kppVersion = input?.kppVersion === undefined ? SUPPORTED_KPP_VERSION : input.kppVersion;
  const longtableVersion =
    input?.longtableVersion === undefined ? SUPPORTED_LONGTABLE_VERSION : input.longtableVersion;
  const workerProtocol = input?.workerProtocol === undefined ? WORKER_PROTOCOL_VERSION : input.workerProtocol;
  const manifestWorkerProtocol = input?.manifestWorkerProtocol ?? WORKER_PROTOCOL_VERSION;
  const pluginManifestSha = input?.pluginManifestSha ?? "sha256:/pkg/plugin/.codex-plugin/plugin.json";
  const installedPluginSha =
    input?.installedPluginSha ?? "sha256:/home/ada/.config/public-proposal/plugin/.codex-plugin/plugin.json";
  const installedWorkerSha =
    input?.installedWorkerSha ?? `sha256:${"a".repeat(64)}`;
  const commands: string[] = [];

  return {
    packageRoot: "/pkg",
    commands,
    sha256: async (path) => {
      if (path === "/home/ada/.config/public-proposal/plugin/.codex-plugin/plugin.json") return installedPluginSha;
      if (path === "/home/ada/.config/public-proposal/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json") {
        return "sha256:/home/ada/.config/public-proposal/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json";
      }
      if (path === "/home/ada/.config/public-proposal/worker/bin/python") return installedWorkerSha;
      if (path.endsWith("plugin.json")) return pluginManifestSha;
      return `sha256:${path}`;
    },
    readFile: async (path) => {
      if (path === "/home/ada/.config/public-proposal/installation.json") {
        return JSON.stringify({
          schemaVersion: "1.0.0",
          packageVersion: "0.1.0",
          kppVersion: "0.2.1",
          longtableVersion: "0.1.72",
          pluginVersion: "0.1.0",
          workerProtocol: "1.0.0",
          installRoot: "/home/ada/.config/public-proposal",
          pluginManifestSha256: "sha256:/home/ada/.config/public-proposal/plugin/.codex-plugin/plugin.json",
          bundleManifestSha256:
            "sha256:/home/ada/.config/public-proposal/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json",
          worker: {
            executable: "/home/ada/.config/public-proposal/worker/bin/python",
            protocolVersion: manifestWorkerProtocol,
            sha256: `sha256:${"a".repeat(64)}`,
          },
          ownedPaths: [
            "/home/ada/.config/public-proposal/plugin",
            "/home/ada/.config/public-proposal/marketplace",
            "/home/ada/.config/public-proposal/worker",
          ],
          createdAt: "2026-08-18T00:00:00.000Z",
        });
      }
      if (path === "/home/ada/.config/public-proposal/plugin/.codex-plugin/plugin.json") {
        return JSON.stringify({ name: "public-proposal", version: "0.1.0" });
      }
      if (path === "/home/ada/.config/public-proposal/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json") {
        return JSON.stringify({
          schemaVersion: "1.0.0",
          files: [
            {
              path: "SKILL.md",
              sha256: "sha256:/home/ada/.config/public-proposal/plugin/skills/korean-public-proposal/SKILL.md",
            },
          ],
        });
      }
      if (path === "/home/ada/.config/public-proposal/plugin/skills/korean-public-proposal/SKILL.md") {
        return "# Korean Public Proposal\n";
      }
      if (path === "/home/ada/.config/public-proposal/plugin/skills/longtable/SKILL.md" && input?.missingSkill !== "longtable") {
        return "# LongTable\n";
      }
      if (path === "/home/ada/.config/public-proposal/plugin/skills/longtable-research/SKILL.md" && input?.missingSkill !== "longtable-research") {
        return "# LongTable Research\n";
      }
      if (path === "/pkg/plugin/.codex-plugin/plugin.json") {
        return JSON.stringify({ name: "public-proposal", version: "0.1.0" });
      }
      if (path === "/pkg/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json") {
        return JSON.stringify({ schemaVersion: "1.0.0" });
      }
      if (path === "/pkg/marketplace/marketplace.json") {
        return JSON.stringify({
          name: "public-proposal",
          plugins: [{ name: "public-proposal", source: { source: "local", path: "./plugin" } }],
        });
      }
      throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
    },
    exists: async (path) => path.startsWith("/home/ada/.config/public-proposal") || path.startsWith("/pkg"),
    realpath: async (path) => path,
    spawn: async (command, args) => {
      const rendered = [command, ...args].join(" ");
      commands.push(rendered);
      if (rendered === "node --version") return ok("v22.20.0\n");
      if (rendered === "npm --version") return ok("11.6.0\n");
      if (rendered === "codex --version") return ok("codex 0.144.5\n");
      if (rendered === "python3 --version") return ok("Python 3.13.0\n");
      if (rendered === "soffice --version") return ok("LibreOffice 25.8\n");
      if (rendered.startsWith("fc-match ")) return ok("NotoSansCJKkr-Regular.otf\n");
      if (rendered === "kpp --version") {
        return kppVersion === null ? { code: 127, stdout: "", stderr: "missing" } : ok(`${kppVersion}\n`);
      }
      if (rendered === "longtable --version") {
        return longtableVersion === null
          ? { code: 127, stdout: "", stderr: "missing" }
          : ok(`${longtableVersion}\n`);
      }
      if (rendered === "longtable scholar-research doctor --json") return ok("{\"ok\":true}\n");
      if (rendered === "/home/ada/.config/public-proposal/worker/bin/python -c from kpp_docx.protocol import PROTOCOL_VERSION; print(PROTOCOL_VERSION)") {
        return workerProtocol === null
          ? { code: 1, stdout: "", stderr: "" }
          : ok(`${workerProtocol}\n`);
      }
      if (rendered.startsWith("codex plugin marketplace list")) return input?.codexRegistration === false
        ? ok("{\"marketplaces\":[]}")
        : ok("{\"marketplaces\":[{\"name\":\"public-proposal\",\"path\":\"/home/ada/.config/public-proposal/marketplace\"}]}");
      if (rendered.startsWith("codex plugin list")) return input?.codexRegistration === false
        ? ok("{\"installed\":[],\"available\":[]}")
        : ok("{\"installed\":[{\"pluginId\":\"public-proposal@public-proposal\",\"installed\":true}],\"available\":[]}\n");
      return { code: 127, stdout: "", stderr: `unexpected host command: ${rendered}` };
    },
  };
}

function ok(stdout: string): ProcessResult {
  return { code: 0, stdout, stderr: "" };
}
