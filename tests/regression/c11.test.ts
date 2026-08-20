import { afterEach, expect, test } from "vitest";
import { auditProposal } from "@longtable/kpp-audits";
import { cleanupFixtures, materializeC11KnownBad, projectPath, rebindFigureOutputHash, runGeometry } from "./fixture-harness.js";

afterEach(cleanupFixtures);

test("C11 remains BLOCKED for stale lineage, generic Gantt boxes, and invalid DOCX geometry", async () => {
  const fixture = await materializeC11KnownBad();
  const report = await auditProposal({
    root: await projectPath(fixture), docx: { docxPath: fixture.docxPath, buildManifestPath: fixture.buildManifestPath, geometryReportPath: fixture.geometryReportPath },
    pageArchitecturePath: fixture.pageArchitecturePath,
    renderManifestPath: fixture.renderManifestPath, trustedPdftotextPath: fixture.extractorPath, figures: [fixture.figure], outputPath: `${fixture.root}/audit/c11.json`,
  });
  expect(report.status).toBe("BLOCKED");
  expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
    "KPP_DESIGN_SURFACE_LINEAGE", "KPP_DESIGN_GANTT_STRUCTURE", "KPP_SOURCE_DOCX_GEOMETRY",
  ]));
  expect((await runGeometry(fixture.docxPath)).findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
    "KPP_DOCX_TYPOGRAPHY", "KPP_DOCX_TABLE_GEOMETRY",
  ]));

  await rebindFigureOutputHash(fixture.figure.manifestPath, fixture.figure.svgPath);
  const rebound = await auditProposal({
    root: await projectPath(fixture), docx: { docxPath: fixture.docxPath, buildManifestPath: fixture.buildManifestPath, geometryReportPath: fixture.geometryReportPath },
    pageArchitecturePath: fixture.pageArchitecturePath,
    renderManifestPath: fixture.renderManifestPath, trustedPdftotextPath: fixture.extractorPath, figures: [fixture.figure], outputPath: `${fixture.root}/audit/c11-rebound.json`,
  });
  expect(rebound.status).toBe("BLOCKED");
  expect(rebound.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
    "KPP_DESIGN_SURFACE_LINEAGE", "KPP_DESIGN_GANTT_STRUCTURE",
  ]));
  expect((await runGeometry(fixture.docxPath)).findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
    "KPP_DOCX_TYPOGRAPHY", "KPP_DOCX_TABLE_GEOMETRY",
  ]));
});
