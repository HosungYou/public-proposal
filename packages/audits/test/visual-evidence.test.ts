import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReceipt } from "@longtable/kpp-core";
import {
  KPP_FINAL_RENDERER_NAME,
  KPP_FINAL_RENDERER_VERSION,
  R08_TOKEN_PROFILE,
  R08_TOKEN_PROFILE_SHA256,
  VISUAL_EVIDENCE_FONT_PROFILE,
  VISUAL_EVIDENCE_FONT_PROFILE_SHA256,
  VISUAL_EVIDENCE_RENDERER_VERSION,
  canonicalFigureInputsJson,
  compileFigure,
  renderFigureA4Page,
  type FigureA4Context,
  type FigureA4PageArtifact,
  type FigureA4PageFixture,
  type GovernedFigureReference,
  type HumanFigureReview,
  type SemanticFigureSpecV1_1,
  type VisualEvidenceData,
  type VisualEvidenceFigureArtifact,
} from "@longtable/kpp-renderers";
import { auditFigureSemantics, type FigureSemanticAuditInput } from "../src/index.js";

const SOURCE_SHA = "1".repeat(64);
const REFERENCE_SHA = "2".repeat(64);

const validSpec: SemanticFigureSpecV1_1 = {
  schemaVersion: "semantic-figure-spec/v1.1",
  figureId: "FIG-TREND-001",
  requirementIds: ["REQ-001"],
  analyticalQuestion: "최근 8개 분기의 처리량은 어떻게 변했는가?",
  readerTask: "분기별 변화와 전환점을 확인한다.",
  supportedTakeaway: "최근 8개 분기의 처리량이 점진적으로 증가했다.",
  dataIds: ["DATA-TREND-001"],
  evidenceIds: ["EV-001"],
  relationship: "trend",
  minimumDataConditions: { minimumTemporalObservations: 8 },
  uncertainty: ["분기 집계치는 월별 변동을 표시하지 않는다."],
  sourceCaption: { text: "출처: 공개 통계", sourceIds: ["SRC-001"] },
  targetSurface: "A4_DOCX",
  referenceFamily: "line",
  rendererVersion: VISUAL_EVIDENCE_RENDERER_VERSION,
  rendererFingerprint: {
    renderer: { name: "@longtable/kpp-renderers", version: VISUAL_EVIDENCE_RENDERER_VERSION },
    tokenProfile: { id: R08_TOKEN_PROFILE, sha256: R08_TOKEN_PROFILE_SHA256 },
    fontProfile: { id: VISUAL_EVIDENCE_FONT_PROFILE, sha256: VISUAL_EVIDENCE_FONT_PROFILE_SHA256, files: [{ path: "/test/font.otf", sha256: "5".repeat(64) }] },
    rasterizer: {
      name: "LibreOffice",
      executablePath: "/test/soffice",
      executableSha256: "3".repeat(64),
      version: "LibreOffice 26.2.4.2 20(Build:2)",
      bundlePath: "/test/libreoffice",
      bundleResources: [{ path: "/test/resource.dat", sha256: "4".repeat(64) }],
    },
    environment: { locale: "ko-KR", operatingSystem: "test-os", architecture: "test-arch", runtime: { name: "node", version: "26.5.0" } },
  },
  approvalStatus: "reviewed",
};

const validData: VisualEvidenceData = {
  datasets: [{
    dataId: "DATA-TREND-001",
    sourceIds: ["SRC-001"],
    unit: "건",
    denominator: "분기",
    observations: Array.from({ length: 8 }, (_, index) => ({
      observationId: `OBS-${index + 1}`,
      period: `202${4 + Math.floor(index / 4)}-Q${(index % 4) + 1}`,
      label: `${index + 1}분기`,
      value: 100 + index * 5,
      sourceId: "SRC-001",
      sourceSha256: SOURCE_SHA,
      rawLocator: `table:1,row:${index + 1}`,
      claimIds: ["CLAIM-001"],
    })),
  }],
};

const validReferences: readonly GovernedFigureReference[] = [{
  referenceId: "REF-LINE-001",
  referenceFamily: "line",
  storageClass: "extracted_visual_pattern",
  rightsStatus: "approved",
  sourceSha256: REFERENCE_SHA,
  pageLocator: "pattern:line-v1",
  transferBoundary: "정보 위계와 추세 문법만 전이",
  synthetic: false,
  publiclyReleasable: false,
  sourceLineageClass: "project_private",
  humanPromoted: true,
  approved: true,
}];

