import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { sha256File, verifyProjectState, verifyReceipt } from "@longtable/kpp-core";
import {
  VISUAL_EVIDENCE_RENDERER_VERSION,
  canonicalFigureInputsJson,
  compileFigureExpected,
  type FigureA4PageArtifact,
  type FigureA4PageFixture,
  type GovernedFigureReference,
  type HumanFigureReview,
  type SemanticFigureSpecV1_1,
  type VisualEvidenceData,
  type VisualEvidenceFigureArtifact,
} from "@longtable/kpp-renderers";
import type { AuditFinding, AuditStatus } from "./source.js";
import {
  APPROVED_VISUAL_EVIDENCE_PROBE_AUTHORITY_ID,
  APPROVED_VISUAL_EVIDENCE_PROBE_SHA256,
  APPROVED_VISUAL_EVIDENCE_PROBE_VERSION,
} from "./visual-probe-authority.js";

export interface FigureSemanticAuditInput {
  readonly spec: SemanticFigureSpecV1_1;
  readonly data: VisualEvidenceData;
  readonly references: readonly GovernedFigureReference[];
  readonly artifact: VisualEvidenceFigureArtifact;
  readonly pageArtifact?: FigureA4PageArtifact | FigureA4PageFixture;
  /** Trusted KPP project boundary. Programmatic callers cannot replace its filesystem reader. */
  readonly projectRoot?: string;
  /** Persisted manifest from the KPP RENDERED generation. */
  readonly renderManifestPath?: string;
  readonly humanReviews?: readonly HumanFigureReview[];
}

export interface FigureAuditReport {
  readonly schemaVersion: "figure-audit/v1";
  readonly figureId: string;
  readonly status: AuditStatus;
  readonly findings: readonly AuditFinding[];
  readonly auditorBoundary: "INDEPENDENT_QA_ONLY";
  readonly compilerApproval: "NOT_ACCEPTED";
  readonly humanApprovalStatus: SemanticFigureSpecV1_1["approvalStatus"];
}

/** Independent QA reconstructs the expected artifact from governed inputs. */
export async function auditFigureSemantics(input: FigureSemanticAuditInput): Promise<FigureAuditReport> {
  const findings: AuditFinding[] = [];
  const expected = reconstructExpected(input, findings);
  auditDataSemantics(input, findings);
  await auditSvgAndPage(input, expected, findings);
  auditHumanApproval(input, expected, findings);
  return {
    schemaVersion: "figure-audit/v1",
    figureId: input.spec.figureId,
    status: findings.length === 0 ? "PASS" : "BLOCKED",
    findings: findings.sort(compareFindings),
    auditorBoundary: "INDEPENDENT_QA_ONLY",
    compilerApproval: "NOT_ACCEPTED",
    humanApprovalStatus: input.spec.approvalStatus,
  };
}

