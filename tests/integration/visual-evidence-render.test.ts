import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { renderProject } from "../../apps/kpp-cli/src/commands/render.js";
import { createDeterministicRenderedProject } from "../fixtures/kpp-render-fixture.js";

describe("KPP visual evidence render boundary", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("persists probe-derived PNG layout evidence in the canonical generation and RENDERED receipt", async () => {
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

    const rendered = await renderProject(fixture.root, {
      docxPath: fixture.docxPath,
      tools: fixture.tools,
    });

    expect(rendered.pageImages[0]?.path).toMatch(/page-0001\.png$/u);
    expect(rendered.visualEvidencePages).toHaveLength(1);
    const manifest = JSON.parse(await readFile(rendered.manifestPath, "utf8")) as {
      raster: { format: string };
      visualEvidence?: { pages: { path: string; sourcePageSha256: string }[] };
    };
    expect(manifest.raster.format).toBe("png");
    expect(manifest.visualEvidence?.pages).toEqual([
      expect.objectContaining({
        path: rendered.visualEvidencePages[0]?.path,
        sourcePageSha256: rendered.pageImages[0]?.sha256,
      }),
    ]);
    const receipt = await readFile(`${fixture.root}/receipts/render.json`, "utf8");
    expect(receipt).toContain(rendered.visualEvidencePages[0]!.path);
  });
});
