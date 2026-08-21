import { afterEach, describe, expect, test } from "vitest";
import { execFile as execFileCallback } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  cleanupComplexProposalFixtures,
  materializeComplexPrivatePartnership,
  runComplexBuildRenderAudit,
} from "./complex-proposal-fixture.js";

const execFile = promisify(execFileCallback);
const SURFACE_AUDITOR = resolve("plugins/public-proposal/skills/korean-public-proposal/scripts/audit_surface_contract.py");
const VISUAL_AUDITOR = resolve("plugins/public-proposal/skills/korean-public-proposal/scripts/audit_rendered_visual.py");

afterEach(cleanupComplexProposalFixtures);

describe("complex community-care proposal regression", () => {
  test("builds a different multi-surface proposal and passes structural, surface, and visual gates", async () => {
    const fixture = await materializeComplexPrivatePartnership();
    const result = await runComplexBuildRenderAudit(fixture);

    expect(result.audit).toMatchObject({ state: "AUDITED", report: { status: "PASS" } });
    expect(result.audit.report.findings).toEqual([]);
    const surfaceAudit = await runSurfaceAudit(fixture.root, result.built.docxPath, result.rendered.manifestPath);
    expect(surfaceAudit.status).toBe("PASS");
    expect(surfaceAudit.observations).toMatchObject({ tableCount: 8, svgCount: 8, pageCount: 8, bound: true });

    const visualAudit = await runVisualAudit(fixture.root, result.rendered.pdfPath);
    expect(visualAudit.status).toBe("PASS");
    expect(visualAudit.humanReviewRequired).toBe(true);
    expect(visualAudit.observations).toMatchObject({ pageCount: 8, pageImageCount: 8, svgHiddenLabels: 0 });
    expect(visualAudit.observations.surfaceTypes).toEqual(expect.arrayContaining(["figure", "mixed", "table"]));
    expect(visualAudit.observations.figureFamilies).toEqual(expect.arrayContaining(["svg-academic-framework", "word-native-raci-table", "svg-gantt"]));

    const architecture = JSON.parse(await readFile(join(fixture.root, "content", "page-architecture.json"), "utf8"));
    expect(architecture.pages[0].titlePointSize).toBe(20.5);
    expect(architecture.pages.slice(1).every((page: any) => page.continuation && page.titlePointSize <= 12)).toBe(true);
    await expect(access(join(fixture.root, "receipts", "approval.json"))).rejects.toBeDefined();
  }, 180_000);
});

async function runSurfaceAudit(root: string, docxPath: string, renderManifestPath: string): Promise<any> {
  const contractPath = join(root, "surface-contract.json");
  const outputPath = join(root, "surface-audit.json");
  await writeFile(contractPath, JSON.stringify({
    schemaVersion: "kpp-surface-contract-1.0",
    requireRenderManifest: true,
    tables: {
      widthDxa: 8400,
      columnWidthsDxaByTable: [
        [1500, 1900, 3000, 2000],
        [2200, 2900, 1500, 1800],
        [1700, 2900, 1700, 2100],
        [1700, 2900, 1700, 2100],
        [1500, 2600, 1800, 2500],
        [1800, 1900, 2300, 2400],
        [1400, 1800, 1900, 2100, 1200],
        [2400, 1900, 2600, 1500],
      ],
      headerFill: "#E8EEF5",
      bodyFill: "#FFFFFF",
      repeatHeader: true,
      headerAlignment: "center",
      bodyAlignment: "left",
      bodyLine: { line: "365", lineRule: "auto" },
      allowZebraStriping: false,
    },
    svg: { allowOuterCanvasFill: false, bodyFill: "#FFFFFF", rowRoles: ["work-package-row", "raci-row"], allowZebraStriping: false },
    render: { requirePages: 8 },
  }, null, 2), "utf8");
  try {
    await execFile("python3", [SURFACE_AUDITOR, docxPath, "--contract", contractPath, "--svg-dir", join(root, "figures"), "--figure-manifest-dir", join(root, "figures"), "--render-manifest", renderManifestPath, "--out", outputPath]);
  } catch {
    return JSON.parse(await readFile(outputPath, "utf8"));
  }
  return JSON.parse(await readFile(outputPath, "utf8"));
}

async function runVisualAudit(root: string, pdfPath: string): Promise<any> {
  const contractPath = join(root, "visual-contract.json");
  const outputPath = join(root, "visual-audit.json");
  await writeFile(contractPath, JSON.stringify({
    schemaVersion: "kpp-rendered-visual-contract-1.0",
    visual: {
      safeMarginsPt: { left: 72, right: 72, top: 36, bottom: 36 },
      textImageOverlapArea: 4,
      minPageDensity: 0.10,
      maxPageDensity: 0.82,
      requiredText: [
        { page: 1, text: "지역돌봄 데이터 연계 실증 제안" },
        { page: 2, text: "요구사항과 검증근거의 교차표" },
        { page: 3, text: "운영 모델과 책임 인계" },
        { page: 4, text: "개인정보·안전 통제 설계" },
        { page: 5, text: "100일 실행 로드맵" },
        { page: 6, text: "대안 비교와 선정 논리" },
        { page: 7, text: "성과평가와 중단 관문" },
        { page: 8, text: "다음 협의에서 결정할 항목" },
      ],
    },
    frontier: {
      maxConsecutiveSameSurface: 3,
      requiredSurfaceTypes: ["figure", "mixed", "table"],
      requiredFigureFamilies: ["svg-academic-framework", "word-native-raci-table", "svg-gantt"],
    },
  }, null, 2), "utf8");
  try {
    await execFile("python3", [
      VISUAL_AUDITOR,
      pdfPath,
      "--pages-dir",
      join(root, "rendered", "current"),
      "--svg-dir",
      join(root, "figures"),
      "--contract",
      contractPath,
      "--architecture",
      join(root, "content", "page-architecture.json"),
      "--figure-manifest",
      join(root, "figures", "build-figure-manifest.json"),
      "--out",
      outputPath,
    ]);
  } catch {
    return JSON.parse(await readFile(outputPath, "utf8"));
  }
  return JSON.parse(await readFile(outputPath, "utf8"));
}