function reconstructExpected(input: FigureSemanticAuditInput, findings: AuditFinding[]): VisualEvidenceFigureArtifact | undefined {
  if (input.artifact.compilerApproval !== "not_authorized") {
    add(findings, "PP_FIGURE_COMPILER_SELF_APPROVAL", "The compiler is not authorized to approve its own final figure.");
  }
  let expected: VisualEvidenceFigureArtifact;
  try {
    expected = compileFigureExpected(input.spec, input.data, input.references);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/reference|rights|fixture|private|public/i.test(message)) {
      add(findings, "PP_FIGURE_REFERENCE_UNGOVERNED", "Every visual reference must have a valid storage, rights, release, and source-lineage combination.", { actual: message });
    } else if (/fingerprint|renderer/i.test(message)) {
      add(findings, "PP_FIGURE_RENDERER_MISMATCH", "The semantic renderer fingerprint is missing or does not match the locked environment.", { actual: message });
    } else {
      add(findings, "PP_FIGURE_INPUT_INVALID", "The governed spec, data, and references cannot produce a canonical figure.", { actual: message });
    }
    return undefined;
  }
  if (canonicalFigureInputsJson(artifactSemanticBytes(input.artifact)) !== canonicalFigureInputsJson(artifactSemanticBytes(expected))) {
    add(findings, "PP_FIGURE_ARTIFACT_MISMATCH", "Artifact bytes or canonical IR differ from independent compiler reconstruction.");
  }
  if (canonicalFigureInputsJson(input.artifact.pointLineage) !== canonicalFigureInputsJson(expected.pointLineage)
    || canonicalFigureInputsJson(input.artifact.lineage) !== canonicalFigureInputsJson(expected.lineage)) {
    add(findings, "PP_FIGURE_LINEAGE_MISMATCH", "Point or aggregate lineage differs from the structured spec and canonical data.");
  }
  if (input.artifact.figureId !== input.spec.figureId
    || input.artifact.rendererVersion !== VISUAL_EVIDENCE_RENDERER_VERSION
    || input.spec.rendererVersion !== VISUAL_EVIDENCE_RENDERER_VERSION
    || input.artifact.rendererFingerprintSha256 !== expected.rendererFingerprintSha256) {
    add(findings, "PP_FIGURE_RENDERER_MISMATCH", "Figure identity or semantic renderer fingerprint does not match the audited spec.");
  }
  if (input.artifact.sha256 !== sha256(input.artifact.svg) || input.artifact.hashes.outputSha256 !== input.artifact.sha256) {
    add(findings, "PP_FIGURE_OUTPUT_HASH_MISMATCH", "Figure SVG bytes do not match the declared output hash.");
  }
  const specEvidence = sortedUnique(input.spec.evidenceIds);
  const evidenceResolved = sameStrings(expected.lineage.evidenceIds, specEvidence)
    && sameStrings(expected.captionBindings.evidenceIds, specEvidence)
    && expected.pointLineage.every((point) => sameStrings(point.evidenceIds, specEvidence) && point.claimIds.length > 0);
  const actualEvidenceResolved = sameStrings(input.artifact.lineage.evidenceIds, specEvidence)
    && sameStrings(input.artifact.captionBindings.evidenceIds, specEvidence)
    && input.artifact.pointLineage.every((point) => sameStrings(point.evidenceIds, specEvidence));
  if (!evidenceResolved || !actualEvidenceResolved) {
    add(findings, "PP_FIGURE_EVIDENCE_UNRESOLVED", "Every figure claim, caption, and plotted mark must resolve to the spec evidence bindings.");
  }
  return expected;
}

function auditDataSemantics(input: FigureSemanticAuditInput, findings: AuditFinding[]): void {
  const selected = input.data.datasets.filter((dataset) => input.spec.dataIds.includes(dataset.dataId));
  if (selected.length !== input.spec.dataIds.length) add(findings, "PP_FIGURE_DATA_ID_MISMATCH", "Semantic figure data IDs do not resolve to a unique dataset set.");
  const datasetSources = sortedUnique(selected.flatMap((dataset) => dataset.sourceIds));
  const observationSources = sortedUnique(selected.flatMap((dataset) => dataset.observations.map((observation) => observation.sourceId)));
  const captionSources = sortedUnique(input.spec.sourceCaption.sourceIds);
  if (!sameStrings(datasetSources, observationSources) || !sameStrings(datasetSources, captionSources)) {
    add(findings, "PP_FIGURE_SOURCE_DATA_MISMATCH", "Dataset, observations, and source caption do not resolve to the same source IDs.", { expected: datasetSources, actual: { observationSources, captionSources } });
  }
  const units = sortedUnique(selected.map((dataset) => dataset.unit).filter(isString));
  if (units.length > 1) add(findings, "PP_FIGURE_UNIT_MISMATCH", "Figure values do not share one comparable declared unit.", { actual: units });
  const denominators = sortedUnique(selected.map((dataset) => dataset.denominator).filter(isString));
  if (denominators.length > 1) add(findings, "PP_FIGURE_DENOMINATOR_MISMATCH", "Figure values do not share one comparable denominator.", { actual: denominators });
  const observations = selected.flatMap((dataset) => dataset.observations);
  if (input.spec.relationship === "trend") {
    const configured = input.spec.minimumDataConditions.minimumTemporalObservations;
    const minimum = typeof configured === "number" ? Math.max(8, configured) : 8;
    const temporal = observations.filter((observation) => observation.period !== undefined && observation.value !== undefined);
    if (temporal.length < minimum) add(findings, "PP_FIGURE_SAMPLE_INSUFFICIENT", "A time-trend line requires at least eight temporal observations.", { expected: minimum, actual: temporal.length });
  }
}

