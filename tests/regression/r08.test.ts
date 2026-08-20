import { afterEach, expect, test } from "vitest";
import { auditProposal } from "@longtable/kpp-audits";
import { cleanupFixtures, materializeR08Reference, mutateTableMargin, projectPath, readEmbeddedDocxMedia, rebindDocxHash, rebindFigureOutputHash, runGeometry } from "./fixture-harness.js";
import { readFile, stat, writeFile } from "node:fs/promises";
import { verifyReceipt } from "@longtable/kpp-core";
import { join } from "node:path";

afterEach(cleanupFixtures);

async function audit(fixture: Awaited<ReturnType<typeof materializeR08Reference>>, suffix: string) {
  const result = await auditProposal({
    root: await projectPath(fixture), docx: { docxPath: fixture.docxPath, buildManifestPath: fixture.buildManifestPath, geometryReportPath: fixture.geometryReportPath },
    pageArchitecturePath: fixture.pageArchitecturePath,
    authoringResponsePath: fixture.authoringResponsePath,
    renderManifestPath: fixture.renderManifestPath, trustedPdftotextPath: fixture.extractorPath, figures: [fixture.figure], outputPath: `${fixture.root}/audit/${suffix}.json`,
  });
  return result;
}

test("synthetic reference renders its fixture-backed visual surface while incomplete v2 release bindings stay blocked", async () => {
  const fixture = await materializeR08Reference();
  const contentReceipt = await verifyReceipt(join(await projectPath(fixture), "receipts", "content-approval.json"));
  expect(contentReceipt.valid).toBe(true);
  expect(contentReceipt.receipt.files.map(({ path }) => path))
    .toContain(fixture.authoringResponsePath);
  const auditResult = await audit(fixture, "pass");
  expect(auditResult.status).toBe("BLOCKED");
  expect(auditResult.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
    "KPP_REFERENCE_MANIFEST_UNBOUND",
    "KPP_SOURCE_OUTPUT_TRACEABILITY_ROLE_MISSING",
  ]));

  const visualReference = await readFile(join(fixture.root, "fixture", "ooxml", "word", "media", "visual-reference.png"));
  expect(visualReference.length).toBeGreaterThan(1_000_000);
  const embedded = await readEmbeddedDocxMedia(fixture.docxPath);
  expect(embedded.length).toBeGreaterThan(1_000);
  expect(embedded.equals(await readFile(join(fixture.root, "fixture", "ooxml", "word", "media", "image1.png")))).toBe(true);

  const page = await readFile(fixture.pagePath);
  expect(pngSize(page)).toEqual({ width: 1275, height: 1650 });
  // LibreOffice's PNG encoder produces different but valid byte sizes across hosts.
  expect((await stat(fixture.pagePath)).size).toBeGreaterThan(10_000);
}, 30_000);

test("R08 mutations remain blocked by their structural audit boundaries", async () => {
  const figure = await materializeR08Reference();
  await writeFile(figure.figure.svgPath, (await readFile(figure.figure.svgPath, "utf8")).replaceAll('data-kpp-role="duration-bar"', 'data-kpp-role="plain-box"'));
  await rebindFigureOutputHash(figure.figure.manifestPath, figure.figure.svgPath);
  expect((await audit(figure, "generic-box")).findings.map((finding) => finding.code)).toContain("KPP_DESIGN_GANTT_STRUCTURE");

  const table = await materializeR08Reference();
  await mutateTableMargin(table.docxPath);
  await rebindDocxHash(table.buildManifestPath, table.docxPath);
  expect((await audit(table, "table")).findings.map((finding) => finding.code)).toContain("KPP_SOURCE_DOCX_GEOMETRY");
  expect((await runGeometry(table.docxPath)).findings.map((finding) => finding.code)).toContain("KPP_DOCX_TABLE_GEOMETRY");

  const page = await materializeR08Reference();
  await writeFile(page.pagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect((await audit(page, "page-bytes")).findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
    "KPP_DESIGN_SURFACE_LINEAGE", "KPP_RENDER_PAGE_IMAGES",
  ]));

  const binding = await materializeR08Reference();
  const manifest = JSON.parse(await readFile(binding.figure.manifestPath, "utf8")) as { bindings: { evidenceIds: string[] } };
  manifest.bindings.evidenceIds = [];
  await writeFile(binding.figure.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  expect((await audit(binding, "binding")).findings.map((finding) => finding.code)).toContain("KPP_DESIGN_SURFACE_LINEAGE");
}, 30_000);

function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
