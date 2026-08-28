import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runCleanEnvironmentFixture,
  runProposalClassFixture,
} from "../../scripts/verify_public_proposal_release.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("public proposal clean installation", () => {
  it("reports one public skill surface with internal KPP, LongTable, HWPX, and worker dependencies", async () => {
    const result = await runCleanInstallFixture();

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      ok: true,
      manifest: {
        kppVersion: "0.3.0",
        longtableVersion: "0.1.72",
        workerProtocol: "1.0.0",
      },
        plugin: {
          name: "public-proposal",
          marketplaceSource: "./plugin",
        },
        registeredSkills: ["korean-public-proposal"],
        hwpxEngine: {
          commit: "96a2633f23a08f707679d7e212ebdc59948260e6",
          verified: true,
        },
    });
    expect(result.report.commands.map(({ name }) => name)).toEqual([
      "public-proposal setup",
      "public-proposal doctor",
      "kpp doctor",
      "longtable doctor",
    ]);
  }, 30_000);

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
  }, 30_000);
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