async function auditSvgAndPage(input: FigureSemanticAuditInput, expected: VisualEvidenceFigureArtifact | undefined, findings: AuditFinding[]): Promise<void> {
  const measurement = measureSvg(input.artifact.svg);
  if (measurement.clipped > 0) add(findings, "PP_FIGURE_CLIPPING", "Rendered marks are clipped by the SVG viewBox.", { actual: measurement.clipped });
  if (measurement.minimumContrast < 4.5) add(findings, "PP_FIGURE_CONTRAST", "Text or essential marks do not meet a 4.5:1 contrast ratio.", { actual: measurement.minimumContrast });
  if (!measurement.grayscaleDistinct) add(findings, "PP_FIGURE_GRAYSCALE", "Essential series or states are not distinguishable in grayscale.");
  const values = input.data.datasets.filter((dataset) => input.spec.dataIds.includes(dataset.dataId)).flatMap((dataset) => dataset.observations.map((observation) => observation.value).filter(isNumber));
  if (values.length > 0 && measurement.scale !== undefined) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (measurement.scale.min > min || measurement.scale.max < max || (min >= 0 && (!measurement.scale.includeZero || measurement.scale.min > 0))) add(findings, "PP_FIGURE_SCALE_DISHONEST", "Measured SVG scale clips values or exaggerates a nonnegative comparison.");
  }
  const page = input.pageArtifact;
  if (page === undefined) {
    add(findings, "PP_FIGURE_RENDER_ARTIFACT_MISSING", "Independent QA requires actual final-page render bytes, path, hash, and page locator.");
    return;
  }
  if (page.schemaVersion !== "visual-evidence-rendered-page/v1" || !("provenance" in page)) {
    add(findings, "PP_FIGURE_RENDER_PROVENANCE_MISSING", "Synthetic page fixtures are not final-render evidence; a canonical KPP render receipt is required.");
    return;
  }
  const pageAnalysis = await validateFinalRenderProvenance(page, input, findings);
  if (pageAnalysis === undefined) return;
  if (page.figureId !== input.spec.figureId || page.renderPath.trim().length === 0
    || page.pageLocator.trim().length === 0 || page.bytes.byteLength === 0 || page.sha256 !== sha256Bytes(page.bytes)) {
    add(findings, "PP_FIGURE_RENDER_ARTIFACT_MISMATCH", "Actual rendered-page bytes, hash, render path, or locator are invalid.");
    return;
  }
  if (page.format !== "png" || page.mediaType !== "image/png" || !page.renderPath.toLowerCase().endsWith(".png")) {
    add(findings, "PP_FIGURE_RENDER_FORMAT_UNMEASURABLE", "Independent page QA requires the canonical PNG emitted by KPP renderProject and its receipt-bound visual analysis sidecar.");
    return;
  }
  const figure = pageAnalysis.figures.find((candidate) => candidate.figureId === input.spec.figureId);
  if (figure === undefined || figure.figureSvgSha256 !== input.artifact.sha256) {
    add(findings, "PP_FIGURE_RENDER_ARTIFACT_MISMATCH", "The trusted analysis of the actual PNG does not bind the independently reconstructed figure.");
    return;
  }
  const expectedWidthMm = pageAnalysis.pixelWidth / pageAnalysis.dpi * 25.4;
  const expectedHeightMm = pageAnalysis.pixelHeight / pageAnalysis.dpi * 25.4;
  const pageIsA4 = Math.abs(expectedWidthMm - 210) <= 0.75
    && Math.abs(expectedHeightMm - 297) <= 0.75
    && Math.abs(pageAnalysis.pageWidthMm - expectedWidthMm) <= 0.75
    && Math.abs(pageAnalysis.pageHeightMm - expectedHeightMm) <= 0.75;
  if (!pageIsA4 || figure.box.widthMm > 180 || figure.box.heightMm > 247) {
    add(findings, "PP_FIGURE_A4_FOOTPRINT", "Measured actual-page geometry does not fit the governed A4 page.");
  }
  if (figure.caption !== input.spec.sourceCaption.text) add(findings, "PP_FIGURE_CAPTION_MISSING", "The trusted analysis of the actual PNG does not contain the governed source caption.");
  if (!figure.sectionCallout.includes(input.spec.figureId)) add(findings, "PP_FIGURE_SECTION_CALLOUT_MISSING", "The trusted analysis of the actual PNG does not call out the governed figure.");
  const allBoxes = [figure.box, ...pageAnalysis.peerFigureBoxes, ...pageAnalysis.textBoxes];
  const clipped = allBoxes.filter((box) => box.xMm < 0 || box.yMm < 0 || box.widthMm <= 0 || box.heightMm <= 0
    || box.xMm + box.widthMm > pageAnalysis.pageWidthMm || box.yMm + box.heightMm > pageAnalysis.pageHeightMm).length;
  if (clipped > 0) add(findings, "PP_FIGURE_CLIPPING", "Actual-page marks or text bounding boxes are clipped.", { actual: clipped });
  let labelCollisions = 0;
  for (let left = 0; left < pageAnalysis.textBoxes.length; left += 1) {
    for (let right = left + 1; right < pageAnalysis.textBoxes.length; right += 1) {
      if (overlapMm(pageAnalysis.textBoxes[left]!, pageAnalysis.textBoxes[right]!)) labelCollisions += 1;
    }
  }
  if (labelCollisions > 0) add(findings, "PP_FIGURE_LABEL_COLLISION", "Actual-page text bounding boxes collide.", { actual: labelCollisions });
  const geometries = [figure.box, ...pageAnalysis.peerFigureBoxes].map((box) => `${box.widthMm}\0${box.heightMm}`);
  const repeatedGeometry = Math.max(0, ...geometries.map((key) => geometries.filter((candidate) => candidate === key).length));
  if (repeatedGeometry > 2) add(findings, "PP_FIGURE_GEOMETRY_REPEATED", "Repeated actual-page figure geometry creates a card-wall pattern.", { actual: repeatedGeometry });
  if (pageAnalysis.blockedDimensions.length > 0) {
    add(findings, "PP_FIGURE_RENDER_DIMENSION_BLOCKED", "The trusted PNG analyzer could not measure every required semantic layout dimension.", { actual: pageAnalysis.blockedDimensions });
  }
  if (expected !== undefined && figure.figureSvgSha256 !== expected.sha256) add(findings, "PP_FIGURE_RENDER_ARTIFACT_MISMATCH", "Actual page contains a figure other than the independently reconstructed artifact.");
}

