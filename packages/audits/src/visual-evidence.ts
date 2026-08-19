import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import {
  KPP_FINAL_RENDERER_NAME,
  KPP_FINAL_RENDERER_VERSION,
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

export interface FigureSemanticAuditInput {
  readonly spec: SemanticFigureSpecV1_1;
  readonly data: VisualEvidenceData;
  readonly references: readonly GovernedFigureReference[];
  readonly artifact: VisualEvidenceFigureArtifact;
  readonly pageArtifact?: FigureA4PageArtifact | FigureA4PageFixture;
  readonly pageArtifactReader?: FigurePageArtifactReader;
  readonly humanReviews?: readonly HumanFigureReview[];
}

export interface FigurePageArtifactReader {
  readonly realpath: (path: string) => string;
  readonly readFile: (path: string) => Uint8Array;
}

const NODE_PAGE_ARTIFACT_READER: FigurePageArtifactReader = {
  realpath: realpathSync,
  readFile: readFileSync,
};

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
export function auditFigureSemantics(input: FigureSemanticAuditInput): FigureAuditReport {
  const findings: AuditFinding[] = [];
  const expected = reconstructExpected(input, findings);
  auditDataSemantics(input, findings);
  auditSvgAndPage(input, expected, findings);
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

function auditSvgAndPage(input: FigureSemanticAuditInput, expected: VisualEvidenceFigureArtifact | undefined, findings: AuditFinding[]): void {
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
  if (!validateFinalRenderProvenance(page, input.pageArtifactReader ?? NODE_PAGE_ARTIFACT_READER, findings)) return;
  if (page.figureId !== input.spec.figureId || page.renderPath.trim().length === 0
    || page.pageLocator.trim().length === 0 || page.bytes.byteLength === 0 || page.sha256 !== sha256Bytes(page.bytes)) {
    add(findings, "PP_FIGURE_RENDER_ARTIFACT_MISMATCH", "Actual rendered-page bytes, hash, render path, or locator are invalid.");
    return;
  }
  if (page.format !== "svg") {
    add(findings, "PP_FIGURE_RENDER_FORMAT_UNMEASURABLE", "Independent page QA currently requires a canonical SVG page render so geometry and text can be measured.");
    return;
  }
  const pageSvg = Buffer.from(page.bytes).toString("utf8");
  const pageMeasurement = measureActualPageSvg(pageSvg);
  if (!page.renderPath.toLowerCase().endsWith(".svg") || page.mediaType !== "image/svg+xml"
    || pageMeasurement.pageLocator !== page.pageLocator || pageMeasurement.figureSvgSha256 !== input.artifact.sha256
    || pageMeasurement.embeddedFigureSha256 !== input.artifact.sha256) {
    add(findings, "PP_FIGURE_RENDER_ARTIFACT_MISMATCH", "Actual SVG render does not bind the declared path, locator, or exact figure bytes.");
  }
  if (!pageMeasurement.isA4 || pageMeasurement.figureBoxes.some((box) => box.width > 180 || box.height > 247)) {
    add(findings, "PP_FIGURE_A4_FOOTPRINT", "Measured actual-page geometry does not fit the governed A4 page.");
  }
  if (!pageMeasurement.text.includes(input.spec.sourceCaption.text)) add(findings, "PP_FIGURE_CAPTION_MISSING", "The actual rendered page does not contain the governed source caption.");
  if (!pageMeasurement.text.some((text) => text.includes(input.spec.figureId))) add(findings, "PP_FIGURE_SECTION_CALLOUT_MISSING", "The actual rendered page does not call out the governed figure.");
  if (pageMeasurement.clipped > 0) add(findings, "PP_FIGURE_CLIPPING", "Actual-page marks or text bounding boxes are clipped.", { actual: pageMeasurement.clipped });
  if (pageMeasurement.labelCollisions > 0) add(findings, "PP_FIGURE_LABEL_COLLISION", "Actual-page text bounding boxes collide.", { actual: pageMeasurement.labelCollisions });
  if (pageMeasurement.repeatedGeometry > 2) add(findings, "PP_FIGURE_GEOMETRY_REPEATED", "Repeated actual-page figure geometry creates a card-wall pattern.", { actual: pageMeasurement.repeatedGeometry });
  if (expected !== undefined && pageMeasurement.figureSvgSha256 !== expected.sha256) add(findings, "PP_FIGURE_RENDER_ARTIFACT_MISMATCH", "Actual page embeds a figure other than the independently reconstructed artifact.");
}

function validateFinalRenderProvenance(
  page: FigureA4PageArtifact,
  reader: FigurePageArtifactReader,
  findings: AuditFinding[],
): boolean {
  const receipt = page.provenance.renderReceipt;
  const { receiptSha256: _receiptSha256, ...receiptPayload } = receipt;
  const structurallyValid = page.provenance.schemaVersion === "visual-evidence-page-provenance/v1"
    && receipt.schemaVersion === "kpp-final-render-receipt/v1"
    && receipt.receiptId.trim().length > 0
    && Number.isFinite(Date.parse(receipt.issuedAt))
    && receipt.renderer.name === KPP_FINAL_RENDERER_NAME
    && receipt.renderer.version === KPP_FINAL_RENDERER_VERSION
    && receipt.pageLocator === page.pageLocator
    && receipt.outputSha256 === page.sha256
    && receipt.receiptSha256 === sha256(canonicalFigureInputsJson(receiptPayload));
  if (!structurallyValid) {
    add(findings, "PP_FIGURE_RENDER_PROVENANCE_MISMATCH", "Final-render receipt identity or hash bindings are invalid.");
    return false;
  }
  try {
    const outputRealpath = reader.realpath(page.renderPath);
    const sourceRealpath = reader.realpath(receipt.sourceDocumentRealpath);
    const executableRealpath = reader.realpath(receipt.renderer.executableRealpath);
    const outputBytes = reader.readFile(outputRealpath);
    const sourceBytes = reader.readFile(sourceRealpath);
    const executableBytes = reader.readFile(executableRealpath);
    const validBytes = outputRealpath === receipt.outputRealpath
      && sourceRealpath === receipt.sourceDocumentRealpath
      && executableRealpath === receipt.renderer.executableRealpath
      && sha256Bytes(outputBytes) === receipt.outputSha256
      && sha256Bytes(sourceBytes) === receipt.sourceDocumentSha256
      && sha256Bytes(executableBytes) === receipt.renderer.executableSha256
      && Buffer.from(outputBytes).equals(Buffer.from(page.bytes));
    if (!validBytes) {
      add(findings, "PP_FIGURE_RENDER_PROVENANCE_MISMATCH", "Declared source, renderer, or output path bytes do not match the final-render receipt.");
      return false;
    }
  } catch (error) {
    add(findings, "PP_FIGURE_RENDER_PROVENANCE_MISMATCH", "Final-render provenance paths could not be independently read.", { actual: error instanceof Error ? error.message : String(error) });
    return false;
  }
  return true;
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

interface MeasuredBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

function measureActualPageSvg(svg: string): {
  readonly isA4: boolean;
  readonly pageLocator?: string;
  readonly figureSvgSha256?: string;
  readonly embeddedFigureSha256?: string;
  readonly figureBoxes: readonly MeasuredBox[];
  readonly text: readonly string[];
  readonly clipped: number;
  readonly labelCollisions: number;
  readonly repeatedGeometry: number;
} {
  const root = /<svg\b([^>]*)>/u.exec(svg)?.[1] ?? "";
  const viewBox = attribute(root, "viewBox")?.split(/\s+/u).map(Number);
  const isA4 = attribute(root, "width") === "210mm" && attribute(root, "height") === "297mm"
    && viewBox?.length === 4 && viewBox[0] === 0 && viewBox[1] === 0 && viewBox[2] === 210 && viewBox[3] === 297;
  const pageLocator = attribute(root, "data-page-locator");
  const figureSvgSha256 = attribute(root, "data-figure-svg-sha256");
  const figureImages = [...svg.matchAll(/<image\b([^>]*)data-kpp-role="figure"([^>]*)>/gu)].map((match) => `${match[1]} ${match[2]}`);
  const figureBoxes = figureImages.map(elementBox).filter(isMeasuredBox);
  const embeddedHref = figureImages.length === 1 ? attribute(figureImages[0]!, "href") : undefined;
  const embeddedFigureSha256 = embeddedHref?.startsWith("data:image/svg+xml;base64,") === true
    ? sha256Bytes(Buffer.from(embeddedHref.slice("data:image/svg+xml;base64,".length), "base64"))
    : undefined;
  const peerBoxes = [...svg.matchAll(/<rect\b([^>]*)data-kpp-role="peer-figure-box"([^>]*)>/gu)].map((match) => elementBox(`${match[1]} ${match[2]}`)).filter(isMeasuredBox);
  const textMatches = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu)];
  const text = textMatches.map((match) => decodeXml(match[2]!.replace(/<[^>]+>/gu, "")));
  const textBoxes = textMatches.map((match) => textBox(match[1]!, decodeXml(match[2]!.replace(/<[^>]+>/gu, "")))).filter(isMeasuredBox);
  const allBoxes = [...figureBoxes, ...peerBoxes, ...textBoxes];
  const clipped = allBoxes.filter((box) => box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 210 || box.y + box.height > 297).length;
  let labelCollisions = 0;
  for (let left = 0; left < textBoxes.length; left += 1) {
    for (let right = left + 1; right < textBoxes.length; right += 1) {
      if (overlap(textBoxes[left]!, textBoxes[right]!)) labelCollisions += 1;
    }
  }
  const dimensions = [...figureBoxes, ...peerBoxes].map((box) => `${box.width}\0${box.height}`);
  const repeatedGeometry = Math.max(0, ...dimensions.map((key) => dimensions.filter((candidate) => candidate === key).length));
  return { isA4, ...(pageLocator === undefined ? {} : { pageLocator }), ...(figureSvgSha256 === undefined ? {} : { figureSvgSha256 }), ...(embeddedFigureSha256 === undefined ? {} : { embeddedFigureSha256 }), figureBoxes, text, clipped, labelCollisions, repeatedGeometry };
}

function textBox(attributes: string, text: string): MeasuredBox | undefined {
  const explicit = {
    x: Number(attribute(attributes, "data-bbox-x")),
    y: Number(attribute(attributes, "data-bbox-y")),
    width: Number(attribute(attributes, "data-bbox-width")),
    height: Number(attribute(attributes, "data-bbox-height")),
  };
  if (Object.values(explicit).every(Number.isFinite)) return explicit;
  const x = Number(attribute(attributes, "x"));
  const baseline = Number(attribute(attributes, "y"));
  if (!Number.isFinite(x) || !Number.isFinite(baseline)) return undefined;
  return { x, y: baseline - 4, width: Math.max(1, [...text].length * 2.2), height: 6 };
}

function elementBox(attributes: string): MeasuredBox | undefined {
  const box = { x: Number(attribute(attributes, "x")), y: Number(attribute(attributes, "y")), width: Number(attribute(attributes, "width")), height: Number(attribute(attributes, "height")) };
  return Object.values(box).every(Number.isFinite) ? box : undefined;
}

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "u").exec(attributes)?.[1];
}

function isMeasuredBox(value: MeasuredBox | undefined): value is MeasuredBox { return value !== undefined; }
function overlap(left: MeasuredBox, right: MeasuredBox): boolean { return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y; }
function decodeXml(value: string): string { return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&"); }

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
