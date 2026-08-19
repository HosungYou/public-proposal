import { createHash } from "node:crypto";
import {
  VISUAL_EVIDENCE_RENDERER_VERSION,
  canonicalFigureInputsJson,
  semanticFigureCompileInput,
  type FigurePointLineage,
  type GovernedFigureReference,
  type SemanticFigureSpecV1,
  type VisualEvidenceData,
  type VisualEvidenceFigureArtifact,
} from "@longtable/kpp-renderers";
import type { AuditFinding, AuditStatus } from "./source.js";

const REFERENCE_STORAGE_CLASSES = new Set([
  "private_source_reference",
  "extracted_visual_pattern",
  "public_canonical_fixture",
]);
const REFERENCE_RIGHTS_STATUSES = new Set([
  "approved",
  "licensed",
  "public_domain",
  "project_private",
]);

export interface FigureRenderContext {
  readonly sourceIds: readonly string[];
  readonly units: readonly string[];
  readonly denominators: readonly string[];
  readonly scale: {
    readonly min: number;
    readonly max: number;
    readonly includeZero: boolean;
  };
  readonly labelCollisions: number;
  readonly clippedElements: number;
  readonly minimumContrastRatio: number;
  readonly grayscaleDistinct: boolean;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly captionPresent: boolean;
  readonly sectionCalloutPresent: boolean;
  readonly repeatedGeometryCount: number;
}

export interface HumanFigureReview {
  readonly reviewerId: string;
  readonly renderedInA4Context: boolean;
  readonly meaning: boolean;
  readonly trustworthiness: boolean;
  readonly documentFit: boolean;
  readonly sendReady: boolean;
}