async function validateFinalRenderProvenance(
  page: FigureA4PageArtifact,
  input: FigureSemanticAuditInput,
  findings: AuditFinding[],
): Promise<TrustedVisualPageAnalysis | undefined> {
  try {
    if (input.projectRoot === undefined || input.renderManifestPath === undefined) throw new Error("trusted project root and render manifest are required");
    const projectRoot = await realpath(resolve(input.projectRoot));
    const project = await verifyProjectState(projectRoot);
    if (project.state !== "RENDERED") throw new Error(`project state is ${project.state}, not RENDERED`);
    const manifestPath = await realpath(resolve(input.renderManifestPath));
    const currentGeneration = await realpath(join(projectRoot, "rendered", "current"));
    const generationsRoot = await realpath(join(projectRoot, "rendered", "generations"));
    if (!isWithin(generationsRoot, currentGeneration)
      || manifestPath !== join(currentGeneration, "render.json")) throw new Error("render manifest is not the canonical current KPP generation manifest");

    const buildReceiptPath = join(projectRoot, "receipts", "build.json");
    const renderReceiptPath = join(projectRoot, "receipts", "render.json");
    const [buildVerification, renderVerification, buildReceiptSha256] = await Promise.all([
      verifyReceipt(buildReceiptPath),
      verifyReceipt(renderReceiptPath),
      sha256File(buildReceiptPath),
    ]);
    if (!buildVerification.valid || buildVerification.receipt.stage !== "BUILT" || buildVerification.receipt.result !== "PASS") throw new Error("BUILT receipt is not current PASS");
    if (!renderVerification.valid || renderVerification.receipt.stage !== "RENDERED" || renderVerification.receipt.result !== "PASS") throw new Error("RENDERED receipt is not current PASS");
    if (!renderVerification.receipt.inputReceiptHashes.includes(buildReceiptSha256)) throw new Error("RENDERED receipt is not chained to the current BUILT receipt");

    const manifestBytes = await readFile(manifestPath);
    const manifest = parseRenderManifest(manifestBytes);
    if (manifest.raster.format !== "png") throw new Error("render manifest raster contract is not canonical PNG");
    if (manifest.visualEvidence.authority.authorityId !== APPROVED_VISUAL_EVIDENCE_PROBE_AUTHORITY_ID
      || manifest.visualEvidence.authority.analyzerSha256 !== APPROVED_VISUAL_EVIDENCE_PROBE_SHA256
      || manifest.visualEvidence.analyzer.name !== "visual-evidence-probe"
      || manifest.visualEvidence.analyzer.sha256 !== APPROVED_VISUAL_EVIDENCE_PROBE_SHA256
      || manifest.visualEvidence.analyzer.version !== APPROVED_VISUAL_EVIDENCE_PROBE_VERSION) {
      throw new Error("visual evidence analyzer is not approved by the KPP release authority");
    }
    const manifestRecord = await matchingReceiptFile(renderVerification.receipt.files, manifestPath);
    if (manifestRecord?.sha256 !== sha256Bytes(manifestBytes)) throw new Error("render manifest is not bound by the RENDERED receipt");

    const sourcePath = await realpath(manifest.input.docx.path);
    const outputPath = await realpath(page.renderPath);
    const pdfPath = await realpath(manifest.output.pdf.path);
    if (!isWithin(projectRoot, sourcePath) || !isWithin(currentGeneration, outputPath) || !isWithin(currentGeneration, pdfPath)) throw new Error("render inputs or outputs escape the KPP project generation");
    const pageNumber = parsePageLocator(page.pageLocator);
    const pageRecord = manifest.output.pages.find((record) => record.page === pageNumber);
    if (pageRecord === undefined || await realpath(pageRecord.path) !== outputPath) throw new Error("page locator is not present in the render manifest");
    const visualPageRecord = manifest.visualEvidence.pages.find((record) => record.page === pageNumber);
    if (visualPageRecord === undefined || visualPageRecord.sourcePageSha256 !== pageRecord.sha256) throw new Error("visual evidence sidecar is not bound to the selected PNG page");
    const visualPagePath = await realpath(visualPageRecord.path);
    if (!isWithin(currentGeneration, visualPagePath)) throw new Error("visual evidence sidecar escapes the current KPP generation");
    const analyzerPath = await realpath(manifest.visualEvidence.analyzer.path);
    if (!isWithin(currentGeneration, analyzerPath)
      || manifest.visualEvidence.analyzer.realpath !== analyzerPath
      || await sha256File(analyzerPath) !== APPROVED_VISUAL_EVIDENCE_PROBE_SHA256) {
      throw new Error("visual evidence analyzer bytes or location do not match the KPP release authority");
    }

    const [sourceBytes, outputBytes, pdfBytes, visualPageBytes] = await Promise.all([
      readFile(sourcePath), readFile(outputPath), readFile(pdfPath), readFile(visualPagePath),
    ]);
    const sourceHash = sha256Bytes(sourceBytes);
    const outputHash = sha256Bytes(outputBytes);
    const pdfHash = sha256Bytes(pdfBytes);
    if (manifest.input.docx.sha256 !== sourceHash
      || manifest.output.pdf.sha256 !== pdfHash || manifest.output.pdf.bytes !== pdfBytes.byteLength
      || pageRecord.sha256 !== outputHash || pageRecord.bytes !== outputBytes.byteLength
      || visualPageRecord.sha256 !== sha256Bytes(visualPageBytes) || visualPageRecord.bytes !== visualPageBytes.byteLength
      || page.sha256 !== outputHash || !Buffer.from(page.bytes).equals(outputBytes)) throw new Error("manifest or page hashes do not bind the current bytes");
    const dimensions = pngDimensions(outputBytes);
    const visualPage = parseVisualPageAnalysis(visualPageBytes);
    if (visualPage.page !== pageNumber || visualPage.pageSha256 !== outputHash
      || visualPage.pixelWidth !== dimensions.width || visualPage.pixelHeight !== dimensions.height
      || visualPage.dpi !== manifest.raster.dpi) throw new Error("visual analysis sidecar does not describe the current PNG bytes");

    const buildSource = await matchingReceiptFile(buildVerification.receipt.files, sourcePath);
    const renderSource = await matchingReceiptFile(renderVerification.receipt.files, sourcePath);
    const renderPdf = await matchingReceiptFile(renderVerification.receipt.files, pdfPath);
    const renderPage = await matchingReceiptFile(renderVerification.receipt.files, outputPath);
    const renderVisualPage = await matchingReceiptFile(renderVerification.receipt.files, visualPagePath);
    const renderAnalyzer = await matchingReceiptFile(renderVerification.receipt.files, analyzerPath);
    if (buildSource?.sha256 !== sourceHash || renderSource?.sha256 !== sourceHash
      || renderPdf?.sha256 !== pdfHash || renderPage?.sha256 !== outputHash
      || renderVisualPage?.sha256 !== visualPageRecord.sha256
      || renderAnalyzer?.sha256 !== APPROVED_VISUAL_EVIDENCE_PROBE_SHA256) throw new Error("document, analyzer, or outputs are not bound by the KPP receipt chain");

    for (const executable of [...Object.values(manifest.executables), manifest.visualEvidence.analyzer]) {
      const executablePath = await realpath(executable.path);
      if (executable.realpath !== executablePath || executable.sha256 !== await sha256File(executablePath)) throw new Error(`renderer executable is stale: ${executable.path}`);
    }
    return visualPage;
  } catch (error) {
    add(findings, "PP_FIGURE_RENDER_PROVENANCE_MISMATCH", "Persisted KPP BUILT/RENDERED receipts, manifest, document, renderer, or page bytes could not be independently verified.", { actual: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

interface RenderPathHash { readonly path: string; readonly sha256: string }
interface RenderManifestPage extends RenderPathHash { readonly page: number; readonly bytes: number }
interface RenderManifestExecutable extends RenderPathHash { readonly name?: string; readonly realpath: string; readonly version: string }
interface TrustedRenderManifest {
  readonly schemaVersion: "1.0.0";
  readonly rendererVersion: "0.1.0";
  readonly input: { readonly docx: RenderPathHash };
  readonly output: { readonly pdf: RenderPathHash & { readonly bytes: number; readonly pages: number }; readonly pages: readonly RenderManifestPage[] };
  readonly executables: Readonly<Record<string, RenderManifestExecutable>>;
  readonly raster: { readonly dpi: number; readonly format: "png" };
  readonly visualEvidence: {
    readonly schemaVersion: "kpp-visual-evidence-render/v1";
    readonly authority: {
      readonly schemaVersion: "kpp-visual-probe-authority/v1";
      readonly authorityId: string;
      readonly analyzerSha256: string;
    };
    readonly analyzer: RenderManifestExecutable;
    readonly pages: readonly (RenderManifestPage & { readonly sourcePageSha256: string })[];
  };
}

function parseRenderManifest(bytes: Uint8Array): TrustedRenderManifest {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isRecord(value) || value.schemaVersion !== "1.0.0" || value.rendererVersion !== "0.1.0"
    || !isRecord(value.input) || !isPathHash(value.input.docx)
    || !isRecord(value.output) || !isRecord(value.output.pdf) || !isPathHash(value.output.pdf)
    || !Number.isInteger(value.output.pdf.bytes) || Number(value.output.pdf.bytes) < 1
    || !Number.isInteger(value.output.pdf.pages) || Number(value.output.pdf.pages) < 1 || !Array.isArray(value.output.pages)
    || !value.output.pages.every(isRenderPage) || !isRecord(value.executables)
    || !isRecord(value.raster) || !Number.isInteger(value.raster.dpi) || Number(value.raster.dpi) < 1 || value.raster.format !== "png"
    || !isRecord(value.visualEvidence) || value.visualEvidence.schemaVersion !== "kpp-visual-evidence-render/v1"
    || !isVisualEvidenceAuthority(value.visualEvidence.authority)
    || !isRenderExecutable(value.visualEvidence.analyzer) || !Array.isArray(value.visualEvidence.pages)
    || !value.visualEvidence.pages.every(isVisualEvidencePageRecord)) throw new Error("render manifest structure is invalid");
  const pages = value.output.pages as RenderManifestPage[];
  if (pages.length !== value.output.pdf.pages || pages.some((page, index) => page.page !== index + 1)) throw new Error("render manifest page set is incomplete");
  const executableRecord = value.executables as Record<string, unknown>;
  const executables = ["soffice", "pdfinfo", "pdftotext", "pdftoppm"].map((name) => executableRecord[name]);
  if (!executables.every(isRenderExecutable)) throw new Error("render manifest renderer identities are invalid");
  return value as unknown as TrustedRenderManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPathHash(value: unknown): value is Record<string, unknown> & RenderPathHash {
  return isRecord(value) && typeof value.path === "string" && /^[a-f0-9]{64}$/iu.test(String(value.sha256));
}

function isRenderPage(value: unknown): value is RenderManifestPage {
  return isPathHash(value) && Number.isInteger(value.page) && Number(value.page) > 0 && Number.isInteger(value.bytes) && Number(value.bytes) > 0;
}

function isVisualEvidencePageRecord(value: unknown): value is RenderManifestPage & { readonly sourcePageSha256: string } {
  return isRecord(value) && isRenderPage(value) && typeof value.sourcePageSha256 === "string"
    && /^[a-f0-9]{64}$/u.test(value.sourcePageSha256);
}

function isRenderExecutable(value: unknown): value is RenderManifestExecutable {
  return isPathHash(value) && (value.name === undefined || typeof value.name === "string")
    && typeof value.realpath === "string" && typeof value.version === "string";
}

function isVisualEvidenceAuthority(value: unknown): value is TrustedRenderManifest["visualEvidence"]["authority"] {
  return isRecord(value) && value.schemaVersion === "kpp-visual-probe-authority/v1"
    && typeof value.authorityId === "string"
    && typeof value.analyzerSha256 === "string" && /^[a-f0-9]{64}$/u.test(value.analyzerSha256);
}

interface MillimetreBox { readonly xMm: number; readonly yMm: number; readonly widthMm: number; readonly heightMm: number }
interface TrustedVisualPageAnalysis {
  readonly schemaVersion: "kpp-visual-page-analysis/v1";
  readonly page: number;
  readonly pageSha256: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly dpi: number;
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  readonly figures: readonly {
    readonly figureId: string;
    readonly figureSvgSha256: string;
    readonly box: MillimetreBox;
    readonly caption: string;
    readonly sectionCallout: string;
  }[];
  readonly textBoxes: readonly ({ readonly text: string } & MillimetreBox)[];
  readonly peerFigureBoxes: readonly MillimetreBox[];
  readonly blockedDimensions: readonly string[];
}

function parseVisualPageAnalysis(bytes: Uint8Array): TrustedVisualPageAnalysis {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isRecord(value) || value.schemaVersion !== "kpp-visual-page-analysis/v1"
    || !Number.isInteger(value.page) || Number(value.page) < 1
    || typeof value.pageSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.pageSha256)
    || !Number.isInteger(value.pixelWidth) || Number(value.pixelWidth) < 1
    || !Number.isInteger(value.pixelHeight) || Number(value.pixelHeight) < 1
    || !Number.isInteger(value.dpi) || Number(value.dpi) < 1
    || !isPositiveNumber(value.pageWidthMm) || !isPositiveNumber(value.pageHeightMm)
    || !Array.isArray(value.figures) || !value.figures.every(isVisualFigure)
    || !Array.isArray(value.textBoxes) || !value.textBoxes.every((entry) => isRecord(entry) && isMillimetreBox(entry) && typeof entry.text === "string")
    || !Array.isArray(value.peerFigureBoxes) || !value.peerFigureBoxes.every(isMillimetreBox)
    || !Array.isArray(value.blockedDimensions) || !value.blockedDimensions.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new Error("visual evidence sidecar structure is invalid");
  }
  return value as unknown as TrustedVisualPageAnalysis;
}

function isVisualFigure(value: unknown): boolean {
  return isRecord(value) && typeof value.figureId === "string" && value.figureId.length > 0
    && typeof value.figureSvgSha256 === "string" && /^[a-f0-9]{64}$/u.test(value.figureSvgSha256)
    && isMillimetreBox(value.box) && typeof value.caption === "string" && typeof value.sectionCallout === "string";
}

function isMillimetreBox(value: unknown): value is MillimetreBox {
  return isRecord(value) && isFiniteNumber(value.xMm) && isFiniteNumber(value.yMm)
    && isPositiveNumber(value.widthMm) && isPositiveNumber(value.heightMm);
}

function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isPositiveNumber(value: unknown): value is number { return isFiniteNumber(value) && value > 0; }
function overlapMm(left: MillimetreBox, right: MillimetreBox): boolean {
  return left.xMm < right.xMm + right.widthMm && left.xMm + left.widthMm > right.xMm
    && left.yMm < right.yMm + right.heightMm && left.yMm + left.heightMm > right.yMm;
}

function pngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  const buffer = Buffer.from(bytes);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.byteLength < 24 || !buffer.subarray(0, 8).equals(signature)
    || buffer.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error("selected page is not a measurable PNG");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) throw new Error("selected PNG has invalid dimensions");
  return { width, height };
}

