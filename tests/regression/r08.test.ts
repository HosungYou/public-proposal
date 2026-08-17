import { afterEach, expect, test } from "vitest";
import { auditProposal } from "@kpp/audits";
import { cleanupFixtures, materializeR08Reference, mutateTableMargin, projectPath, rebindDocxHash, rebindFigureOutputHash, runGeometry } from "./fixture-harness.js";
import { readFile, writeFile } from "node:fs/promises";

afterEach(cleanupFixtures);

async function audit(fixture: Awaited<ReturnType<typeof materializeR08Reference>>, suffix: string) {
  return auditProposal({
    root: await projectPath(fixture), docx: { docxPath: fixture.docxPath, buildManifestPath: fixture.buildManifestPath, geometryReportPath: fixture.geometryReportPath },
    renderManifestPath: fixture.renderManifestPath, trustedPdftotextPath: fixture.extractorPath, figures: [fixture.figure], outputPath: `${fixture.root}/audit/${suffix}.json`,
  });
}

test("R08 sanitized reference passes the public file-backed audit", async () => {
  const fixture = await materializeR08Reference();
  expect((await audit(fixture, "pass")).status).toBe("PASS");
  const page = await readFile(fixture.pagePath);
  expect(page.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

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
