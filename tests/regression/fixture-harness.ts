import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { advanceProject, executeFile, initializeProject, sha256File, writeReceipt } from "@longtable/kpp-core";
import { R08_TOKEN_PROFILE_SHA256, renderFigureArtifact, type GanttFigureSpec } from "@longtable/kpp-renderers";
import { resolveTool } from "../support/tool-paths.js";

const roots: string[] = [];
const fixtureRoot = resolve("fixtures");
const python = resolve("workers/docx-python/.venv/bin/python");
const geometryWorker = resolve("workers/docx-python/src/kpp_docx/audit_geometry.py");

export interface ProposalFixture {
  readonly root: string;
  readonly docxPath: string;
  readonly buildManifestPath: string;
  readonly geometryReportPath: string;
  readonly pageArchitecturePath: string;
  readonly referenceManifestPath: string;
  readonly renderManifestPath: string;
  readonly pdfPath: string;
  readonly pagePath: string;
  readonly extractorPath: string;
  readonly figure: { readonly specPath: string; readonly svgPath: string; readonly manifestPath: string };
  /** Synthetic CONTENT_APPROVED artifact for nonDuplicateOf prose checks. */
  readonly authoringResponsePath: string;
}

export async function materializeR08Reference(): Promise<ProposalFixture> {
  return materialize("valid/r08-reference", "r08-reference");
}

export async function materializeC11KnownBad(): Promise<ProposalFixture> {
  return materialize("known-bad/c11", "c11-known-bad");
}

export async function cleanupFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function rebindFigureOutputHash(path: string, svgPath: string): Promise<void> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as { output: { sha256: string } };
  manifest.output.sha256 = await sha256File(svgPath);
  await writeJson(path, manifest);
}

export async function rebindDocxHash(path: string, docxPath: string): Promise<void> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as { artifacts: { docx: { sha256: string } } };
  manifest.artifacts.docx.sha256 = await sha256File(docxPath);
  await writeJson(path, manifest);
}

export async function mutateTableMargin(docxPath: string): Promise<void> {
  const unpacked = await mkdtemp(join(tmpdir(), "kpp-r08-docx-mutation-"));
  roots.push(unpacked);
  await executeFile("/usr/bin/unzip", ["-q", docxPath, "-d", unpacked]);
  const documentPath = join(unpacked, "word", "document.xml");
  const document = await readFile(documentPath, "utf8");
  await writeFile(documentPath, document.replace(/<w:top\b[^>]*\/>/u, ""), "utf8");
  await rm(docxPath, { force: true });
  await executeFile("/usr/bin/zip", ["-q", "-r", docxPath, "[Content_Types].xml", "_rels", "word"], { cwd: unpacked });
}

export async function runGeometry(docxPath: string, profileSha256 = "1".repeat(64)): Promise<{ findings: Array<{ code: string }> }> {
  const result = await executeFile(python, [geometryWorker, docxPath, "--profile-sha256", profileSha256]);
  return JSON.parse(result.stdout) as { findings: Array<{ code: string }> };
}

export async function readEmbeddedDocxMedia(docxPath: string): Promise<Buffer> {
  const unpacked = await mkdtemp(join(tmpdir(), "kpp-r08-docx-media-"));
  roots.push(unpacked);
  await executeFile("/usr/bin/unzip", ["-q", docxPath, "word/media/image1.png", "-d", unpacked]);
  return readFile(join(unpacked, "word", "media", "image1.png"));
}

interface KnownBadLineage {
  readonly classification: "project_only";
  readonly failureBoundary: readonly ("stale_surface_lineage" | "generic_box_schedule" | "invalid_docx_geometry")[];
}

