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
  pluginManifestSha?: string;
}): FakeDoctorDependencies {
  const kppVersion = input?.kppVersion === undefined ? SUPPORTED_KPP_VERSION : input.kppVersion;
  const longtableVersion =
    input?.longtableVersion === undefined ? SUPPORTED_LONGTABLE_VERSION : input.longtableVersion;
  const workerProtocol = input?.workerProtocol === undefined ? WORKER_PROTOCOL_VERSION : input.workerProtocol;
  const pluginManifestSha = input?.pluginManifestSha ?? "sha256:/pkg/plugin/.codex-plugin/plugin.json";
  const commands: string[] = [];

  return {
    packageRoot: "/pkg",
    commands,
    sha256: async (path) => {
      if (path.endsWith("plugin.json")) return pluginManifestSha;
      return `sha256:${path}`;
    },
    readFile: async (path) => {
      if (path === "/pkg/plugin/.codex-plugin/plugin.json") {
        return JSON.stringify({ name: "public-proposal", version: "0.1.0" });
      }
      if (path === "/pkg/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json") {
        return JSON.stringify({ schemaVersion: "1.0.0" });
      }
      if (path === "/pkg/marketplace/marketplace.json") {
        return JSON.stringify({
          name: "public-proposal",
          plugins: [{ name: "public-proposal", source: { path: "../plugin" } }],
        });
      }
      throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
    },
    exists: async (path) => path.startsWith("/home/ada/.config/public-proposal") || path.startsWith("/pkg"),
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
      if (rendered === "kpp worker doctor --json") {
        return workerProtocol === null
          ? { code: 1, stdout: "{\"ok\":false}\n", stderr: "" }
          : ok(`{"ok":true,"protocol":"${workerProtocol}"}\n`);
      }
      if (rendered.startsWith("codex plugin list")) return ok("{\"plugins\":[{\"name\":\"public-proposal\"}]}\n");
      return { code: 127, stdout: "", stderr: `unexpected host command: ${rendered}` };
    },
  };
}

function ok(stdout: string): ProcessResult {
  return { code: 0, stdout, stderr: "" };
}
