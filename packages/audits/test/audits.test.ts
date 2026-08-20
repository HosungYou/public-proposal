import { createHash } from "node:crypto";
import { chmod, copyFile, mkdtemp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import {
  auditDocxArtifacts,
  auditFigureArtifacts,
  auditFigureSemanticValue,
  auditProposal,
  auditReleaseReadiness,
  auditRenderArtifacts,
} from "../src/index.js";
import {
  advanceProject,
  executeFile,
  initializeProject,
  sha256File,
  writeReceipt,
} from "@longtable/kpp-core";
import {
  R08_TOKEN_PROFILE_SHA256,
  describeFigureSemanticValue,
  renderFigureArtifact,
  type GanttFigureSpec,
} from "@longtable/kpp-renderers";
import { resolveTool } from "../../../tests/support/tool-paths.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("artifact-backed proposal audits", () => {
  test("blocks a DOCX geometry report whose bytes do not match the inspected DOCX", async () => {
    const fixture = await docxFixture();
    await writeFile(fixture.docxPath, "tampered after geometry inspection", "utf8");

    const result = await auditDocxArtifacts(fixture);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_SOURCE_DOCX_LINEAGE");
  });

  test("blocks a forged PASS geometry report over a non-DOCX payload", async () => {
    const fixture = await docxFixture();
    await writeFile(fixture.docxPath, "synthetic-docx-bytes", "utf8");
    const forgedHash = await sha256File(fixture.docxPath);
    const manifest = JSON.parse(await readFile(fixture.buildManifestPath, "utf8")) as {
      artifacts: { docx: { sha256: string } };
    };
    manifest.artifacts.docx.sha256 = forgedHash;
    await writeFile(fixture.buildManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const geometry = JSON.parse(await readFile(fixture.geometryReportPath, "utf8")) as {
      docx: { sha256: string };
    };
    geometry.docx.sha256 = forgedHash;
    await writeFile(fixture.geometryReportPath, `${JSON.stringify(geometry, null, 2)}\n`, "utf8");

    const result = await auditDocxArtifacts(fixture);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_SOURCE_DOCX_GEOMETRY");
  });

  test("blocks a configured DOCX worker interpreter outside the supported Python range", async () => {
    const fixture = await docxFixture();
    const interpreter = join(dirname(fixture.docxPath), "unsupported-python");
    await writeFile(interpreter, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'Python 3.10.13'; exit 0; fi\nexec /usr/bin/python3 \"$@\"\n", "utf8");
    await chmod(interpreter, 0o755);

    const result = await auditDocxArtifacts({ ...fixture, workerPythonPath: interpreter });

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_SOURCE_DOCX_READ");
  });

  test("recomputes PDF, page image, and searchable Korean text lineage from real files", async () => {
    const fixture = await renderFixture();

    const passed = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });
    expect(passed.status).toBe("PASS");
    expect(passed.artifacts.map((artifact) => artifact.sha256)).toContain(await sha256File(fixture.pdfPath));

    await writeFile(fixture.pagePath, "stale-page", "utf8");
    const blocked = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.findings.map((finding) => finding.code)).toContain("KPP_DESIGN_SURFACE_LINEAGE");
  });

  test("blocks a corrupt PDF even when its manifest hash and byte count match", async () => {
    const fixture = await renderFixture();
    await writeFile(fixture.pdfPath, "%PDF-1.7 corrupt", "utf8");
    await rebindRenderArtifact(fixture.manifestPath, "pdf", fixture.pdfPath);

    const result = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_PDF_INVALID");
  });

  test("blocks a signature-only PNG page even when its manifest hash and byte count match", async () => {
    const fixture = await renderFixture();
    await writeFile(fixture.pagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await rebindRenderArtifact(fixture.manifestPath, "page", fixture.pagePath);

    const result = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_PAGE_IMAGES");
  });

  test("blocks a PNG page with a corrupt chunk CRC even when its manifest is rebound", async () => {
    const fixture = await renderFixture();
    const png = await readFile(fixture.pagePath);
    png[png.length - 1] = (png[png.length - 1] ?? 0) ^ 0xff;
    await writeFile(fixture.pagePath, png);
    await rebindRenderArtifact(fixture.manifestPath, "page", fixture.pagePath);

    const result = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_PAGE_IMAGES");
  });

  test("blocks CRC-valid PNG chunks with PLTE after IDAT even when its manifest is rebound", async () => {
    const fixture = await renderFixture();
    const png = await readFile(fixture.pagePath);
    const chunks = parsePngChunks(png);
    const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
    const idat = chunks.filter((chunk) => chunk.type === "IDAT");
    const iend = chunks.find((chunk) => chunk.type === "IEND");
    if (ihdr === undefined || idat.length === 0 || iend === undefined) {
      throw new Error("render fixture did not contain the expected PNG chunks");
    }
    const malformed = rebuildPng([
      ihdr,
      { type: "IDAT", data: Buffer.concat(idat.map((chunk) => chunk.data)) },
      { type: "PLTE", data: Buffer.from([0x00, 0x00, 0x00]) },
      iend,
    ]);
    await writeFile(fixture.pagePath, malformed);
    await rebindRenderArtifact(fixture.manifestPath, "page", fixture.pagePath);

    const result = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_PAGE_IMAGES");
  });

  test("blocks a CRC-valid PNG with empty IDAT even when its manifest is rebound", async () => {
    const fixture = await renderFixture();
    const png = await readFile(fixture.pagePath);
    const chunks = parsePngChunks(png);
    const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
    const iend = chunks.find((chunk) => chunk.type === "IEND");
    if (ihdr === undefined || iend === undefined) {
      throw new Error("render fixture did not contain the expected PNG chunks");
    }
    await writeFile(fixture.pagePath, rebuildPng([
      ihdr,
      { type: "IDAT", data: Buffer.alloc(0) },
      iend,
    ]));
    await rebindRenderArtifact(fixture.manifestPath, "page", fixture.pagePath);

    const result = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_PAGE_IMAGES");
  });

  test("blocks a manifest page count that differs from fixed pdfinfo", async () => {
    const fixture = await renderFixture();
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as {
      output: { pdf: { pages: number }; pages: Array<{ page: number; path: string; sha256: string; bytes: number }> };
    };
    const secondPage = join(fixture.pagePath, "..", "page-0002.png");
    await copyFile(fixture.pagePath, secondPage);
    manifest.output.pdf.pages = 2;
    manifest.output.pages.push({
      page: 2,
      path: secondPage,
      sha256: await sha256File(secondPage),
      bytes: (await stat(secondPage)).size,
    });
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = await auditRenderArtifacts(fixture.manifestPath, {
      trustedPdftotextPath: fixture.extractorPath,
      trustedPdfinfoPath: await resolveTool("pdfinfo"),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_PDF_INVALID");
  });

  test("does not execute a pdftotext path supplied only by an untrusted render manifest", async () => {
    const fixture = await renderFixture();
    const maliciousExtractor = join(dirname(fixture.manifestPath), "manifest-pdftotext");
    const sentinel = join(dirname(fixture.manifestPath), "extractor-executed");
    await writeFile(maliciousExtractor, `#!/bin/sh\ntouch '${sentinel}'\nprintf '검색 가능한 한글 본문\\n'\n`, "utf8");
    await chmod(maliciousExtractor, 0o755);
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as {
      executables: { pdftotext: { path: string } };
      searchableTextProof: { extractor: { path: string } };
    };
    manifest.executables.pdftotext.path = maliciousExtractor;
    manifest.searchableTextProof.extractor.path = maliciousExtractor;
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = await auditRenderArtifacts(fixture.manifestPath);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_EXTRACTOR_UNTRUSTED");
    await expect(readFile(sentinel, "utf8")).rejects.toBeDefined();
  });

  test("blocks a forged identity for the fixed pdftotext executable", async () => {
    const fixture = await renderFixture();
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as {
      executables: { pdftotext: { version: string } };
      searchableTextProof: { extractor: { version: string } };
    };
    manifest.executables.pdftotext.version = "forged pdftotext version";
    manifest.searchableTextProof.extractor.version = "forged pdftotext version";
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = await auditRenderArtifacts(fixture.manifestPath);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_EXTRACTOR_UNTRUSTED");
  });

  test("requires structural Gantt roles in the actual deterministic SVG", async () => {
    const fixture = await figureFixture();
    expect((await auditFigureArtifacts([fixture])).status).toBe("PASS");

    const svg = await readFile(fixture.svgPath, "utf8");
    await writeFile(fixture.svgPath, svg.replaceAll('data-kpp-role="duration-bar"', 'data-kpp-role="plain-box"'), "utf8");
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as Record<string, unknown>;
    const output = manifest.output as Record<string, unknown>;
    output.sha256 = await sha256File(fixture.svgPath);
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const blocked = await auditFigureArtifacts([fixture]);
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.findings.map((finding) => finding.code)).toContain("KPP_DESIGN_GANTT_STRUCTURE");
  });

  test("allows a rendered decorative figure with zero bindings to reach the zero-credit value gate", async () => {
    const root = await makeRoot("kpp-decorative-render-");
    const specPath = join(root, "decorative.spec.json");
    const svgPath = join(root, "decorative.svg");
    const manifestPath = join(root, "decorative.render.json");
    const decorative: GanttFigureSpec = {
      figureId: "FIG-DECORATIVE-RENDERED", family: "gantt", title: "장식용 구분 표지", caption: "그림 1. 장식용 구분 표지",
      evidenceIds: [], claimIds: [], inputKind: "semantic", tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
      semanticValueIntent: "decorative", decisionEffect: "", nonDuplicateOf: [], encodedVariables: [],
      data: {
        kind: "time_axis", periods: ["D1", "D2"],
        workPackages: [{ id: "WP-01", label: "구분", owner: "운영팀", start: 0, end: 1, evidenceIds: [] }],
        milestones: [{ id: "M-01", label: "구분", period: 1, owner: "운영팀", evidenceIds: [], acceptance: "장 구분" }],
      },
    };
    const rendered = await renderFigureArtifact(decorative);
    await Promise.all([
      writeFile(specPath, `${JSON.stringify(decorative)}\n`, "utf8"),
      writeFile(svgPath, rendered.svg, "utf8"),
      writeFile(manifestPath, `${JSON.stringify(rendered.manifest)}\n`, "utf8"),
    ]);

    expect((await auditFigureArtifacts([{ specPath, svgPath, manifestPath }])).status).toBe("PASS");
    expect(auditFigureSemanticValue([describeFigureSemanticValue(decorative)], []).findings.map(({ code }) => code))
      .toContain("KPP_FIGURE_VALUE_DECORATIVE");
  });

  test("blocks a stale predecessor receipt even when every receipt says PASS", async () => {
    const root = await renderedProjectFixture();
    const receipt = join(root, "receipts", "render.json");
    const parsed = JSON.parse(await readFile(receipt, "utf8")) as { inputReceiptHashes: string[] };
    parsed.inputReceiptHashes = ["0".repeat(64)];
    await writeFile(receipt, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const result = await auditReleaseReadiness(root);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RELEASE_RECEIPT_CHAIN");
  });

  test("writes a stable audit/audit.json that is bound to all real artifacts", async () => {
    const figure = await figureFixture();
    const docx = await docxFixture(figure);
    const render = await renderFixture(docx.docxPath);
    const architectureRoot = await makeRoot("kpp-stable-architecture-");
    const architecturePath = join(architectureRoot, "page-architecture.json");
    const authoringResponsePath = join(architectureRoot, "authoring-response.json");
    await writeFile(architecturePath, `${JSON.stringify(singlePageArchitecture(false), null, 2)}\n`);
    await writeFile(authoringResponsePath, `${JSON.stringify({
      schemaVersion: "1.0.0",
      blocks: [{
        pageId: "BLK-SCHEDULE-NARRATIVE", claimIds: ["CL-1"], evidenceIds: ["EV-1"], status: "provisional",
        text: "일정의 근거는 별도 표에서 검토한다.", evaluatorAnswer: "일정 관문을 확인한다.", pendingBlankFieldIds: [],
      }],
    }, null, 2)}\n`);
    const boundManifest = JSON.parse(await readFile(docx.buildManifestPath, "utf8")) as Record<string, unknown>;
    boundManifest.inputs = {
      ...((boundManifest.inputs as Record<string, unknown> | undefined) ?? {}),
      pageArchitectureSha256: await sha256File(architecturePath),
    };
    await writeFile(docx.buildManifestPath, `${JSON.stringify(boundManifest, null, 2)}\n`);
    const root = await renderedProjectFixture({
      built: [docx.buildManifestPath, docx.docxPath],
      rendered: [render.manifestPath, render.pdfPath, render.pagePath],
    });
    const outputPath = join(root, "audit", "audit.json");

    const first = await auditProposal({
      root,
      docx,
      pageArchitecturePath: architecturePath,
      renderManifestPath: render.manifestPath,
      trustedPdftotextPath: render.extractorPath,
      figures: [figure],
      authoringResponsePath,
      outputPath,
    });
    const firstBytes = await readFile(outputPath, "utf8");
    const second = await auditProposal({
      root,
      docx,
      pageArchitecturePath: architecturePath,
      renderManifestPath: render.manifestPath,
      trustedPdftotextPath: render.extractorPath,
      figures: [figure],
      authoringResponsePath,
      outputPath,
    });

    expect(first.status, JSON.stringify(first.findings)).toBe("PASS");
    expect(second).toEqual(first);
    expect(await readFile(outputPath, "utf8")).toBe(firstBytes);
    expect(first.artifacts.every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.sha256))).toBe(true);
  }, 60_000);

  test("blocks a proposal whose valid receipt chain binds only unrelated placeholders", async () => {
    const docx = await docxFixture();
    const render = await renderFixture(docx.docxPath);
    const figure = await figureFixture();
    const root = await renderedProjectFixture();

    const report = await auditProposal({
      root,
      docx,
      renderManifestPath: render.manifestPath,
      trustedPdftotextPath: render.extractorPath,
      figures: [figure],
      outputPath: join(root, "audit", "audit.json"),
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings.map((finding) => finding.code)).toContain("KPP_RELEASE_RECEIPT_BINDING");
  }, 60_000);

  test("blocks when the rendered PDF was produced from a different DOCX", async () => {
    const docx = await docxFixture();
    const render = await renderFixture();
    const figure = await figureFixture();
    const root = await renderedProjectFixture();

    const report = await auditProposal({
      root,
      docx,
      renderManifestPath: render.manifestPath,
      trustedPdftotextPath: render.extractorPath,
      figures: [figure],
      outputPath: join(root, "audit", "audit.json"),
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings.map((finding) => finding.code)).toContain("KPP_DESIGN_SURFACE_LINEAGE");
  }, 60_000);

  test("composes measured title hierarchy into the proposal audit blocker", async () => {
    const docx = await docxFixture();
    const render = await renderFixture(docx.docxPath);
    const architectureRoot = await makeRoot("kpp-architecture-audit-");
    const architecturePath = join(architectureRoot, "page-architecture.json");
    await writeFile(architecturePath, `${JSON.stringify({
      schemaVersion: "2.0.0",
      projectId: "rendered-architecture-fixture",
      documentMode: "private_partnership",
      modePolicyVersion: "1.0.0",
      architectureStatus: "staged",
      chapters: [{ chapterId: "CH-01" }],
      sections: [{ sectionId: "SEC-01", chapterId: "CH-01" }],
      pages: [{
        pageId: "P-01", chapterId: "CH-01", sectionId: "SEC-01",
        pageRole: "operating_model", surfaceTemplateId: "operating_model",
        titleScope: "section", titlePointSize: 16, continuation: true,
        dominantSurface: "narrative", surfaceVisibility: "internal",
        claimIds: [], proofIds: [], referenceIds: [], figureIds: [],
        continuityFromPageId: "P-00",
      }],
    }, null, 2)}\n`);
    const buildManifest = JSON.parse(await readFile(docx.buildManifestPath, "utf8")) as Record<string, unknown>;
    buildManifest.inputs = {
      ...((buildManifest.inputs as Record<string, unknown> | undefined) ?? {}),
      pageArchitectureSha256: await sha256File(architecturePath),
    };
    await writeFile(docx.buildManifestPath, `${JSON.stringify(buildManifest, null, 2)}\n`);
    const root = await renderedProjectFixture({
      built: [docx.buildManifestPath, docx.docxPath],
      rendered: [render.manifestPath, render.pdfPath, render.pagePath],
    });

    const report = await auditProposal({
      root,
      docx,
      pageArchitecturePath: architecturePath,
      renderManifestPath: render.manifestPath,
      trustedPdftotextPath: render.extractorPath,
      figures: [],
      outputPath: join(root, "audit", "architecture-blocked.json"),
    });

    expect(report.findings.map((finding) => finding.code), JSON.stringify(report.findings)).toContain("KPP_PAGE_CONTINUATION_UNOBSERVED");
    expect(report.artifacts.map((artifact) => artifact.path)).toContain(architecturePath);
  }, 60_000);
});

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function singlePageArchitecture(continuation: boolean): Record<string, unknown> {
  return {
    schemaVersion: "2.0.0",
    projectId: "rendered-architecture-fixture",
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    architectureStatus: "staged",
    chapters: [{ chapterId: "CH-01" }],
    sections: [{ sectionId: "SEC-01", chapterId: "CH-01" }],
    pages: [{
      pageId: "P-01", chapterId: "CH-01", sectionId: "SEC-01",
      pageRole: "operating_model", surfaceTemplateId: "operating_model",
      titleScope: "section", titlePointSize: 12, continuation,
      dominantSurface: "narrative", surfaceVisibility: "internal",
      claimIds: [], proofIds: [], referenceIds: [], figureIds: [],
      ...(continuation ? { continuityFromPageId: "P-00" } : {}),
    }],
  };
}

async function docxFixture(figure?: {
  readonly figureId: string;
  readonly rasterPath: string;
}): Promise<{
  readonly docxPath: string;
  readonly buildManifestPath: string;
  readonly geometryReportPath: string;
}> {
  const root = await makeRoot("kpp-audit-docx-");
  const docxPath = join(root, "document.docx");
  const buildManifestPath = join(root, "manifest.json");
  const geometryReportPath = join(root, "geometry.json");
  const figurePath = join(root, "figure.png");
  const packageRoot = join(root, "ooxml");
  await mkdir(join(packageRoot, "word", "_rels"), { recursive: true });
  await mkdir(join(packageRoot, "word", "media"), { recursive: true });
  await mkdir(join(packageRoot, "_rels"), { recursive: true });
  await writeFile(join(packageRoot, "[Content_Types].xml"), validContentTypesXml(), "utf8");
  await writeFile(join(packageRoot, "_rels", ".rels"), validPackageRelationshipsXml(), "utf8");
  await writeFile(join(packageRoot, "word", "document.xml"), validDocumentXml(), "utf8");
  await writeFile(join(packageRoot, "word", "styles.xml"), validStylesXml(), "utf8");
  await writeFile(join(packageRoot, "word", "_rels", "document.xml.rels"), validRelationshipsXml(), "utf8");
  const png = figure === undefined
    ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    : await readFile(figure.rasterPath);
  await writeFile(join(packageRoot, "word", "media", "image1.png"), png);
  await executeFile("/usr/bin/zip", ["-q", "-r", docxPath, "[Content_Types].xml", "_rels", "word"], { cwd: packageRoot });
  await writeFile(figurePath, png);
  const docxSha256 = await sha256File(docxPath);
  const profileSha256 = "1".repeat(64);
  await writeFile(buildManifestPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    profile: { profileId: "R08", status: "locked", sha256: profileSha256 },
    styles: {
      heading: { font: "Noto Sans CJK KR" },
      navigation: { font: "Noto Sans CJK KR" },
      body: {
        font: "Noto Serif CJK KR",
        ooxmlHalfPoints: 19,
        lineDxa: 365,
        alignment: "justified",
        characterSpacingTwips: 0,
      },
    },
    tables: [{ tableId: "T-1", native: true }],
    figures: [{
      figureId: figure?.figureId ?? "FIG-1",
      path: figurePath,
      sha256: await sha256File(figurePath),
      embedded: true,
      format: "png",
      renderer: "svg-gantt",
      claimIds: ["CL-1"],
      evidenceIds: ["EV-1"],
    }],
    artifacts: { docx: { path: docxPath, sha256: docxSha256 } },
  }, null, 2)}\n`, "utf8");
  const geometry = await executeFile(
    resolve("workers/docx-python/.venv/bin/python"),
    [resolve("workers/docx-python/src/kpp_docx/audit_geometry.py"), docxPath, "--profile-sha256", profileSha256],
  );
  await writeFile(geometryReportPath, geometry.stdout, "utf8");
  return { docxPath, buildManifestPath, geometryReportPath };
}

async function renderFixture(docxInput?: string): Promise<{
  readonly manifestPath: string;
  readonly pdfPath: string;
  readonly pagePath: string;
  readonly extractorPath: string;
}> {
  const root = await makeRoot("kpp-audit-render-");
  const docxPath = docxInput ?? join(root, "document.docx");
  const pdfPath = join(root, "proposal.pdf");
  const pagePath = join(root, "page-0001.png");
  const manifestPath = join(root, "render.json");
  const soffice = await resolveTool("soffice");
  const pdftoppm = await resolveTool("pdftoppm");
  const pdftotext = await resolveTool("pdftotext");
  const pdfinfo = await resolveTool("pdfinfo");
  if (docxInput === undefined) {
    const docx = await docxFixture();
    await copyFile(docx.docxPath, docxPath);
  }
  const profile = join(root, "libreoffice-profile");
  await mkdir(profile);
  await executeFile(soffice, [
    `-env:UserInstallation=file://${profile}`,
    "--headless",
    "--convert-to",
    "pdf:writer_pdf_Export",
    "--outdir",
    root,
    docxPath,
  ]);
  const converted = join(root, `${docxPath.split("/").at(-1)?.replace(/\.docx$/u, "")}.pdf`);
  if (converted !== pdfPath) await rename(converted, pdfPath);
  await executeFile(pdftoppm, ["-f", "1", "-singlefile", "-png", pdfPath, join(root, "page-0001")]);
  const extracted = await executeFile(pdftotext, [pdfPath, "-"]);
  const searchableText = extracted.stdout.normalize("NFC").trim();
  const pdfInfoResult = await executeFile(pdfinfo, [pdfPath]);
  const pageCount = Number(/^Pages:\s+(\d+)$/mu.exec(pdfInfoResult.stdout)?.[1]);
  const pdfBytes = (await stat(pdfPath)).size;
  const pageBytes = (await stat(pagePath)).size;
  const extractorPath = pdftotext;
  const extractorIdentity = await executeFile(extractorPath, ["-v"]);
  const extractorVersion = `${extractorIdentity.stdout}${extractorIdentity.stderr}`.trim();
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    rendererVersion: "0.1.0",
    input: { docx: { path: docxPath, sha256: await sha256File(docxPath) } },
    output: {
      pdf: { path: pdfPath, sha256: await sha256File(pdfPath), bytes: pdfBytes, pages: pageCount },
      pages: [{ page: 1, path: pagePath, sha256: await sha256File(pagePath), bytes: pageBytes }],
    },
    executables: { pdftotext: { path: extractorPath, version: extractorVersion } },
    searchableTextProof: {
      extractor: { path: extractorPath, version: extractorVersion },
      textSha256: sha256(searchableText),
      nonWhitespaceCodePointCount: [...searchableText].filter((character) => !/\s/u.test(character)).length,
      hangulCodePointCount: [...searchableText].filter((character) => /[\uAC00-\uD7A3]/u.test(character)).length,
    },
  }, null, 2)}\n`, "utf8");
  return { manifestPath, pdfPath, pagePath, extractorPath };
}

async function rebindRenderArtifact(manifestPath: string, kind: "pdf" | "page", path: string): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    output: {
      pdf: { sha256: string; bytes: number };
      pages: Array<{ sha256: string; bytes: number }>;
    };
  };
  const record = kind === "pdf" ? manifest.output.pdf : manifest.output.pages[0];
  if (record === undefined) throw new Error("missing render artifact record");
  record.sha256 = await sha256File(path);
  record.bytes = (await stat(path)).size;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function validDocumentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="KPPBody"/><w:jc w:val="both"/><w:spacing w:line="365" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Serif CJK KR" w:hAnsi="Noto Serif CJK KR" w:eastAsia="Noto Serif CJK KR" w:cs="Noto Serif CJK KR"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:spacing w:val="-4"/></w:rPr><w:t>검색 가능한 한글 본문</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="KPPCaption"/></w:pPr><w:r><w:t>표 1. 연구 결과</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="KPPCaption"/></w:pPr><w:r><w:t>그림 1. 연구 구조</w:t></w:r></w:p>
<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>
<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:start w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="7200"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="7200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>검증 표</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`;
}

