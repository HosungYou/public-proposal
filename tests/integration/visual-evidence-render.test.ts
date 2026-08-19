import { access, readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { renderProject } from "../../apps/kpp-cli/src/commands/render.js";
import { createDeterministicRenderedProject } from "../fixtures/kpp-render-fixture.js";

describe("KPP visual evidence render boundary", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("rejects a caller-selected self-consistent visual probe before publishing", async () => {
    const fixture = await createDeterministicRenderedProject({
      targetPage: 1,
      pageWidthMm: 210,
      pageHeightMm: 297,
      figure: {
        figureId: "FIG-FORGED-001",
        figureSvgSha256: "f".repeat(64),
        box: { xMm: 20, yMm: 58, widthMm: 170, heightMm: 100 },
        caption: "forged caption",
        sectionCallout: "forged callout",
      },
      textBoxes: [],
      peerFigureBoxes: [],
    });
    roots.push(fixture.root);

    await expect(renderProject(fixture.root, {
      docxPath: fixture.docxPath,
      tools: fixture.tools,
    })).rejects.toMatchObject({ code: "KPP_RENDER_VISUAL_EVIDENCE_PROBE_UNTRUSTED" });
    await expect(access(`${fixture.root}/receipts/render.json`)).rejects.toBeDefined();
  });

  it("rejects a visual probe selected through the process environment", async () => {
    const fixture = await createDeterministicRenderedProject({
      targetPage: 1,
      pageWidthMm: 210,
      pageHeightMm: 297,
      figure: {
        figureId: "FIG-FORGED-ENV",
        figureSvgSha256: "e".repeat(64),
        box: { xMm: 20, yMm: 58, widthMm: 170, heightMm: 100 },
        caption: "forged caption",
        sectionCallout: "forged callout",
      },
      textBoxes: [],
      peerFigureBoxes: [],
    });
    roots.push(fixture.root);
    const previous = process.env.KPP_VISUAL_EVIDENCE_PROBE_PATH;
    process.env.KPP_VISUAL_EVIDENCE_PROBE_PATH = fixture.tools.visualEvidenceProbe;
    try {
      const { visualEvidenceProbe: _probe, ...tools } = fixture.tools;
      await expect(renderProject(fixture.root, {
        docxPath: fixture.docxPath,
        tools,
        visualEvidence: true,
      })).rejects.toMatchObject({ code: "KPP_RENDER_VISUAL_EVIDENCE_PROBE_UNTRUSTED" });
      await expect(access(`${fixture.root}/receipts/render.json`)).rejects.toBeDefined();
    } finally {
      if (previous === undefined) delete process.env.KPP_VISUAL_EVIDENCE_PROBE_PATH;
      else process.env.KPP_VISUAL_EVIDENCE_PROBE_PATH = previous;
    }
  });

  it("persists package-approved PNG analysis authority in the canonical generation and RENDERED receipt", async () => {
    const fixture = await createDeterministicRenderedProject({
      targetPage: 1,
      pageWidthMm: 210,
      pageHeightMm: 297,
      figure: {
        figureId: "FIG-TREND-001",
        figureSvgSha256: "a".repeat(64),
        box: { xMm: 20, yMm: 58, widthMm: 170, heightMm: 100 },
        caption: "출처: 공개 통계",
        sectionCallout: "그림 FIG-TREND-001은 최근 분기별 처리량 변화를 보여준다.",
      },
      textBoxes: [],
      peerFigureBoxes: [],
    });
    roots.push(fixture.root);

    const { visualEvidenceProbe: _maliciousProbe, ...renderTools } = fixture.tools;
    const rendered = await renderProject(fixture.root, {
      docxPath: fixture.docxPath,
      tools: renderTools,
      visualEvidence: true,
    });

    expect(rendered.pageImages[0]?.path).toMatch(/page-0001\.png$/u);
    expect(rendered.visualEvidencePages).toHaveLength(1);
    const manifest = JSON.parse(await readFile(rendered.manifestPath, "utf8")) as {
      raster: { format: string };
      visualEvidence?: {
        authority: { schemaVersion: string; authorityId: string; analyzerSha256: string };
        analyzer: { path: string; sha256: string };
        pages: { path: string; sourcePageSha256: string }[];
      };
    };
    expect(manifest.raster.format).toBe("png");
    expect(manifest.visualEvidence?.pages).toEqual([
      expect.objectContaining({
        path: rendered.visualEvidencePages[0]?.path,
        sourcePageSha256: rendered.pageImages[0]?.sha256,
      }),
    ]);
    expect(manifest.visualEvidence?.authority).toMatchObject({
      schemaVersion: "kpp-visual-probe-authority/v1",
      authorityId: "@longtable/kpp-cli/visual-evidence-probe@1",
      analyzerSha256: manifest.visualEvidence?.analyzer.sha256,
    });
    const receipt = await readFile(`${fixture.root}/receipts/render.json`, "utf8");
    expect(receipt).toContain(rendered.visualEvidencePages[0]!.path);
    expect(receipt).toContain(manifest.visualEvidence!.analyzer.path);
  });
});
