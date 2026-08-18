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
  it("reports the packaged plugin, KPP, LongTable, and worker at their pinned versions", async () => {
    const result = await runCleanInstallFixture();

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      ok: true,
      manifest: {
        kppVersion: "0.2.1",
        longtableVersion: "0.1.72",
        workerProtocol: "1.0.0",
      },
      plugin: {
        name: "public-proposal",
        marketplaceSource: "../plugin",
      },
    });
    expect(result.report.commands.map(({ name }) => name)).toEqual([
      "public-proposal setup",
      "public-proposal doctor",
      "kpp doctor",
      "longtable doctor",
    ]);
  });

  it("keeps every fixture write outside the maintainer HOME and LongTable state", async () => {
    const result = await runCleanInstallFixture();
    const fixtureRoot = resolve(result.report.fixtureRoot);

    expect(resolve(result.report.home)).toMatch(new RegExp(`^${escapeRegExp(fixtureRoot)}/`));
    expect(result.report.paths.every((path) => resolve(path).startsWith(`${fixtureRoot}/`))).toBe(true);
    expect(result.report.paths.some((path) => path.includes("/.longtable/"))).toBe(false);
    if (process.env.HOME !== undefined) {
      expect(resolve(result.report.home)).not.toBe(resolve(process.env.HOME));
    }
  });
});

describe("proposal-class research matrix", () => {
  it.each(["academic_research", "research_service", "policy_research"] as const)(
    "blocks %s before authoring when the LongTable lock is missing",
    async (proposalClass) => {
      const result = await runAcademicFixture({ proposalClass, researchLock: false });

      expect(result).toMatchObject({ ok: false, code: "PP_RESEARCH_LOCK_MISSING" });
    },
  );

  it("advances a research-service fixture to CONTENT_APPROVED with a valid lock", async () => {
    const result = await runAcademicFixture({ proposalClass: "research_service", researchLock: true });

    expect(result).toMatchObject({ ok: true, data: { state: "CONTENT_APPROVED" } });
  });

  it("keeps general procurement usable without LongTable", async () => {
    const result = await runAcademicFixture({ proposalClass: "general_procurement", researchLock: false });

    expect(result).toMatchObject({ ok: true, data: { state: "CONTENT_APPROVED" } });
  });

  it("does not impose the research-lock gate on document restyling", async () => {
    const result = await runAcademicFixture({ proposalClass: "document_restyle", researchLock: false });

    expect(result.code).not.toMatch(/^PP_(?:RESEARCH|LONGTABLE)/u);
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
}) {
  const result = await runProposalClassFixture(options);
  temporaryRoots.push(result.fixtureRoot);
  return result.envelope;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