function validStylesXml(): string {
  const style = (id: string, font: string, size: string, spacing = "") => `<w:style w:type="paragraph" w:styleId="${id}"><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${spacing}</w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${style("KPPBody", "Noto Serif CJK KR", "19", '<w:spacing w:val="-4"/>')}${style("KPPHeading1", "Noto Sans CJK KR", "32")}${style("KPPNavigation", "Noto Sans CJK KR", "18")}${style("KPPCaption", "Noto Sans CJK KR", "18")}${style("KPPTableHeader", "Noto Sans CJK KR", "18")}${style("KPPTableBody", "Noto Serif CJK KR", "18", '<w:spacing w:val="-4"/>')}</w:styles>`;
}

function validRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;
}

function validContentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
}

function validPackageRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
}

async function figureFixture(): Promise<{
  readonly specPath: string;
  readonly svgPath: string;
  readonly manifestPath: string;
  readonly figureId: string;
  readonly rasterPath: string;
}> {
  const root = await makeRoot("kpp-audit-figure-");
  const specPath = join(root, "figure-spec.json");
  const svgPath = join(root, "figure.svg");
  const manifestPath = join(root, "figure-manifest.json");
  const figure: GanttFigureSpec = {
    figureId: "FIG-GANTT-AUDIT",
    title: "100일 수행계획",
    caption: "그림 1. 수행계획과 마일스톤",
    evidenceIds: ["EV-1"],
    claimIds: ["CL-1"],
    inputKind: "semantic",
    tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: "operational_control",
    decisionEffect: "수행 일정의 담당자와 승인 관문을 확정한다.",
    nonDuplicateOf: ["BLK-SCHEDULE-NARRATIVE"],
    encodedVariables: ["owner", "timing", "acceptance"],
    family: "gantt",
    data: {
      kind: "time_axis",
      periods: ["D1", "D50", "D100"],
      workPackages: [{ id: "WP1", label: "착수", owner: "연구책임자", start: 0, end: 1, evidenceIds: ["EV-1"] }],
      milestones: [{ id: "M1", label: "착수보고", period: 1, owner: "연구책임자", evidenceIds: ["EV-1"], acceptance: "승인" }],
    },
  };
  const artifact = await renderFigureArtifact(figure);
  await writeFile(specPath, `${JSON.stringify(figure, null, 2)}\n`, "utf8");
  await writeFile(svgPath, artifact.svg, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(artifact.manifest, null, 2)}\n`, "utf8");
  const profile = await mkdtemp(join(tmpdir(), "kpp-audit-figure-profile-"));
  const soffice = await resolveTool("soffice");
  try {
    await executeFile(soffice, [
      `-env:UserInstallation=file://${profile}`,
      "--headless",
      "--convert-to",
      "png:draw_png_Export",
      "--outdir",
      root,
      svgPath,
    ]);
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(profile, { recursive: true, force: true });
  }
  const rasterPath = join(root, "figure.png");
  return { specPath, svgPath, manifestPath, figureId: figure.figureId, rasterPath };
}