export interface FigureSemanticAuditInput {
  readonly spec: SemanticFigureSpecV1;
  readonly data: VisualEvidenceData;
  readonly references: readonly GovernedFigureReference[];
  readonly artifact: VisualEvidenceFigureArtifact;
  readonly lineage: readonly FigurePointLineage[];
  readonly renderContext: FigureRenderContext;
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

/**
 * Pure independent QA. This function observes compiler output but cannot
 * promote approval state or issue a KPP figure lock.
 */
export function auditFigureSemantics(input: FigureSemanticAuditInput): FigureAuditReport {
  const findings: AuditFinding[] = [];
  auditInputBindings(input, findings);
  auditDataSemantics(input, findings);
  auditRenderContext(input, findings);
  auditHumanApproval(input, findings);
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

function auditInputBindings(input: FigureSemanticAuditInput, findings: AuditFinding[]): void {
  const { spec, data, references, artifact } = input;
  if (artifact.figureId !== spec.figureId || artifact.rendererVersion !== VISUAL_EVIDENCE_RENDERER_VERSION
    || spec.rendererVersion !== VISUAL_EVIDENCE_RENDERER_VERSION) {
    add(findings, "PP_FIGURE_RENDERER_MISMATCH", "Figure identity or renderer version does not match the audited spec.", {
      expected: { figureId: spec.figureId, rendererVersion: VISUAL_EVIDENCE_RENDERER_VERSION },
      actual: { figureId: artifact.figureId, rendererVersion: artifact.rendererVersion, specRendererVersion: spec.rendererVersion },
    });
  }
  if (artifact.compilerApproval !== "not_authorized") {
    add(findings, "PP_FIGURE_COMPILER_SELF_APPROVAL", "The compiler is not authorized to approve its own final figure.");
  }
  const expected = {
    specSha256: sha256(canonicalFigureInputsJson(semanticFigureCompileInput(spec))),
    dataSha256: sha256(canonicalFigureInputsJson(data)),
    referencesSha256: sha256(canonicalFigureInputsJson([...references].sort((left, right) => compareText(left.referenceId, right.referenceId)))),
    irSha256: sha256(canonicalFigureInputsJson(artifact.ir)),
    outputSha256: sha256(artifact.svg),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (artifact.hashes[key as keyof typeof expected] !== value) {
      add(findings, "PP_FIGURE_HASH_LINEAGE_MISMATCH", `Figure ${key} does not match the independently recomputed hash.`, {
        expected: value,
        actual: artifact.hashes[key as keyof typeof expected],
      });
    }
  }
  if (artifact.sha256 !== expected.outputSha256 || artifact.hashes.outputSha256 !== artifact.sha256) {
    add(findings, "PP_FIGURE_OUTPUT_HASH_MISMATCH", "Figure SVG bytes do not match the declared output hash.");
  }
  const expectedAggregateLineage = {
    dataIds: sortedUnique(spec.dataIds),
    sourceIds: sortedUnique(input.lineage.map((entry) => entry.sourceId)),
    claimIds: sortedUnique(input.lineage.flatMap((entry) => entry.claimIds)),
    referenceIds: sortedUnique(references.map((reference) => reference.referenceId)),
  };
  if (!sameStrings(artifact.lineage.dataIds, expectedAggregateLineage.dataIds)
    || !sameStrings(artifact.lineage.sourceIds, expectedAggregateLineage.sourceIds)
    || !sameStrings(artifact.lineage.claimIds, expectedAggregateLineage.claimIds)
    || !sameStrings(artifact.lineage.referenceIds, expectedAggregateLineage.referenceIds)) {
    add(findings, "PP_FIGURE_LINEAGE_MISMATCH", "Artifact-level source, data, claim, or reference lineage differs from point lineage.", {
      expected: expectedAggregateLineage,
      actual: artifact.lineage,
    });
  }
  if (references.length === 0 || references.some((reference) => !reference.approved
    || !REFERENCE_STORAGE_CLASSES.has(reference.storageClass)
    || !REFERENCE_RIGHTS_STATUSES.has(reference.rightsStatus)
    || reference.referenceFamily !== spec.referenceFamily
    || reference.pageLocator.trim().length === 0
    || reference.transferBoundary.trim().length === 0
    || !/^[a-f0-9]{64}$/u.test(reference.sourceSha256))) {
    add(findings, "PP_FIGURE_REFERENCE_UNGOVERNED", "Every visual reference requires approval, rights, source hash, locator, family, and transfer boundary.");
  }

  const expectedLineageKeys = new Set(data.datasets.flatMap((dataset) =>
    dataset.observations.map((observation) => `${dataset.dataId}\0${observation.observationId}`),
  ));
  const actualLineageKeys = new Set(input.lineage.map((entry) => `${entry.dataId}\0${entry.observationId}`));
  const validLineage = input.lineage.length === expectedLineageKeys.size
    && input.lineage.every((entry) => expectedLineageKeys.has(`${entry.dataId}\0${entry.observationId}`)
      && /^[a-f0-9]{64}$/u.test(entry.sourceSha256)
      && entry.sourceId.trim().length > 0
      && entry.rawLocator.trim().length > 0
      && entry.claimIds.length > 0)
    && [...expectedLineageKeys].every((key) => actualLineageKeys.has(key));
  if (!validLineage) {
    add(findings, "PP_FIGURE_LINEAGE_MISSING", "Every plotted point, cell, node, and edge must resolve to raw-source and claim lineage.", {
      expected: [...expectedLineageKeys].sort(),
      actual: [...actualLineageKeys].sort(),
    });
  }
}

function auditDataSemantics(input: FigureSemanticAuditInput, findings: AuditFinding[]): void {
  const selected = input.data.datasets.filter((dataset) => input.spec.dataIds.includes(dataset.dataId));
  if (selected.length !== input.spec.dataIds.length) {
    add(findings, "PP_FIGURE_DATA_ID_MISMATCH", "Semantic figure data IDs do not resolve to a unique dataset set.");
  }
  const datasetSources = sortedUnique(selected.flatMap((dataset) => dataset.sourceIds));
  const observationSources = sortedUnique(selected.flatMap((dataset) => dataset.observations.map((observation) => observation.sourceId)));
  const captionSources = sortedUnique(input.spec.sourceCaption.sourceIds);
  const renderedSources = sortedUnique(input.renderContext.sourceIds);
  if (!sameStrings(datasetSources, observationSources)
    || !sameStrings(datasetSources, captionSources)
    || !sameStrings(datasetSources, renderedSources)) {
    add(findings, "PP_FIGURE_SOURCE_DATA_MISMATCH", "Dataset, source caption, and rendered source IDs differ.", {
      expected: datasetSources,
      actual: { observationSources, captionSources, renderedSources },
    });
  }

  const datasetUnits = sortedUnique(selected.map((dataset) => dataset.unit).filter(isString));
  const renderedUnits = sortedUnique(input.renderContext.units);
  if (datasetUnits.length > 1 || !sameStrings(datasetUnits, renderedUnits)) {
    add(findings, "PP_FIGURE_UNIT_MISMATCH", "Figure values do not share one comparable declared unit.", {
      expected: datasetUnits,
      actual: renderedUnits,
    });
  }
  const datasetDenominators = sortedUnique(selected.map((dataset) => dataset.denominator).filter(isString));
  const renderedDenominators = sortedUnique(input.renderContext.denominators);
  if (datasetDenominators.length > 1 || !sameStrings(datasetDenominators, renderedDenominators)) {
    add(findings, "PP_FIGURE_DENOMINATOR_MISMATCH", "Figure values do not share one comparable denominator.", {
      expected: datasetDenominators,
      actual: renderedDenominators,
    });
  }

  const observations = selected.flatMap((dataset) => dataset.observations);
  if (input.spec.relationship === "trend") {
    const configured = input.spec.minimumDataConditions.minimumTemporalObservations;
    const minimum = typeof configured === "number" ? Math.max(8, configured) : 8;
    const temporal = observations.filter((observation) => observation.period !== undefined && observation.value !== undefined);
    if (temporal.length < minimum) {
      add(findings, "PP_FIGURE_SAMPLE_INSUFFICIENT", "A time-trend line requires at least eight temporal observations.", {
        expected: minimum,
        actual: temporal.length,
      });
    }
  }

  const values = observations.map((observation) => observation.value).filter(isNumber);
  if (values.length > 0) {
    const valueMin = Math.min(...values);
    const valueMax = Math.max(...values);
    const scale = input.renderContext.scale;
    const truncatesNonnegativeScale = valueMin >= 0 && (!scale.includeZero || scale.min > 0);
    if (!Number.isFinite(scale.min) || !Number.isFinite(scale.max) || scale.min >= scale.max
      || scale.min > valueMin || scale.max < valueMax || truncatesNonnegativeScale) {
      add(findings, "PP_FIGURE_SCALE_DISHONEST", "The declared scale clips values or exaggerates a nonnegative comparison.", {
        expected: { contains: [valueMin, valueMax], includeZero: valueMin >= 0 },
        actual: scale,
      });
    }
  }
}

function auditRenderContext(input: FigureSemanticAuditInput, findings: AuditFinding[]): void {
  const context = input.renderContext;
  if (context.labelCollisions > 0) add(findings, "PP_FIGURE_LABEL_COLLISION", "Figure labels collide at final insertion size.", { actual: context.labelCollisions });
  if (context.clippedElements > 0) add(findings, "PP_FIGURE_CLIPPING", "Figure elements are clipped by the viewBox or page frame.", { actual: context.clippedElements });
  if (context.minimumContrastRatio < 4.5) add(findings, "PP_FIGURE_CONTRAST", "Text or essential marks do not meet a 4.5:1 contrast ratio.", { expected: 4.5, actual: context.minimumContrastRatio });
  if (!context.grayscaleDistinct) add(findings, "PP_FIGURE_GRAYSCALE", "Essential series or states are not distinguishable in grayscale.");
  if (context.widthMm <= 0 || context.heightMm <= 0 || context.widthMm > 180 || context.heightMm > 247) {
    add(findings, "PP_FIGURE_A4_FOOTPRINT", "Figure footprint does not fit the governed A4 content area.", {
      expected: { maximumWidthMm: 180, maximumHeightMm: 247 },
      actual: { widthMm: context.widthMm, heightMm: context.heightMm },
    });
  }
  if (!context.captionPresent || input.spec.sourceCaption.text.trim().length === 0) add(findings, "PP_FIGURE_CAPTION_MISSING", "A source-bearing figure caption is required.");
  if (!context.sectionCalloutPresent) add(findings, "PP_FIGURE_SECTION_CALLOUT_MISSING", "The connected section must call out and interpret the figure.");
  if (context.repeatedGeometryCount > 2) add(findings, "PP_FIGURE_GEOMETRY_REPEATED", "Repeated page-level figure geometry creates a card-wall or clutter pattern.", { actual: context.repeatedGeometryCount });
}

function auditHumanApproval(input: FigureSemanticAuditInput, findings: AuditFinding[]): void {
  if (input.spec.approvalStatus !== "human_approved") return;
  const reviews = input.humanReviews ?? [];
  const complete = reviews.filter((review) => review.reviewerId.trim().length > 0
    && review.renderedInA4Context
    && review.meaning
    && review.trustworthiness
    && review.documentFit
    && review.sendReady);
  if (complete.length < 2 || new Set(complete.map((review) => review.reviewerId)).size < 2) {
    add(findings, "PP_FIGURE_HUMAN_APPROVAL_INCOMPLETE", "human_approved requires two independent complete reviews in final A4 page context.", {
      expected: 2,
      actual: new Set(complete.map((review) => review.reviewerId)).size,
    });
  }
}

function add(findings: AuditFinding[], code: string, message: string, detail: Omit<AuditFinding, "code" | "message"> = {}): void {
  findings.push({ code, message, ...detail });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareFindings(left: AuditFinding, right: AuditFinding): number {
  return compareText(`${left.code}\0${left.message}`, `${right.code}\0${right.message}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
