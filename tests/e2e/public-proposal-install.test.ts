import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateRegistryProbe,
  makeReleaseReport,
  runCleanEnvironmentFixture,
  runProposalClassFixture,
  runReleaseGate,
  validateBenchmarkEvidence,
} from "../../scripts/verify_public_proposal_release.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("public proposal clean installation", () => {
  it("reports the packaged plugin and independent LongTable source while the managed-worker gate is explicitly partial", async () => {
    const result = await runCleanInstallFixture();

    expect(result.exitCode).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report).toMatchObject({
      envelopes: {
        setup: { ok: true },
        publicDoctor: { ok: true },
      },
      manifest: {
        kppVersion: "0.2.1",
        longtableVersion: "0.1.72",
        workerProtocol: "1.0.0",
        registrationOwnership: {
          publicProposal: expect.objectContaining({ marketplaceSource: expect.stringMatching(/\/marketplace$/u) }),
          longtable: expect.objectContaining({
            ownership: "installer_owned",
            pluginId: "longtable@longtable",
            marketplaceSource: expect.stringMatching(/\/longtable-marketplace$/u),
          }),
        },
      },
        plugin: {
          name: "public-proposal",
          marketplaceSource: "./plugin",
        },
        registeredSkills: {
          longtable: true,
          longtableResearch: true,
          names: ["korean-public-proposal", "longtable", "longtable-research", "public-proposal"],
      },
    });
    const kppDoctor = result.report.commands.find(({ name }) => name === "kpp doctor");
    if (kppDoctor === undefined) throw new Error("clean-install fixture did not run kpp doctor");
    expect(JSON.parse(kppDoctor.stdout)).toMatchObject({
      ok: true,
      data: { checks: expect.arrayContaining([
      expect.objectContaining({
        name: "worker_protocol",
        status: "warn",
        code: "PP_WORKER_PROTOCOL_MISSING",
      }),
      ]) },
    });
    expect(result.report.commands.map(({ name }) => name)).toEqual([
      "public-proposal setup",
      "public-proposal doctor",
      "kpp doctor",
      "longtable doctor",
    ]);
  });

  it("enforces an explicit fixture-only write boundary and environment allowlist", async () => {
    const result = await runCleanInstallFixture();

    expect(result.report.isolation).toMatchObject({
      allowedWriteRoot: resolve(result.report.fixtureRoot),
      violations: [],
      environmentMode: "allowlist",
    });
    expect(result.report.isolation.environmentKeys).not.toContain("CODEX_HOME");
    expect(result.report.isolation.environmentKeys).not.toContain("NPM_CONFIG_USERCONFIG");
    expect(result.report.isolation.environmentKeys).not.toContain("XDG_DATA_HOME");
    expect(result.report.isolation.deniedWriteProbe).toEqual({ exitCode: 1, detected: "ERR_ACCESS_DENIED" });
    expect(result.report.isolation.deniedHostReadProbe).toEqual({ exitCode: 1, detected: "ERR_ACCESS_DENIED" });
    const runnerWrites = result.report.isolation.fakeRunnerEvents.filter(
      (event): event is { writePath: string } => hasStringWritePath(event),
    );
    expect(runnerWrites.length).toBeGreaterThan(0);
    expect(runnerWrites.every(({ writePath }) => resolve(writePath).startsWith(`${resolve(result.report.fixtureRoot)}/`))).toBe(true);
  });
});