function parsePageLocator(locator: string): number {
  const match = /^page:(\d+)$/u.exec(locator);
  if (match === null || Number(match[1]) < 1) throw new Error("page locator is invalid");
  return Number(match[1]);
}

async function matchingReceiptFile(files: readonly { readonly path: string; readonly sha256: string }[], target: string) {
  const canonicalTarget = await realpath(target);
  for (const file of files) {
    if (await realpath(file.path).catch(() => undefined) === canonicalTarget) return file;
  }
  return undefined;
}

function isWithin(parent: string, child: string): boolean {
  const candidate = relative(parent, child);
  return candidate === "" || (!candidate.startsWith(`..${sep}`) && candidate !== ".." && !candidate.startsWith(sep));
}

function auditHumanApproval(input: FigureSemanticAuditInput, expected: VisualEvidenceFigureArtifact | undefined, findings: AuditFinding[]): void {
  if (input.spec.approvalStatus !== "human_approved") return;
  const expectedPage = input.pageArtifact;
  const complete = (input.humanReviews ?? []).filter((review) => {
    const { approvalReceiptSha256: _receipt, ...payload } = review;
    const current = expected !== undefined && expectedPage !== undefined && expectedPage.sha256 === sha256Bytes(expectedPage.bytes) && review.reviewedFigureSvgSha256 === expected.sha256 && review.reviewedFigureIrSha256 === expected.hashes.irSha256 && review.reviewedPageRenderSha256 === expectedPage.sha256 && review.pageLocator === expectedPage.pageLocator && review.approvalReceiptSha256 === sha256(canonicalFigureInputsJson(payload));
    if (!current) add(findings, "PP_FIGURE_HUMAN_APPROVAL_STALE", "Human approval receipt does not bind the current figure and final page bytes.", { actual: review.reviewId });
    return current && review.reviewerId.trim().length > 0 && review.renderedInA4Context && review.meaning && review.trustworthiness && review.documentFit && review.sendReady;
  });
  if (new Set(complete.map((review) => review.reviewerId)).size < 2) add(findings, "PP_FIGURE_HUMAN_APPROVAL_INCOMPLETE", "human_approved requires two independent complete reviews of the exact final A4 page.", { expected: 2, actual: new Set(complete.map((review) => review.reviewerId)).size });
}

