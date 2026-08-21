import { afterEach, describe, expect, test } from "vitest";
import { execFile as execFileCallback } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { approveProject } from "../../apps/kpp-cli/src/commands/approve.js";
import { releaseProject } from "../../apps/kpp-cli/src/commands/release.js";
import {
  cleanupPharmacyFixtures,
  materializePharmacyPartnership,
  runPharmacyBuildRenderAudit,
} from "./pharmacy-fixture.js";

const execFile = promisify(execFileCallback);
const SURFACE_AUDITOR = resolve("plugins/public-proposal/skills/korean-public-proposal/scripts/audit_surface_contract.py");

afterEach(cleanupPharmacyFixtures);

describe("anonymized pharmacy private-partnership regression", () => {
  test("passes the complete private-partnership architecture through build, render, and audit but remains unreleasable without named approval", async () => {
    const fixture = await materializePharmacyPartnership("valid");
    const result = await runPharmacyBuildRenderAudit(fixture);

    expect(result.audit).toMatchObject({ state: "AUDITED", report: { status: "PASS" } });
    expect(result.audit.report.slices.map(({ sliceId }) => sliceId)).toEqual(expect.arrayContaining([
      "page_architecture",
      "reference_integrity",
      "operating_model_traceability",
      "render_repetition",
      "figure_value",
      "korean_prose_review",
    ]));
    expect(result.audit.report.findings).toEqual([]);
    const surfaceAudit = await runSurfaceAudit(fixture.root, result.built.docxPath, result.rendered.manifestPath);
    expect(surfaceAudit.status).toBe("PASS");
    expect(surfaceAudit.observations).toMatchObject({ tableCount: 3, svgCount: 4, pageCount: 5, bound: true });
    await expect(releaseProject(fixture.root, {
      approvalPath: join(fixture.root, "receipts", "approval.json"),
      outputParent: join(fixture.root, "release-output"),
    })).rejects.toMatchObject({ code: "KPP_RELEASE_STATE" });
    await expect(access(join(fixture.root, "receipts", "approval.json"))).rejects.toBeDefined();
  }, 120_000);

  test("blocks the oversized continuation title before the worker", async () => {
    const fixture = await materializePharmacyPartnership("oversized_title");
    await expect(runPharmacyBuildRenderAudit(fixture)).rejects.toMatchObject({
      code: "KPP_BUILD_MANIFEST_UNBOUND",
    });
  }, 30_000);

  test("blocks three consecutive copies of one rendered page topology", async () => {
    const fixture = await materializePharmacyPartnership("repeated_topology");
    const result = await runPharmacyBuildRenderAudit(fixture);
    expect(result.audit.state).toBe("RENDERED");
    expect(result.audit.report.status).toBe("BLOCKED");
    expect(result.audit.report.findings.map(({ code }) => code))
      .toContain("KPP_RENDER_SURFACE_TOPOLOGY_REPETITION");
  }, 120_000);

  test("blocks a decorative surface used in the evidentiary figure channel", async () => {
    const fixture = await materializePharmacyPartnership("decorative_evidence");
    const result = await runPharmacyBuildRenderAudit(fixture);
    expect(result.audit.state).toBe("RENDERED");
    expect(result.audit.report.status).toBe("BLOCKED");
    expect(result.audit.report.findings.map(({ code }) => code))
      .toContain("KPP_FIGURE_VALUE_DECORATIVE");
    await expect(approveProject(fixture.root, {
      approvedBy: "익명 검토자",
      auditPath: result.audit.auditPath,
    })).rejects.toMatchObject({ code: "KPP_APPROVAL_STATE" });
  }, 120_000);
});

async function runSurfaceAudit(root: string, docxPath: string, renderManifestPath: string): Promise<any> {
  const contractPath = join(root, "surface-contract.json");
  const outputPath = join(root, "surface-audit.json");
  await writeFile(contractPath, JSON.stringify({
    schemaVersion: "kpp-surface-contract-1.0",
    requireRenderManifest: true,
    tables: {
      headerFill: "#E8EEF5",
      bodyFill: "#FFFFFF",
      repeatHeader: true,
      headerAlignment: "center",
      bodyAlignment: "left",
      bodyLine: { line: "365", lineRule: "auto" },
      allowZebraStriping: false,
    },
    svg: {
      allowOuterCanvasFill: false,
      bodyFill: "#FFFFFF",
      rowRoles: ["work-package-row", "raci-row"],
      allowZebraStriping: false,
    },
    render: { requirePages: 5 },
  }, null, 2), "utf8");
  try {
    await execFile("python3", [
      SURFACE_AUDITOR,
      docxPath,
      "--contract",
      contractPath,
      "--svg-dir",
      join(root, "figures"),
      "--figure-manifest-dir",
      join(root, "figures"),
      "--render-manifest",
      renderManifestPath,
      "--out",
      outputPath,
    ]);
  } catch (error) {
    const report = JSON.parse(await readFile(outputPath, "utf8"));
    throw new Error(`surface audit failed: ${JSON.stringify(report)}; ${String(error)}`);
  }
  return JSON.parse(await readFile(outputPath, "utf8"));
}