describe("proposal-class research matrix", () => {
  it.each(["academic_research", "research_service", "policy_research"] as const)(
    "blocks %s before authoring when the LongTable lock is missing",
    async (proposalClass) => {
      const result = await runAcademicFixture({ proposalClass, researchLock: false });

      expect(result.envelope).toMatchObject({ ok: false, code: "PP_RESEARCH_LOCK_MISSING" });
      expect(result.isolation).toMatchObject({ violations: [], environmentMode: "allowlist" });
      expect(result.isolation.deniedWriteProbe.detected).toBe("ERR_ACCESS_DENIED");
      expect(result.isolation.deniedHostReadProbe.detected).toBe("ERR_ACCESS_DENIED");
    },
  );

  it("advances a research-service fixture to CONTENT_APPROVED with a valid lock", async () => {
    const result = await runAcademicFixture({ proposalClass: "research_service", researchLock: true });

    expect(result.envelope).toMatchObject({ ok: true, data: { state: "CONTENT_APPROVED" } });
    expect(result.researchBinding).toMatchObject({ boundToContentApproval: true });
  });

  it("keeps general procurement usable without LongTable", async () => {
    const result = await runAcademicFixture({ proposalClass: "general_procurement", researchLock: false });

    expect(result.envelope).toMatchObject({ ok: true, data: { state: "CONTENT_APPROVED" } });
    expect(result.researchBinding).toBeNull();
  });

  it("blocks general procurement with a locked academic evidence slot until LongTable is bound", async () => {
    const result = await runAcademicFixture({
      proposalClass: "general_procurement",
      researchLock: false,
      academicEvidence: true,
    });

    expect(result.envelope).toMatchObject({ ok: false, code: "PP_RESEARCH_LOCK_MISSING" });
    expect(result.isolation).toMatchObject({ violations: [], environmentMode: "allowlist" });
  });

  it("binds a genuine LongTable receipt for general procurement with academic evidence", async () => {
    const result = await runAcademicFixture({
      proposalClass: "general_procurement",
      researchLock: true,
      academicEvidence: true,
    });

    expect(result.envelope).toMatchObject({ ok: true, data: { state: "CONTENT_APPROVED" } });
    expect(result.researchBinding).toMatchObject({
      boundToContentApproval: true,
      researchLockSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("does not impose the research-lock gate on document restyling", async () => {
    const result = await runAcademicFixture({ proposalClass: "document_restyle", researchLock: false });

    expect(result.envelope.code).not.toMatch(/^PP_(?:RESEARCH|LONGTABLE)/u);
  });
});

describe("benchmark release boundary", () => {
  it("keeps machine-only effectiveness evidence outside release readiness", () => {
    expect(validateBenchmarkEvidence({
      protocolVersion: "1.0.0",
      scorerVersion: "1.0.0",
      effectivenessValidated: false,
      humanEvaluationRequired: true,
      rawEvidencePreserved: true,
    })).toEqual({ ok: false, code: "PP_EFFECTIVENESS_HUMAN_EVALUATION_REQUIRED" });
  });

  it("keeps registry availability separate from local artifact verification", () => {
    expect(makeReleaseReport({
      localArtifactVerified: true,
      registryAvailable: false,
      effectivenessValidated: true,
    })).toEqual({
      localArtifactVerified: true,
      registryAvailable: false,
      effectivenessValidated: true,
      releaseReady: false,
    });
  });

  it("does not treat a same-version registry artifact with different bytes as available", () => {
    expect(evaluateRegistryProbe({
      exitCode: 0,
      stdout: JSON.stringify({ version: "0.1.3", "dist.integrity": "sha512-registry" }),
      expectedVersion: "0.1.3",
      expectedIntegrity: "sha512-local",
    })).toMatchObject({
      versionVisible: true,
      artifactMatches: false,
      available: false,
      blocker: "PP_REGISTRY_ARTIFACT_MISMATCH",
    });
  });

  it("does not call a machine-only benchmark release-ready", () => {
    expect(makeReleaseReport({
      localArtifactVerified: true,
      registryAvailable: true,
      effectivenessValidated: false,
    })).toMatchObject({
      effectivenessValidated: false,
      releaseReady: false,
    });
  });

  it("fails closed when ordinary general procurement invokes research", () => {
    expect(runReleaseGate({
      localArtifactVerified: true,
      registryAvailable: true,
      effectivenessValidated: true,
      researchInvocations: { generalProcurement: 1 },
    })).toEqual({
      ok: false,
      code: "PP_UNEXPECTED_RESEARCH_INVOCATION",
      localArtifactVerified: true,
      registryAvailable: true,
      effectivenessValidated: true,
      releaseReady: false,
    });
  });
});

async function runCleanInstallFixture() {
  const result = await runCleanEnvironmentFixture();
  temporaryRoots.push(result.report.fixtureRoot);
  return result;
}

async function runAcademicFixture(options: {
  readonly proposalClass:
    | "academic_research"
    | "research_service"
    | "policy_research"
    | "general_procurement"
    | "document_restyle";
  readonly researchLock: boolean;
  readonly academicEvidence?: boolean;
}) {
  const result = await runProposalClassFixture(options);
  temporaryRoots.push(result.fixtureRoot);
  return result;
}

function hasStringWritePath(value: unknown): value is { writePath: string } {
  return typeof value === "object" && value !== null && "writePath" in value
    && typeof (value as { writePath?: unknown }).writePath === "string";
}