const validPageContext: FigureA4Context = {
  pageLocator: "page:5",
  pageWidthMm: 210,
  pageHeightMm: 297,
  figureBox: { xMm: 20, yMm: 58, widthMm: 170, heightMm: 100 },
  sectionCallout: "그림 FIG-TREND-001은 최근 분기별 처리량 변화를 보여준다.",
  caption: "출처: 공개 통계",
  peerFigureBoxes: [],
};

describe("independent visual evidence audit", () => {
  it("blocks a synthetic renderFigureA4Page artifact without canonical render provenance", async () => {
    const input = await validAuditInput();
    const synthetic = renderFigureA4Page(input.artifact, validPageContext, { renderPath: "/arbitrary/synthetic-page.svg" });
    const report = await auditFigureSemantics({ ...input, pageArtifact: synthetic });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_RENDER_PROVENANCE_MISSING" }));
  });

  it("blocks when a fake reader hides tampered persisted final-render bytes", async () => {
    const input = await validAuditInput();
    const outputPath = input.pageArtifact!.renderPath;
    const originalBytes = input.pageArtifact!.bytes;
    await writeFile(outputPath, "tampered-final-render", "utf8");
    const report = await auditFigureSemantics({
      ...input,
      pageArtifactReader: {
        realpath: (path: string) => path,
        readFile: (path: string) => path === outputPath ? originalBytes : Buffer.from("forged"),
      },
    } as FigureSemanticAuditInput);

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_RENDER_PROVENANCE_MISMATCH" }));
  });

  it("blocks a self-authored final-render receipt when no persisted KPP RENDERED boundary exists", async () => {
    const input = await validAuditInput();
    const report = await auditFigureSemantics({
      ...input,
      projectRoot: join(tmpdir(), "missing-kpp-render-boundary"),
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_RENDER_PROVENANCE_MISMATCH" }));
  });

  it("blocks when no actual rendered-page artifact is supplied", async () => {
    const input = await validAuditInput();
    const { pageArtifact: _pageArtifact, ...missing } = input;
    const report = await auditFigureSemantics(missing as FigureSemanticAuditInput);

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_RENDER_ARTIFACT_MISSING" }));
  });

  it("rejects a self-consistent but incorrect actual rendered page", async () => {
    const input = await validAuditInput();
    const pageSvg = Buffer.from(input.pageArtifact!.bytes).toString("utf8")
      .replace(input.artifact.sha256, "0".repeat(64));
    const bound = await bindPageFixture(asFixture(input.pageArtifact!, Buffer.from(pageSvg)));
    const report = await auditFigureSemantics({ ...input, ...bound });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_RENDER_ARTIFACT_MISMATCH" }));
  });

  it("measures text bounding-box collisions from actual page bytes", async () => {
    const input = await validAuditInput();
    const pageSvg = Buffer.from(input.pageArtifact!.bytes).toString("utf8")
      .replace(/data-bbox-x="20" data-bbox-y="23"/u, 'data-bbox-x="20" data-bbox-y="159"');
    const bound = await bindPageFixture(asFixture(input.pageArtifact!, Buffer.from(pageSvg)));
    const report = await auditFigureSemantics({ ...input, ...bound });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_LABEL_COLLISION" }));
  });

  it("passes a genuine receipt-bound final-render fixture without granting human approval", async () => {
    const input = await validAuditInput();
    const report = await auditFigureSemantics(input);

    expect(report.status, JSON.stringify(report.findings)).toBe("PASS");
    expect(report.auditorBoundary).toBe("INDEPENDENT_QA_ONLY");
    expect(report.humanApprovalStatus).toBe("reviewed");
  });

  it("rejects a self-consistent but wrong SVG, IR, and point lineage", async () => {
    const input = await validAuditInput();
    const ir = {
      ...input.artifact.ir,
      marks: input.artifact.ir.marks.map((mark, index) => index === 0
        ? { ...mark, value: 999, sourceSha256: "9".repeat(64), evidenceIds: ["EV-FORGED"] }
        : mark),
    };
    const svg = input.artifact.svg
      .replace("100건", "999건")
      .replace(SOURCE_SHA, "9".repeat(64))
      .replace("EV-001", "EV-FORGED");
    const artifact: VisualEvidenceFigureArtifact = {
      ...input.artifact,
      svg,
      sha256: sha256(svg),
      ir,
      pointLineage: input.artifact.pointLineage.map((point, index) => index === 0
        ? { ...point, sourceSha256: "9".repeat(64), evidenceIds: ["EV-FORGED"] }
        : point),
      hashes: {
        ...input.artifact.hashes,
        irSha256: sha256(canonicalFigureInputsJson(ir)),
        outputSha256: sha256(svg),
      },
    };
    const bound = await bindPageFixture(renderFigureA4Page(artifact, validPageContext, { renderPath: "/canonical/rendered/proposal-page-5.svg" }));
    const report = await auditFigureSemantics({ ...input, artifact, ...bound });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_ARTIFACT_MISMATCH" }));
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_LINEAGE_MISMATCH" }));
  });

  it("blocks a line chart with fewer than eight temporal observations", async () => {
    const input = await validAuditInput();
    const shortSeries = {
      datasets: [{ ...validData.datasets[0]!, observations: validData.datasets[0]!.observations.slice(0, 7) }],
    };
    const report = await auditFigureSemantics({ ...input, data: shortSeries });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_SAMPLE_INSUFFICIENT" }));
  });

  it("blocks unresolved evidence and claim bindings", async () => {
    const input = await validAuditInput();
    const report = await auditFigureSemantics({ ...input, spec: { ...input.spec, evidenceIds: ["EV-MISSING"] } });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_EVIDENCE_UNRESOLVED" }));
  });

  it("derives source, unit, and denominator findings from canonical data", async () => {
    const input = await validAuditInput();
    const secondDataset = {
      ...validData.datasets[0]!,
      dataId: "DATA-OTHER",
      sourceIds: ["SRC-OTHER"],
      unit: "%",
      denominator: "연간",
      observations: validData.datasets[0]!.observations.map((observation) => ({
        ...observation,
        observationId: `OTHER-${observation.observationId}`,
        sourceId: "SRC-OTHER",
      })),
    };
    const spec = { ...input.spec, dataIds: ["DATA-TREND-001", "DATA-OTHER"] };
    const data = { datasets: [validData.datasets[0]!, secondDataset] };
    const report = await auditFigureSemantics({ ...input, spec, data });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_SOURCE_DATA_MISMATCH" }));
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_UNIT_MISMATCH" }));
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_DENOMINATOR_MISMATCH" }));
  });

  it.each([
    ["A4 overflow", { figureBox: { ...validPageContext.figureBox, widthMm: 190 } }, "PP_FIGURE_A4_FOOTPRINT"],
    ["actual clipping", { figureBox: { ...validPageContext.figureBox, xMm: 200 } }, "PP_FIGURE_CLIPPING"],
    ["missing caption", { caption: "" }, "PP_FIGURE_CAPTION_MISSING"],
    ["missing section callout", { sectionCallout: "" }, "PP_FIGURE_SECTION_CALLOUT_MISSING"],
    ["repeated geometry", { peerFigureBoxes: [validPageContext.figureBox, validPageContext.figureBox] }, "PP_FIGURE_GEOMETRY_REPEATED"],
  ] as const)("blocks %s from the measured final-page artifact", async (_name, override, code) => {
    const input = await validAuditInput();
    const pageContext = { ...validPageContext, ...override };
    const bound = await bindPageFixture(renderFigureA4Page(input.artifact, pageContext, { renderPath: "/canonical/rendered/proposal-page.svg" }));
    const report = await auditFigureSemantics({ ...input, ...bound });

    expect(report.findings).toContainEqual(expect.objectContaining({ code }));
  });

  it("requires two independent hash-bound approval receipts before human_approved", async () => {
    const input = await validAuditInput();
    const report = await auditFigureSemantics({
      ...input,
      spec: { ...input.spec, approvalStatus: "human_approved" },
      humanReviews: [reviewReceipt(input, "reviewer-1")],
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_HUMAN_APPROVAL_INCOMPLETE" }));
  });

  it("rejects stale human review after final page bytes or locator change", async () => {
    const input = await validAuditInput();
    const reviews = [reviewReceipt(input, "reviewer-1"), reviewReceipt(input, "reviewer-2")];
    const pageContext = { ...validPageContext, pageLocator: "page:6", sectionCallout: `${validPageContext.sectionCallout} 수정` };
    const bound = await bindPageFixture(renderFigureA4Page(input.artifact, pageContext, { renderPath: "/canonical/rendered/proposal-page-6.svg" }));
    const report = await auditFigureSemantics({
      ...input,
      spec: { ...input.spec, approvalStatus: "human_approved" },
      ...bound,
      humanReviews: reviews,
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_HUMAN_APPROVAL_STALE" }));
  });

  it("accepts human_approved only with two current independent approval receipts", async () => {
    const input = await validAuditInput();
    const reviews = [reviewReceipt(input, "reviewer-1"), reviewReceipt(input, "reviewer-2")];
    const report = await auditFigureSemantics({
      ...input,
      spec: { ...input.spec, approvalStatus: "human_approved" },
      humanReviews: reviews,
    });

    expect(report.status, JSON.stringify(report.findings)).toBe("PASS");
    expect(report.humanApprovalStatus).toBe("human_approved");
  });

  it("rejects a public canonical fixture with private or nonsynthetic lineage", async () => {
    const input = await validAuditInput();
    const references = [{
      ...validReferences[0]!,
      storageClass: "public_canonical_fixture" as const,
      rightsStatus: "project_private" as const,
      synthetic: false,
      publiclyReleasable: true,
      sourceLineageClass: "project_private" as const,
    }];
    const report = await auditFigureSemantics({ ...input, references });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_REFERENCE_UNGOVERNED" }));
  });

  it("rejects a private source reference falsely marked publicly releasable", async () => {
    const input = await validAuditInput();
    const references = [{
      ...validReferences[0]!,
      storageClass: "private_source_reference" as const,
      rightsStatus: "project_private" as const,
      publiclyReleasable: true,
      humanPromoted: true,
    }];
    const report = await auditFigureSemantics({ ...input, references });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_REFERENCE_UNGOVERNED" }));
  });
});

async function validAuditInput(): Promise<FigureSemanticAuditInput> {
  const artifact = await compileFigure(validSpec, validData, validReferences);
  const bound = await bindPageFixture(renderFigureA4Page(artifact, validPageContext, { renderPath: "/canonical/rendered/proposal-page-5.svg" }));
  return {
    spec: validSpec,
    data: validData,
    references: validReferences,
    artifact,
    ...bound,
    humanReviews: [],
  };
}

async function bindPageFixture(fixture: FigureA4PageFixture): Promise<{
  pageArtifact: FigureA4PageArtifact;
  projectRoot: string;
  renderManifestPath: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "kpp-visual-render-"));
  const sourceDocumentRealpath = join(projectRoot, "build", "proposal.docx");
  const buildManifestPath = join(projectRoot, "build", "build.json");
  const generationPath = join(projectRoot, "rendered", "generations", "generation-1");
  const renderManifestPath = join(generationPath, "render.json");
  const outputRealpath = join(generationPath, `page-${fixture.pageLocator.replace("page:", "").padStart(4, "0")}.svg`);
  const pdfPath = join(generationPath, "proposal.pdf");
  const executableRealpath = join(projectRoot, "tools", "kpp-render");
  const sourceBytes = Buffer.from("canonical-final-docx-bytes", "utf8");
  const executableBytes = Buffer.from("trusted-kpp-renderer-bytes", "utf8");
  await Promise.all([
    mkdir(dirname(sourceDocumentRealpath), { recursive: true }),
    mkdir(generationPath, { recursive: true }),
    mkdir(dirname(executableRealpath), { recursive: true }),
    mkdir(join(projectRoot, "receipts"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(sourceDocumentRealpath, sourceBytes),
    writeFile(buildManifestPath, '{"schemaVersion":"1.0.0"}\n', "utf8"),
    writeFile(outputRealpath, fixture.bytes),
    writeFile(pdfPath, "%PDF-1.7\n%%EOF\n", "ascii"),
    writeFile(executableRealpath, executableBytes),
  ]);
  const canonicalSource = await realpath(sourceDocumentRealpath);
  const canonicalOutput = await realpath(outputRealpath);
  const canonicalExecutable = await realpath(executableRealpath);
  const receiptPayload = {
    schemaVersion: "kpp-final-render-receipt/v1" as const,
    receiptId: `RENDER-${fixture.figureId}-${fixture.pageLocator}`,
    issuedAt: "2026-08-19T10:00:00.000Z",
    sourceDocumentRealpath: canonicalSource,
    sourceDocumentSha256: sha256Bytes(sourceBytes),
    outputRealpath: canonicalOutput,
    outputSha256: fixture.sha256,
    pageLocator: fixture.pageLocator,
    renderer: {
      name: KPP_FINAL_RENDERER_NAME,
      version: KPP_FINAL_RENDERER_VERSION,
      executableRealpath: canonicalExecutable,
      executableSha256: sha256Bytes(executableBytes),
    },
  };
  const pageArtifact: FigureA4PageArtifact = {
    ...fixture,
    renderPath: canonicalOutput,
    schemaVersion: "visual-evidence-rendered-page/v1",
    provenance: {
      schemaVersion: "visual-evidence-page-provenance/v1",
      renderReceipt: {
        ...receiptPayload,
        receiptSha256: sha256(canonicalFigureInputsJson(receiptPayload)),
      },
    },
  };
  const executable = {
    name: "kpp-render",
    path: canonicalExecutable,
    realpath: canonicalExecutable,
    sha256: sha256Bytes(executableBytes),
    version: KPP_FINAL_RENDERER_VERSION,
  };
  const pdfBytes = await readFile(pdfPath);
  const pageNumber = Number(fixture.pageLocator.replace("page:", ""));
  const pages = await Promise.all(Array.from({ length: pageNumber }, async (_, index) => {
    const page = index + 1;
    if (page === pageNumber) return { page, path: canonicalOutput, sha256: fixture.sha256, bytes: fixture.bytes.byteLength };
    const path = join(generationPath, `page-${String(page).padStart(4, "0")}.svg`);
    const bytes = Buffer.from(`<svg width="210mm" height="297mm" viewBox="0 0 210 297"><text>${page}</text></svg>`, "utf8");
    await writeFile(path, bytes);
    return { page, path, sha256: sha256Bytes(bytes), bytes: bytes.byteLength };
  }));
  const manifest = {
    schemaVersion: "1.0.0",
    rendererVersion: "0.1.0",
    input: { docx: { path: canonicalSource, sha256: sha256Bytes(sourceBytes) } },
    output: {
      pdf: { path: pdfPath, sha256: sha256Bytes(pdfBytes), bytes: pdfBytes.byteLength, pages: pageNumber },
      pages,
    },
    executables: { soffice: executable, pdfinfo: executable, pdftotext: executable, pdftoppm: executable },
    raster: { dpi: 200, format: "svg" },
  };
  await writeFile(renderManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await symlink(join("generations", "generation-1"), join(projectRoot, "rendered", "current"), "dir");
  const buildReceiptPath = join(projectRoot, "receipts", "build.json");
  await writeReceipt({ stage: "BUILT", files: [sourceDocumentRealpath, buildManifestPath], output: buildReceiptPath });
  await writeReceipt({
    stage: "RENDERED",
    files: [sourceDocumentRealpath, renderManifestPath, pdfPath, ...pages.map((page) => page.path)],
    inputReceiptHashes: [sha256Bytes(await readFile(buildReceiptPath))],
    output: join(projectRoot, "receipts", "render.json"),
  });
  return {
    pageArtifact,
    projectRoot,
    renderManifestPath,
  };
}

function asFixture(page: FigureA4PageArtifact | FigureA4PageFixture, bytes: Uint8Array): FigureA4PageFixture {
  return {
    schemaVersion: "visual-evidence-page-fixture/v1",
    figureId: page.figureId,
    format: page.format,
    mediaType: page.mediaType,
    renderPath: page.renderPath,
    pageLocator: page.pageLocator,
    bytes,
    sha256: sha256Bytes(bytes),
  };
}

function reviewReceipt(input: FigureSemanticAuditInput, reviewerId: string): HumanFigureReview {
  const receipt = {
    reviewId: `REVIEW-${reviewerId}`,
    reviewerId,
    reviewedAt: "2026-08-19T10:00:00.000Z",
    reviewedFigureSvgSha256: input.artifact.sha256,
    reviewedFigureIrSha256: input.artifact.hashes.irSha256,
    reviewedPageRenderSha256: input.pageArtifact!.sha256,
    pageLocator: input.pageArtifact!.pageLocator,
    renderedInA4Context: true,
    meaning: true,
    trustworthiness: true,
    documentFit: true,
    sendReady: true,
  } as const;
  return { ...receipt, approvalReceiptSha256: sha256(canonicalFigureInputsJson(receipt)) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
