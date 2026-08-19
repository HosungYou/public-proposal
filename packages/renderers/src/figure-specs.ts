import {
  R08_TOKEN_PROFILE,
  R08_TOKEN_PROFILE_SHA256,
  VISUAL_EVIDENCE_FONT_PROFILE,
  VISUAL_EVIDENCE_FONT_PROFILE_SHA256,
  VISUAL_EVIDENCE_RENDERER_NAME,
  VISUAL_EVIDENCE_RENDERER_VERSION,
  stableCanonicalJson,
  type CanonicalFigureIR,
  type CanonicalFigureMark,
  type FigurePointLineage,
  type FigureRelationship,
  type GovernedFigureReference,
  type LegacySemanticFigureCompatibility,
  type SemanticFigureSpecV1,
  type SemanticFigureSpecV1_1,
  type VisualEvidenceData,
  type VisualEvidenceIrFamily,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
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

const IR_FAMILY_BY_RELATIONSHIP: Readonly<Record<FigureRelationship, VisualEvidenceIrFamily>> = {
  trend: "time-trend",
  comparison: "comparison",
  composition: "composition",
  matrix: "requirement-matrix",
  process: "process",
  framework: "research-framework",
};

const REFERENCE_FAMILIES: Readonly<Record<FigureRelationship, readonly string[]>> = {
  trend: ["line", "time_trend", "time-trend", "gantt"],
  comparison: ["comparison", "comparison_chart", "bar"],
  composition: ["composition", "stacked_bar"],
  matrix: ["matrix", "requirement_matrix", "raci"],
  process: ["process", "flow", "evidence_chain"],
  framework: ["framework", "research_framework"],
};

export interface CanonicalFigureInputs {
  readonly ir: CanonicalFigureIR;
  readonly pointLineage: readonly FigurePointLineage[];
  readonly references: readonly GovernedFigureReference[];
}

export function buildCanonicalFigureIR(
  spec: SemanticFigureSpecV1_1,
  data: VisualEvidenceData,
  references: readonly GovernedFigureReference[],
): CanonicalFigureInputs {
  assertSemanticFigureSpec(spec);
  assertVisualEvidenceData(data);
  const approvedReferences = assertGovernedReferences(spec, references);
  const datasetsById = new Map(data.datasets.map((dataset) => [dataset.dataId, dataset] as const));
  const selected = spec.dataIds.map((dataId) => {
    const dataset = datasetsById.get(dataId);
    if (dataset === undefined) throw new Error(`Semantic figure data ID ${dataId} has no matching dataset`);
    return dataset;
  });
  if (datasetsById.size !== data.datasets.length) throw new Error("Visual evidence dataset IDs must be unique");

  const marks: CanonicalFigureMark[] = [];
  const pointLineage: FigurePointLineage[] = [];
  for (const dataset of selected) {
    for (const observation of sortedObservations(dataset.observations)) {
      marks.push({
        id: observation.observationId,
        label: observation.label,
        ...(observation.value === undefined ? {} : { value: observation.value }),
        ...(observation.period === undefined ? {} : { period: observation.period }),
        ...(observation.category === undefined ? {} : { category: observation.category }),
        ...(observation.row === undefined ? {} : { row: observation.row }),
        ...(observation.column === undefined ? {} : { column: observation.column }),
        ...(observation.nodeId === undefined ? {} : { nodeId: observation.nodeId }),
        ...(observation.layer === undefined ? {} : { layer: observation.layer }),
        ...(observation.from === undefined ? {} : { from: observation.from }),
        ...(observation.to === undefined ? {} : { to: observation.to }),
        dataId: dataset.dataId,
        sourceId: observation.sourceId,
        sourceSha256: observation.sourceSha256,
        rawLocator: observation.rawLocator,
        claimIds: [...observation.claimIds].sort(),
        evidenceIds: [...spec.evidenceIds].sort(),
      });
      pointLineage.push({
        dataId: dataset.dataId,
        observationId: observation.observationId,
        sourceId: observation.sourceId,
        sourceSha256: observation.sourceSha256,
        rawLocator: observation.rawLocator,
        claimIds: [...observation.claimIds].sort(),
        evidenceIds: [...spec.evidenceIds].sort(),
      });
    }
  }

  assertFamilyData(spec.relationship, marks);
  const units = unique(selected.map((dataset) => dataset.unit).filter(isString));
  const denominators = unique(selected.map((dataset) => dataset.denominator).filter(isString));
  const ir: CanonicalFigureIR = {
    schemaVersion: "visual-evidence-ir/v1",
    figureId: spec.figureId,
    family: IR_FAMILY_BY_RELATIONSHIP[spec.relationship],
    analyticalQuestion: spec.analyticalQuestion,
    readerTask: spec.readerTask,
    supportedTakeaway: spec.supportedTakeaway,
    sourceCaption: spec.sourceCaption.text,
    uncertainty: [...spec.uncertainty],
    ...(units.length === 1 ? { unit: units[0] } : {}),
    ...(denominators.length === 1 ? { denominator: denominators[0] } : {}),
    marks,
  };
  return { ir, pointLineage, references: approvedReferences };
}

export function canonicalFigureInputsJson(value: unknown): string {
  return stableCanonicalJson(value);
}

/** Approval is a downstream governance fact, not a render-semantic input. */
export function semanticFigureCompileInput(spec: SemanticFigureSpecV1_1): Omit<SemanticFigureSpecV1_1, "approvalStatus"> {
  const { approvalStatus: _approvalStatus, ...semanticInput } = spec;
  return semanticInput;
}

export function adaptLegacySemanticFigureSpec(
  spec: SemanticFigureSpecV1,
  compatibility: LegacySemanticFigureCompatibility,
): SemanticFigureSpecV1_1 {
  return {
    ...spec,
    schemaVersion: "semantic-figure-spec/v1.1",
    evidenceIds: [...compatibility.evidenceIds],
    rendererFingerprint: compatibility.rendererFingerprint,
  };
}

function assertSemanticFigureSpec(spec: SemanticFigureSpecV1_1): void {
  if (spec.schemaVersion !== "semantic-figure-spec/v1.1") throw new Error("vNext visual compilation requires semantic-figure-spec/v1.1; adapt legacy v1 explicitly");
  for (const [field, value] of Object.entries({
    figureId: spec.figureId,
    analyticalQuestion: spec.analyticalQuestion,
    readerTask: spec.readerTask,
    supportedTakeaway: spec.supportedTakeaway,
    sourceCaption: spec.sourceCaption.text,
    referenceFamily: spec.referenceFamily,
    rendererVersion: spec.rendererVersion,
  })) assertText(value, field);
  if (spec.dataIds.length === 0 || new Set(spec.dataIds).size !== spec.dataIds.length) {
    throw new Error("Semantic figure data IDs must be a non-empty unique list");
  }
  if (spec.evidenceIds.length === 0 || new Set(spec.evidenceIds).size !== spec.evidenceIds.length) {
    throw new Error("Semantic figure evidence IDs must be a non-empty unique list");
  }
  if (!(spec.relationship in IR_FAMILY_BY_RELATIONSHIP)) throw new Error("Unsupported semantic figure relationship");
  if (!REFERENCE_FAMILIES[spec.relationship].includes(spec.referenceFamily)) {
    throw new Error(`Semantic relationship and reference family mismatch: ${spec.relationship}/${spec.referenceFamily}`);
  }
  if (spec.rendererVersion !== VISUAL_EVIDENCE_RENDERER_VERSION) {
    throw new Error(`Semantic figure renderer version ${spec.rendererVersion} does not match renderer version ${VISUAL_EVIDENCE_RENDERER_VERSION}`);
  }
  const fingerprint = spec.rendererFingerprint;
  if (fingerprint?.renderer.name !== VISUAL_EVIDENCE_RENDERER_NAME
    || fingerprint.renderer.version !== VISUAL_EVIDENCE_RENDERER_VERSION
    || fingerprint.tokenProfile.id !== R08_TOKEN_PROFILE
    || fingerprint.tokenProfile.sha256 !== R08_TOKEN_PROFILE_SHA256
    || fingerprint.fontProfile.id !== VISUAL_EVIDENCE_FONT_PROFILE
    || fingerprint.fontProfile.sha256 !== VISUAL_EVIDENCE_FONT_PROFILE_SHA256
    || !validFileFingerprints(fingerprint.fontProfile.files)
    || fingerprint.rasterizer.name !== "LibreOffice"
    || fingerprint.rasterizer.executablePath.trim().length === 0
    || !SHA256.test(fingerprint.rasterizer.executableSha256)
    || !/^LibreOffice\s+\d+/u.test(fingerprint.rasterizer.version)
    || fingerprint.rasterizer.bundlePath.trim().length === 0
    || !validFileFingerprints(fingerprint.rasterizer.bundleResources)
    || fingerprint.environment.locale.trim().length === 0
    || fingerprint.environment.operatingSystem.trim().length === 0
    || fingerprint.environment.architecture.trim().length === 0
    || fingerprint.environment.runtime.name.trim().length === 0
    || fingerprint.environment.runtime.version.trim().length === 0) {
    throw new Error("Semantic renderer fingerprint is missing or does not match the locked renderer, token, font, and LibreOffice identities");
  }
  if (spec.targetSurface !== "A4_DOCX" && spec.targetSurface !== "A4_PDF") throw new Error("Semantic figure target surface must be A4 DOCX or PDF");
  if (!new Set(["candidate", "reviewed", "human_approved"]).has(spec.approvalStatus)) throw new Error("Semantic figure approval status is invalid");
  if (spec.sourceCaption.sourceIds.length === 0) throw new Error("Semantic figure source caption requires source IDs");
}

function assertVisualEvidenceData(data: VisualEvidenceData): void {
  if (!Array.isArray(data.datasets) || data.datasets.length === 0) throw new Error("Visual evidence data requires datasets");
  for (const dataset of data.datasets) {
    assertText(dataset.dataId, "dataId");
    if (dataset.sourceIds.length === 0 || dataset.observations.length === 0) throw new Error(`Dataset ${dataset.dataId} must have sources and observations`);
    const observationIds = new Set<string>();
    for (const observation of dataset.observations) {
      assertText(observation.observationId, "observationId");
      assertText(observation.label, "label");
      assertText(observation.sourceId, "sourceId");
      assertText(observation.rawLocator, "rawLocator");
      if (!SHA256.test(observation.sourceSha256)) throw new Error(`Observation ${observation.observationId} has an invalid source hash`);
      if (observation.claimIds.length === 0) throw new Error(`Observation ${observation.observationId} requires claim IDs`);
      if (observation.value !== undefined && !Number.isFinite(observation.value)) throw new Error("Figure values must be finite numbers");
      if (observationIds.has(observation.observationId)) throw new Error(`Dataset ${dataset.dataId} observation IDs must be unique`);
      observationIds.add(observation.observationId);
    }
  }
}

function assertGovernedReferences(
  spec: SemanticFigureSpecV1_1,
  references: readonly GovernedFigureReference[],
): readonly GovernedFigureReference[] {
  if (references.length === 0) throw new Error("At least one approved reference binding is required");
  const sorted = [...references].sort((left, right) => compareText(left.referenceId, right.referenceId));
  if (new Set(sorted.map((reference) => reference.referenceId)).size !== sorted.length) throw new Error("Approved reference IDs must be unique");
  for (const reference of sorted) {
    assertText(reference.referenceId, "referenceId");
    assertText(reference.pageLocator, "pageLocator");
    assertText(reference.transferBoundary, "transferBoundary");
    if (!reference.approved || !REFERENCE_RIGHTS_STATUSES.has(reference.rightsStatus)) {
      throw new Error("Only approved reference bindings with governed rights may be used");
    }
    if (!REFERENCE_STORAGE_CLASSES.has(reference.storageClass)) throw new Error("Reference storage class is not governed");
    if (!SHA256.test(reference.sourceSha256)) throw new Error(`Reference ${reference.referenceId} has an invalid source hash`);
    if (reference.referenceFamily !== spec.referenceFamily) throw new Error("Approved reference family does not match the semantic spec");
    if (reference.storageClass === "public_canonical_fixture"
      && (!reference.synthetic || !reference.publiclyReleasable
        || reference.sourceLineageClass !== "public"
        || !new Set(["licensed", "public_domain"]).has(reference.rightsStatus))) {
      throw new Error("Public canonical fixtures must be synthetic, publicly releasable, public-lineage, and carry public rights");
    }
    if (reference.storageClass === "private_source_reference"
      && (reference.synthetic || reference.publiclyReleasable
        || reference.sourceLineageClass !== "project_private" || reference.rightsStatus !== "project_private")) {
      throw new Error("Private source references must remain non-synthetic, non-public, project-private lineage and rights");
    }
    if (reference.sourceLineageClass === "project_private" && reference.publiclyReleasable
      && (reference.storageClass !== "extracted_visual_pattern"
        || !reference.humanPromoted || reference.transferBoundary.trim().length === 0
        || !new Set(["approved", "licensed"]).has(reference.rightsStatus))) {
      throw new Error("Private-source lineage may be released only as a bounded, human-promoted extracted pattern");
    }
    if (reference.rightsStatus === "project_private" && reference.sourceLineageClass !== "project_private") {
      throw new Error("Project-private rights require project-private source lineage");
    }
  }
  return sorted;
}

function validFileFingerprints(files: readonly { readonly path: string; readonly sha256: string }[] | undefined): boolean {
  return Array.isArray(files) && files.length > 0
    && new Set(files.map((file) => file.path)).size === files.length
    && files.every((file) => file.path.trim().length > 0 && SHA256.test(file.sha256));
}

function assertFamilyData(relationship: FigureRelationship, marks: readonly CanonicalFigureMark[]): void {
  if (relationship === "trend" && marks.some((mark) => mark.period === undefined || mark.value === undefined)) {
    throw new Error("Trend figures require a period and value for every mark");
  }
  if ((relationship === "comparison" || relationship === "composition")
    && marks.some((mark) => mark.category === undefined || mark.value === undefined)) {
    throw new Error(`${relationship} figures require a category and value for every mark`);
  }
  if (relationship === "matrix" && marks.some((mark) => mark.row === undefined || mark.column === undefined)) {
    throw new Error("Matrix figures require row and column values for every mark");
  }
  if (relationship === "process" || relationship === "framework") {
    const nodes = new Set(marks.filter((mark) => mark.nodeId !== undefined).map((mark) => mark.nodeId));
    const edges = marks.filter((mark) => mark.from !== undefined || mark.to !== undefined);
    if (nodes.size < 2 || edges.length === 0 || edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))) {
      throw new Error(`${relationship} figures require at least two nodes and valid edges`);
    }
  }
}

function sortedObservations<T extends { readonly observationId: string; readonly period?: string; readonly row?: string; readonly column?: string; readonly category?: string }>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => compareText(observationKey(left), observationKey(right)));
}

function observationKey(value: { readonly observationId: string; readonly period?: string; readonly row?: string; readonly column?: string; readonly category?: string }): string {
  return [value.period, value.row, value.column, value.category, value.observationId].map((item) => item ?? "").join("\0");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function assertText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