async function materialize(relativeFixture: string, prefix: string): Promise<ProposalFixture> {
  const root = await mkdtemp(join(tmpdir(), `kpp-${prefix}-`));
  roots.push(root);
  const copied = join(root, "fixture");
  await cp(join(fixtureRoot, relativeFixture), copied, { recursive: true, force: false });
  const lineage = await readKnownBadLineage(copied);
  const hasBoundary = (boundary: KnownBadLineage["failureBoundary"][number]) => lineage?.failureBoundary.includes(boundary) ?? false;
  const docxPath = join(copied, "docx", "proposal.docx");
  const profileSha256 = "1".repeat(64);
  const figure = await buildFigure(copied, hasBoundary("generic_box_schedule"));
  // Keep the supplied synthetic reference as a visual-reference-only asset. The
  // actual DOCX drawing must use the governed rasterization of the semantic
  // SVG, otherwise the always-on figure/media lineage audit must (correctly)
  // reject this sanitized fixture.
  const figureSource = join(copied, "ooxml", "word", "media", "image1.png");
  const visualReference = join(copied, "ooxml", "word", "media", "visual-reference.png");
  if (await stat(figureSource).then(() => true).catch(() => false)) {
    await copyFile(figureSource, visualReference);
    await rasterizeSvgToDocxMedia(figure.svgPath, figureSource);
  }
  await buildDocx(copied, docxPath);
  const buildManifestPath = join(copied, "docx", "build.json");
  await writeJson(buildManifestPath, {
    schemaVersion: "1.0.0",
    profile: {
      profileId: "R08",
      status: lineage?.classification === "project_only" && hasBoundary("stale_surface_lineage") ? "stale" : "locked",
      sha256: profileSha256,
    },
    styles: hasBoundary("invalid_docx_geometry") ? {} : {
      heading: { font: "Noto Sans CJK KR" },
      navigation: { font: "Noto Sans CJK KR" },
      body: { font: "Noto Serif CJK KR", ooxmlHalfPoints: 19, lineDxa: 365, alignment: "justified", characterSpacingTwips: 0 },
    },
    tables: hasBoundary("invalid_docx_geometry") ? [] : [{ tableId: "T-R08", native: true }],
    figures: hasBoundary("invalid_docx_geometry") ? [] : [{
      figureId: "FIG-R08-GANTT",
      path: figureSource,
      sha256: await sha256File(figureSource),
      embedded: true,
      format: "png",
      renderer: "svg-gantt",
      claimIds: ["CL-R08-METHOD"],
      evidenceIds: ["EV-R08-METHOD"],
    }],
    artifacts: { docx: { path: docxPath, sha256: await sha256File(docxPath) } },
  });
  const geometryReportPath = join(copied, "docx", "geometry.json");
  const geometry = await executeFile(python, [geometryWorker, docxPath, "--profile-sha256", profileSha256]);
  await writeFile(geometryReportPath, geometry.stdout, "utf8");
  const geometryReport = JSON.parse(geometry.stdout) as { pageObservations: Array<{ measuredHeadingPointSizes: number[] }> };
  const pageArchitecturePath = join(copied, "docx", "page-architecture.json");
  const architecturePages = geometryReport.pageObservations.map((observation, index, pages) => ({
    pageId: `P-${String(index + 1).padStart(2, "0")}`,
    chapterId: "CH-01",
    sectionId: `SEC-${String(index + 1).padStart(2, "0")}`,
    pageRole: "procurement_evaluation_crosswalk",
    surfaceTemplateId: "source_output_comparison",
    titleScope: index === 0 ? "chapter" : "section",
    titlePointSize: Math.max(12, ...observation.measuredHeadingPointSizes),
    continuation: index > 0,
    dominantSurface: "mixed",
    surfaceVisibility: "internal",
    claimIds: [], proofIds: [], referenceIds: [], figureIds: [],
    ...(index > 0 ? { continuityFromPageId: `P-${String(index).padStart(2, "0")}` } : {}),
    ...(index < pages.length - 1 ? { continuityToPageId: `P-${String(index + 2).padStart(2, "0")}` } : {}),
  }));
  await writeJson(pageArchitecturePath, {
    schemaVersion: "2.0.0",
    projectId: "sanitized-r08-regression",
    documentMode: "public_procurement",
    modePolicyVersion: "1.0.0",
    architectureStatus: "complete",
    chapters: [{ chapterId: "CH-01" }],
    sections: architecturePages.map((page) => ({ sectionId: page.sectionId, chapterId: "CH-01" })),
    pages: architecturePages,
  });
  const referenceManifestPath = join(copied, "evidence", "reference-manifest.json");
  const evidenceLedgerPath = join(root, "project", "evidence", "evidence-ledger.json");
  await writeJson(referenceManifestPath, {
    schemaVersion: "2.0.0",
    projectId: "sanitized-r08-regression",
    documentMode: "public_procurement",
    modePolicyVersion: "1.0.0",
    references: [],
  });
  await writeJson(evidenceLedgerPath, { schemaVersion: "1.0.0", claims: [], bindings: [] });
  const buildManifest = JSON.parse(await readFile(buildManifestPath, "utf8")) as Record<string, unknown>;
  buildManifest.inputs = {
    ...((buildManifest.inputs as Record<string, unknown> | undefined) ?? {}),
    pageArchitectureSha256: await sha256File(pageArchitecturePath),
    referenceManifestSha256: await sha256File(referenceManifestPath),
  };
  await writeJson(buildManifestPath, buildManifest);
  const render = await renderDocx(copied, docxPath);
  const authoringResponsePath = join(root, "project", "content", "authoring-response.json");
  await makeRenderedProject(
    root,
    [buildManifestPath, docxPath],
    [render.renderManifestPath, render.pdfPath, render.pagePath],
    authoringResponsePath,
    pageArchitecturePath,
    referenceManifestPath,
  );
  return { root, docxPath, buildManifestPath, geometryReportPath, pageArchitecturePath, referenceManifestPath, ...render, figure, authoringResponsePath };
}

