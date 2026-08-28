import { afterEach, describe, expect, test } from "vitest";
import { execFile as execFileCallback } from "node:child_process";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
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
const VISUAL_AUDITOR = resolve("plugins/public-proposal/skills/korean-public-proposal/scripts/audit_rendered_visual.py");

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
    const visualAudit = await runVisualAudit(fixture.root, result.rendered.pdfPath, result.rendered.manifestPath);
    expect(visualAudit.status, JSON.stringify(visualAudit)).toBe("PASS");
    expect(visualAudit.humanReviewRequired).toBe(true);
    expect(visualAudit.observations).toMatchObject({ pageCount: 5, pageImageCount: 5, svgHiddenLabels: 0 });
    expect(visualAudit.observations.svgConnectorLabels).toBeGreaterThan(0);

    const badFigures = join(fixture.root, "bad-figures");
    await mkdir(badFigures, { recursive: true });
    await cp(join(fixture.root, "figures"), badFigures, { recursive: true, force: true });
    const badFigurePath = join(badFigures, "FIG-PH-04.svg");
    const badFigure = await readFile(badFigurePath, "utf8");
    await writeFile(badFigurePath, badFigure.replace('data-kpp-role="connector-label"', 'data-kpp-role="connector-label"').replace('y="48">학습 우선', 'y="121">학습 우선'), "utf8");
    const badVisual = await runVisualAudit(fixture.root, result.rendered.pdfPath, result.rendered.manifestPath, badFigures);
    expect(badVisual.status).toBe("BLOCKED");
    expect(badVisual.findings.map(({ code }: { code: string }) => code)).toContain("KPP_VISUAL_FIGURE_TEXT_HIDDEN_BY_NODE");
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
      widthDxa: 8400,
      columnWidthsDxaByTable: [[1200, 1800, 1700, 1700, 2000], [1200, 1700, 1600, 1900, 2000], [1500, 2500, 1900, 2500]],
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

async function runVisualAudit(root: string, pdfPath: string, renderManifestPath: string, svgDir = join(root, "figures")): Promise<any> {
  const contractPath = join(root, "visual-contract.json");
  const outputPath = join(root, "visual-audit.json");
  await writeFile(contractPath, JSON.stringify({
    schemaVersion: "kpp-rendered-visual-contract-1.0",
    visual: {
      requireRenderManifest: true,
      safeMarginsPt: { left: 72, right: 72, top: 36, bottom: 36 },
      textImageOverlapArea: 4,
      minPageDensity: 0.03,
      maxPageDensity: 0.82,
      requiredText: [
        { page: 1, text: "익명 지역 약국 협력 파일럿" },
        { page: 2, text: "지역 약사회 A는" },
        { page: 3, text: "운영은 협의" },
        { page: 4, text: "양측은 검증 속도" },
        { page: 5, text: "다음 회의에서는" },
      ],
      forbiddenText: [
        { page: 2, region: "top", text: "역할과 승인 경계" },
        { page: 3, region: "top", text: "운영 흐름과 중단 기준" },
        { page: 4, region: "top", text: "협력 선택지와 판단 기준" },
        { page: 5, region: "top", text: "다음 회의에서 결정할 항목" },
      ],
    },
    frontier: {
      maxConsecutiveSameSurface: 3,
      requiredSurfaceTypes: ["figure", "mixed", "table"],
      requiredFigureFamilies: ["svg-academic-framework", "svg-raci-matrix", "svg-gantt"],
    },
  }, null, 2), "utf8");
  const architecturePath = join(root, "content", "page-architecture.json");
  const figureManifestPath = join(root, "figures", "build-figure-manifest.json");
  try {
    await execFile("python3", [
      VISUAL_AUDITOR,
      pdfPath,
      "--pages-dir",
      join(root, "rendered", "current"),
      "--svg-dir",
      svgDir,
      "--contract",
      contractPath,
      "--architecture",
      architecturePath,
      "--figure-manifest",
      figureManifestPath,
      "--render-manifest",
      renderManifestPath,
      "--out",
      outputPath,
    ]);
  } catch (error) {
    return JSON.parse(await readFile(outputPath, "utf8"));
  }
  return JSON.parse(await readFile(outputPath, "utf8"));
}