function measureSvg(svg: string): { clipped: number; minimumContrast: number; grayscaleDistinct: boolean; scale?: { min: number; max: number; includeZero: boolean } } {
  const viewBox = /viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/u.exec(svg)?.slice(1).map(Number);
  let clipped = 0;
  if (viewBox !== undefined) {
    const [vx, vy, width, height] = viewBox;
    for (const match of svg.matchAll(/<(?:rect|image)\b[^>]*\bx="([\d.-]+)"[^>]*\by="([\d.-]+)"[^>]*\bwidth="([\d.-]+)"[^>]*\bheight="([\d.-]+)"/gu)) {
      const [, x, y, w, h] = match.map(Number);
      if (x! < vx! || y! < vy! || x! + w! > vx! + width! || y! + h! > vy! + height!) clipped += 1;
    }
    for (const match of svg.matchAll(/<circle\b[^>]*\bcx="([\d.-]+)"[^>]*\bcy="([\d.-]+)"[^>]*\br="([\d.-]+)"/gu)) {
      const [, x, y, radius] = match.map(Number);
      if (x! - radius! < vx! || y! - radius! < vy! || x! + radius! > vx! + width! || y! + radius! > vy! + height!) clipped += 1;
    }
  }
  const scaleMatch = /data-scale-min="([\d.-]+)" data-scale-max="([\d.-]+)" data-include-zero="(true|false)"/u.exec(svg);
  const scale = scaleMatch === null ? undefined : { min: Number(scaleMatch[1]), max: Number(scaleMatch[2]), includeZero: scaleMatch[3] === "true" };
  const paper = /<rect\b[^>]*\bfill="(#[0-9A-Fa-f]{6})"/u.exec(svg)?.[1] ?? "#FFFFFF";
  const inks = [...svg.matchAll(/(?:text\{|\.question\{|\.takeaway\{|\.caption\{)[^}]*fill:(#[0-9A-Fa-f]{6})/gu)].map((match) => match[1]!);
  const ratios = inks.map((color) => contrast(color, paper));
  const minimumContrast = ratios.length === 0 ? 0 : Math.min(...ratios);
  const grayscaleDistinct = new Set(inks.map((color) => Math.round(luminance(color) * 100))).size >= 2;
  return { clipped, minimumContrast, grayscaleDistinct, ...(scale === undefined ? {} : { scale }) };
}

function contrast(left: string, right: string): number { const [dark, light] = [luminance(left), luminance(right)].sort((a, b) => a - b); return (light! + 0.05) / (dark! + 0.05); }
function luminance(color: string): number { const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4); return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!; }
function artifactSemanticBytes(artifact: VisualEvidenceFigureArtifact): Omit<VisualEvidenceFigureArtifact, "approvalStatus"> { const { approvalStatus: _approval, ...semantic } = artifact; return semantic; }
function add(findings: AuditFinding[], code: string, message: string, detail: Omit<AuditFinding, "code" | "message"> = {}): void { findings.push({ code, message, ...detail }); }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function sha256Bytes(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function sortedUnique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function isString(value: string | undefined): value is string { return typeof value === "string" && value.length > 0; }
function isNumber(value: number | undefined): value is number { return typeof value === "number" && Number.isFinite(value); }
function compareFindings(left: AuditFinding, right: AuditFinding): number { return compareText(`${left.code}\0${left.message}`, `${right.code}\0${right.message}`); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