async function buildDocx(copied: string, docxPath: string): Promise<void> {
  const source = join(copied, "ooxml");
  await mkdir(dirname(docxPath), { recursive: true });
  await rm(docxPath, { force: true });
  await executeFile("/usr/bin/zip", ["-q", "-r", docxPath, "[Content_Types].xml", "_rels", "word"], { cwd: source });
}

async function buildFigure(copied: string, genericBoxes: boolean): Promise<ProposalFixture["figure"]> {
  const specPath = join(copied, "figures", "gantt-spec.json");
  const svgPath = join(copied, "figures", "gantt.svg");
  const manifestPath = join(copied, "figures", "gantt.manifest.json");
  const base = JSON.parse(await readFile(specPath, "utf8")) as Omit<GanttFigureSpec, "tokenProfileHash">;
  const spec: GanttFigureSpec = { ...base, tokenProfileHash: R08_TOKEN_PROFILE_SHA256 };
  await writeJson(specPath, spec);
  const artifact = await renderFigureArtifact(spec);
  await writeFile(svgPath, genericBoxes
    ? artifact.svg.replaceAll('data-kpp-role="duration-bar"', 'data-kpp-role="plain-box"')
      .replaceAll('data-kpp-role="milestone"', 'data-kpp-role="plain-box"')
    : artifact.svg, "utf8");
  await writeJson(manifestPath, artifact.manifest);
  return { specPath, svgPath, manifestPath };
}

async function readKnownBadLineage(copied: string): Promise<KnownBadLineage | undefined> {
  const path = join(copied, "c11-lineage.json");
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("C11 lineage must be an object");
    const record = value as Record<string, unknown>;
    if (record.classification !== "project_only" || !Array.isArray(record.failureBoundary)) {
      throw new Error("C11 lineage must declare project_only classification and failureBoundary");
    }
    const boundaries = record.failureBoundary;
    if (!boundaries.every((boundary) => boundary === "stale_surface_lineage" || boundary === "generic_box_schedule" || boundary === "invalid_docx_geometry")) {
      throw new Error("C11 lineage has an unsupported failure boundary");
    }
    return { classification: "project_only", failureBoundary: boundaries };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function rasterizeSvgToDocxMedia(svgPath: string, destination: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "kpp-r08-figure-raster-"));
  roots.push(root);
  const profile = join(root, "libreoffice-profile");
  const soffice = await resolveTool("soffice");
  await mkdir(profile);
  await executeFile(soffice, [
    `-env:UserInstallation=${pathToFileURL(profile).href}`,
    "--headless",
    "--convert-to",
    "png:draw_png_Export",
    "--outdir",
    root,
    svgPath,
  ], { timeoutMs: 120_000 });
  const generated = join(root, `${svgPath.slice(svgPath.lastIndexOf("/") + 1, svgPath.lastIndexOf("."))}.png`);
  await rename(generated, destination);
}