async function renderedProjectFixture(bindings?: {
  readonly built: readonly string[];
  readonly rendered: readonly string[];
}): Promise<string> {
  const root = await makeRoot("kpp-audit-project-");
  await initializeProject(root, { projectId: "audit-project" });
  const stages = [
    ["SOURCE_LOCKED", "source-lock.json"],
    ["REQUIREMENTS_LOCKED", "requirements-lock.json"],
    ["EVIDENCE_LOCKED", "evidence-lock.json"],
    ["DESIGN_LOCKED", "design-lock.json"],
    ["CONTENT_APPROVED", "content-approval.json"],
    ["BUILT", "build.json"],
    ["RENDERED", "render.json"],
  ] as const;
  let predecessor: string | undefined;
  for (const [stage, filename] of stages) {
    const artifact = join(root, stage.toLowerCase(), "artifact.txt");
    await mkdir(join(root, stage.toLowerCase()), { recursive: true });
    await writeFile(artifact, stage, "utf8");
    const receipt = join(root, "receipts", filename);
    await writeReceipt({
      stage,
      files: stage === "BUILT"
        ? bindings?.built ?? [artifact]
        : stage === "RENDERED"
          ? bindings?.rendered ?? [artifact]
          : [artifact],
      inputReceiptHashes: predecessor === undefined ? [] : [predecessor],
      output: receipt,
    });
    await advanceProject(root, stage);
    predecessor = await sha256File(receipt);
  }
  return root;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePngChunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    chunks.push({ type, data: png.subarray(dataStart, dataStart + length) });
    offset = dataStart + length + 4;
  }
  return chunks;
}

function rebuildPng(chunks: readonly { type: string; data: Buffer }[]): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ...chunks.map(({ type, data }) => {
    const typeBytes = Buffer.from(type, "ascii");
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return chunk;
  })]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
