import { createHash } from "node:crypto";
import {
  VISUAL_EVIDENCE_RENDERER_VERSION,
  canonicalFigureInputsJson,
  compileFigureExpected,
  renderFigureA4Page,
  type FigureA4Context,
  type FigureA4PageArtifact,
  type GovernedFigureReference,
  type HumanFigureReview,
  type SemanticFigureSpecV1,
  type VisualEvidenceData,
  type VisualEvidenceFigureArtifact,
} from "@longtable/kpp-renderers";
import type { AuditFinding, AuditStatus } from "./source.js";

export interface FigureSemanticAuditInput {
  readonly spec: SemanticFigureSpecV1;
  readonly data: VisualEvidenceData;
  readonly references: readonly GovernedFigureReference[];
  readonly artifact: VisualEvidenceFigureArtifact;
  readonly pageContext: FigureA4Context;
  readonly pageArtifact: FigureA4PageArtifact;
  readonly humanReviews?: readonly HumanFigureReview[];
}

export interface FigureAuditReport {
  readonly schemaVersion: "figure-audit/v1";
  readonly figureId: string;
  readonly status: AuditStatus;
  readonly findings: readonly AuditFinding[];
  readonly auditorBoundary: "INDEPENDENT_QA_ONLY";
  readonly compilerApproval: "NOT_ACCEPTED";
  readonly humanApprovalStatus: SemanticFigureSpecV1["approvalStatus"];
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
  const context = input.pageContext;
  const box = context.figureBox;
  const pageInvalid = context.pageWidthMm !== 210 || context.pageHeightMm !== 297 || box.widthMm <= 0 || box.heightMm <= 0 || box.widthMm > 180 || box.heightMm > 247 || box.xMm < 0 || box.yMm < 0 || box.xMm + box.widthMm > context.pageWidthMm || box.yMm + box.heightMm > context.pageHeightMm;
  if (pageInvalid) add(findings, "PP_FIGURE_A4_FOOTPRINT", "Measured figure geometry does not fit the governed A4 page.", { actual: context });
  if (context.caption.trim().length === 0 || !input.pageArtifact.pageSvg.includes(escapeXml(context.caption))) add(findings, "PP_FIGURE_CAPTION_MISSING", "A source-bearing figure caption is required in the final page artifact.");
  if (context.sectionCallout.trim().length === 0 || !input.pageArtifact.pageSvg.includes(escapeXml(context.sectionCallout))) add(findings, "PP_FIGURE_SECTION_CALLOUT_MISSING", "The connected section must call out and interpret the figure.");
  const sameGeometry = [context.figureBox, ...context.peerFigureBoxes].filter((peer) => peer.widthMm === box.widthMm && peer.heightMm === box.heightMm).length;
  if (sameGeometry > 2) add(findings, "PP_FIGURE_GEOMETRY_REPEATED", "Repeated page-level figure geometry creates a card-wall pattern.", { actual: sameGeometry });
  if (expected !== undefined) {
    const expectedPage = renderFigureA4Page(expected, context);
    if (canonicalFigureInputsJson(input.pageArtifact) !== canonicalFigureInputsJson(expectedPage)) add(findings, "PP_FIGURE_PAGE_ARTIFACT_MISMATCH", "Final A4 page bytes, figure binding, locator, or geometry differ from reconstruction.");
  }
}

function auditHumanApproval(input: FigureSemanticAuditInput, expected: VisualEvidenceFigureArtifact | undefined, findings: AuditFinding[]): void {
  if (input.spec.approvalStatus !== "human_approved") return;
  const expectedPage = expected === undefined ? undefined : renderFigureA4Page(expected, input.pageContext);
  const complete = (input.humanReviews ?? []).filter((review) => {
    const { approvalReceiptSha256: _receipt, ...payload } = review;
    const current = expected !== undefined && expectedPage !== undefined && review.reviewedFigureSvgSha256 === expected.sha256 && review.reviewedFigureIrSha256 === expected.hashes.irSha256 && review.reviewedPageRenderSha256 === expectedPage.sha256 && review.pageLocator === input.pageContext.pageLocator && review.approvalReceiptSha256 === sha256(canonicalFigureInputsJson(payload));
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
function escapeXml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function artifactSemanticBytes(artifact: VisualEvidenceFigureArtifact): Omit<VisualEvidenceFigureArtifact, "approvalStatus"> { const { approvalStatus: _approval, ...semantic } = artifact; return semantic; }
function add(findings: AuditFinding[], code: string, message: string, detail: Omit<AuditFinding, "code" | "message"> = {}): void { findings.push({ code, message, ...detail }); }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function sortedUnique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function isString(value: string | undefined): value is string { return typeof value === "string" && value.length > 0; }
function isNumber(value: number | undefined): value is number { return typeof value === "number" && Number.isFinite(value); }
function compareFindings(left: AuditFinding, right: AuditFinding): number { return compareText(`${left.code}\0${left.message}`, `${right.code}\0${right.message}`); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