async function renderDocx(copied: string, docxPath: string): Promise<Pick<ProposalFixture, "renderManifestPath" | "pdfPath" | "pagePath" | "extractorPath">> {
  const renderRoot = join(copied, "render");
  await mkdir(renderRoot, { recursive: true });
  const profile = join(renderRoot, "libreoffice-profile");
  const soffice = await resolveTool("soffice");
  const pdftoppm = await resolveTool("pdftoppm");
  const pdftotext = await resolveTool("pdftotext");
  const pdfinfo = await resolveTool("pdfinfo");
  await mkdir(profile);
  await executeFile(soffice, [
    `-env:UserInstallation=file://${profile}`, "--headless", "--convert-to", "pdf:writer_pdf_Export", "--outdir", renderRoot, docxPath,
  ]);
  const converted = join(renderRoot, "proposal.pdf");
  const pdfPath = converted;
  const pagePath = join(renderRoot, "page-0001.png");
  await executeFile(pdftoppm, ["-f", "1", "-singlefile", "-png", pdfPath, join(renderRoot, "page-0001")]);
  const extractorPath = pdftotext;
  const extracted = await executeFile(extractorPath, [pdfPath, "-"]);
  const text = extracted.stdout.normalize("NFC").trim();
  const identity = await executeFile(extractorPath, ["-v"]);
  const version = `${identity.stdout}${identity.stderr}`.trim();
  const info = await executeFile(pdfinfo, [pdfPath]);
  const pages = Number(/^Pages:\s+(\d+)$/mu.exec(info.stdout)?.[1]);
  const renderManifestPath = join(renderRoot, "render.json");
  await writeJson(renderManifestPath, {
    schemaVersion: "1.0.0",
    input: { docx: { path: docxPath, sha256: await sha256File(docxPath) } },
    output: {
      pdf: { path: pdfPath, sha256: await sha256File(pdfPath), bytes: (await stat(pdfPath)).size, pages },
      pages: [{ page: 1, path: pagePath, sha256: await sha256File(pagePath), bytes: (await stat(pagePath)).size }],
    },
    executables: { pdftotext: { path: extractorPath, version } },
    searchableTextProof: {
      extractor: { path: extractorPath, version },
      textSha256: createHash("sha256").update(text, "utf8").digest("hex"),
      nonWhitespaceCodePointCount: [...text].filter((character) => !/\s/u.test(character)).length,
      hangulCodePointCount: [...text].filter((character) => /[\uAC00-\uD7A3]/u.test(character)).length,
    },
  });
  return { renderManifestPath, pdfPath, pagePath, extractorPath };
}

async function makeRenderedProject(
  root: string,
  built: readonly string[],
  rendered: readonly string[],
  authoringResponsePath: string,
  pageArchitecturePath: string,
  referenceManifestPath: string,
): Promise<void> {
  const project = join(root, "project");
  await initializeProject(project, { projectId: "sanitized-r08-regression" });
  await writeJson(authoringResponsePath, {
    schemaVersion: "1.0.0",
    blocks: [{
      pageId: "BLK-R08-SCHEDULE-NARRATIVE",
      claimIds: ["CL-R08-METHOD"],
      evidenceIds: ["EV-R08-METHOD"],
      status: "provisional",
      text: "일정의 세부 근거와 검토 순서는 본문에서 함께 확인한다.",
      evaluatorAnswer: "일정 관문을 확인한다.",
      pendingBlankFieldIds: [],
    }],
  });
  const stages = [
    ["SOURCE_LOCKED", "source-lock.json"], ["REQUIREMENTS_LOCKED", "requirements-lock.json"], ["EVIDENCE_LOCKED", "evidence-lock.json"],
    ["DESIGN_LOCKED", "design-lock.json"], ["CONTENT_APPROVED", "content-approval.json"], ["BUILT", "build.json"], ["RENDERED", "render.json"],
  ] as const;
  let predecessor: string | undefined;
  for (const [stage, filename] of stages) {
    const marker = join(project, stage.toLowerCase(), "artifact.txt");
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, stage, "utf8");
    const receipt = join(project, "receipts", filename);
    await writeReceipt({
      stage,
      files: stage === "BUILT"
        ? built
        : stage === "RENDERED"
          ? rendered
          : stage === "CONTENT_APPROVED"
            ? [marker, authoringResponsePath]
            : stage === "EVIDENCE_LOCKED"
              ? [marker, pageArchitecturePath, referenceManifestPath]
            : [marker],
      inputReceiptHashes: predecessor === undefined ? [] : [predecessor],
      output: receipt,
    });
    await advanceProject(project, stage);
    predecessor = await sha256File(receipt);
  }
  await writeFile(join(root, "project-path.txt"), project, "utf8");
}

export async function projectPath(fixture: ProposalFixture): Promise<string> {
  return (await readFile(join(fixture.root, "project-path.txt"), "utf8")).trim();
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
