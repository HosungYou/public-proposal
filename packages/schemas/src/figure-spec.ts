import { z } from "zod";
import { EvidenceBindingSchema } from "./evidence.js";

const IdentifierSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SemanticRendererFingerprintSchema = z.object({
  renderer: z.object({ name: z.literal("@longtable/kpp-renderers"), version: z.literal("1.0.0") }).strict(),
  tokenProfile: z.object({ id: z.literal("R08-approved-project-profile"), sha256: z.literal("c6d87996c7ad2dfcce67b6d45373f30ff7026e33ba6fd05a22b1944cfa6f7afa") }).strict(),
  fontProfile: z.object({ id: z.literal("Noto-Sans-CJK-KR-2.004"), sha256: z.literal("0d0f75a19d1f9993378f58314cdbd7b3926ed6780fd6be2b031a0c67ddf9cd48") }).strict(),
  rasterizer: z.object({
    name: z.literal("LibreOffice"),
    executablePath: IdentifierSchema,
    executableSha256: Sha256Schema,
    version: z.string().regex(/^LibreOffice\s+\d+/),
  }).strict(),
}).strict();

export const FigureIntentSchema = z.enum([
  "schedule",
  "responsibility",
  "matrix",
  "comparison",
  "evidence_chain",
  "research_framework",
  "flow",
]);

export const FigureDataShapeSchema = z.enum([
  "time_axis",
  "responsibility_matrix",
  "two_by_two",
  "comparison_series",
  "evidence_links",
  "research_framework",
  "process_flow",
]);

export const SemanticFigureFamilySchema = z.enum([
  "gantt",
  "raci",
  "matrix",
  "comparison_chart",
  "evidence_chain",
  "framework",
  "flow",
]);

export const RequestedFigureFamilySchema = z.union([
  SemanticFigureFamilySchema,
  z.literal("generic_cards"),
]);

export const DeterministicFigureRendererSchema = z.enum([
  "svg-gantt",
  "word-native-raci-table",
  "svg-2x2-matrix",
  "svg-comparison-chart",
  "svg-evidence-chain",
  "svg-academic-framework",
  "svg-flow",
]);

export const SemanticFigureRequestSchema = z.object({
  figureId: IdentifierSchema,
  requirementId: IdentifierSchema,
  pageId: IdentifierSchema,
  title: IdentifierSchema,
  intent: FigureIntentSchema,
  dataShape: FigureDataShapeSchema,
  decisionTask: IdentifierSchema,
  claimIds: z.array(IdentifierSchema).min(1),
  evidenceIds: z.array(IdentifierSchema),
  hasTimeAxis: z.boolean().optional().default(false),
  requestedFamily: RequestedFigureFamilySchema.optional(),
});

const SemanticFigureSpecFieldsSchema = z.object({
  figureId: IdentifierSchema,
  requirementId: IdentifierSchema,
  pageId: IdentifierSchema,
  title: IdentifierSchema,
  intent: FigureIntentSchema,
  dataShape: FigureDataShapeSchema,
  decisionTask: IdentifierSchema,
  claimIds: z.array(IdentifierSchema).min(1),
  evidenceIds: z.array(IdentifierSchema).min(1),
  family: SemanticFigureFamilySchema,
  renderer: DeterministicFigureRendererSchema,
});

export const SemanticFigureSpecSchema = SemanticFigureSpecFieldsSchema.superRefine(
  validateSemanticFigureMapping,
);

export const RequirementFigureSpecSchema = SemanticFigureSpecFieldsSchema
  .omit({ requirementId: true, pageId: true })
  .superRefine(validateSemanticFigureMapping);

export const VisualRightsStatusSchema = z.enum([
  "issuer_provided",
  "public_reference",
  "licensed",
  "owned",
]);

export const VisualReferenceClassificationSchema = z.enum([
  "issuer_reference",
  "official_template",
  "report_reference",
]);

export const VisualReferencePageSchema = z.object({
  path: z.string().min(1),
  sha256: Sha256Schema,
  language: z.literal("ko"),
  rightsStatus: VisualRightsStatusSchema,
  classification: VisualReferenceClassificationSchema,
  sourceId: IdentifierSchema,
  pageLocator: IdentifierSchema,
  inspectedAt: z.string().datetime({ offset: true }),
}).strict();

export const VisualSourcePacketSchema = z.object({
  schemaVersion: z.string().min(1),
  referencePages: z.array(VisualReferencePageSchema).min(3),
}).superRefine((packet, context) => {
  if (!packet.referencePages.some((page) =>
    page.rightsStatus === "issuer_provided" && page.classification === "issuer_reference")) {
    context.addIssue({
      code: "custom",
      message: "at least one issuer-provided Korean reference page is required",
      path: ["referencePages"],
    });
  }
  const publicReferences = packet.referencePages.filter((page) =>
    (page.classification === "official_template" || page.classification === "report_reference")
    && (page.rightsStatus === "issuer_provided" || page.rightsStatus === "public_reference"),
  );
  if (publicReferences.length < 2) {
    context.addIssue({
      code: "custom",
      message: "two additional Korean public-document reference pages are required",
      path: ["referencePages"],
    });
  }
});

export const LockedResearchLogicSchema = z.object({
  logicId: IdentifierSchema,
  status: z.literal("locked"),
  path: z.string().min(1),
  sha256: Sha256Schema,
});

export const TopologyStudyRequestSchema = z.object({
  studyId: IdentifierSchema,
  figureId: IdentifierSchema,
  family: z.literal("framework"),
  renderer: z.literal("svg-academic-framework"),
  sourcePacketSha256: Sha256Schema,
  referencePages: z.array(VisualReferencePageSchema).min(3),
  researchLogic: LockedResearchLogicSchema,
  evidenceIds: z.array(IdentifierSchema).min(1),
  evidenceBindings: z.array(EvidenceBindingSchema).min(1),
  status: z.literal("composition_candidate"),
  directFinalUse: z.literal(false),
  finalEvidenceAllowed: z.literal(false),
  topologyOnly: z.literal(true),
});

/** Additive vNext schema; legacy SemanticFigureSpecSchema remains unchanged. */
export const EvidenceFigureRelationshipSchema = z.enum([
  "trend",
  "comparison",
  "composition",
  "matrix",
  "process",
  "framework",
]);

export const SourceCaptionV1Schema = z.object({
  text: IdentifierSchema,
  sourceIds: z.array(IdentifierSchema).min(1),
}).strict();

export const SemanticFigureSpecV1Schema = z.object({
  schemaVersion: z.literal("semantic-figure-spec/v1"),
  figureId: IdentifierSchema,
  requirementIds: z.array(IdentifierSchema),
  evidenceIds: z.array(IdentifierSchema).min(1),
  analyticalQuestion: IdentifierSchema,
  readerTask: IdentifierSchema,
  supportedTakeaway: IdentifierSchema,
  dataIds: z.array(IdentifierSchema).min(1),
  relationship: EvidenceFigureRelationshipSchema,
  minimumDataConditions: z.record(z.string().trim().min(1), z.union([z.number().finite(), z.boolean(), IdentifierSchema])),
  uncertainty: z.array(IdentifierSchema),
  sourceCaption: SourceCaptionV1Schema,
  targetSurface: z.enum(["A4_DOCX", "A4_PDF"]),
  referenceFamily: IdentifierSchema,
  rendererVersion: IdentifierSchema,
  rendererFingerprint: SemanticRendererFingerprintSchema,
  approvalStatus: z.enum(["candidate", "reviewed", "human_approved"]),
}).strict().superRefine((spec, context) => {
  const allowedFamilies = VNEXT_REFERENCE_FAMILIES[spec.relationship];
  if (!allowedFamilies.includes(spec.referenceFamily)) {
    context.addIssue({
      code: "custom",
      message: "semantic relationship and reference family must agree",
      path: ["referenceFamily"],
    });
  }
  if (spec.rendererVersion !== "1.0.0") {
    context.addIssue({
      code: "custom",
      message: "semantic figure renderer version does not match the vNext compiler",
      path: ["rendererVersion"],
    });
  }
});

export const GovernedFigureReferenceSchema = z.object({
  referenceId: IdentifierSchema,
  referenceFamily: IdentifierSchema,
  storageClass: z.enum([
    "private_source_reference",
    "extracted_visual_pattern",
    "public_canonical_fixture",
  ]),
  rightsStatus: z.enum(["approved", "licensed", "public_domain", "project_private"]),
  sourceSha256: Sha256Schema,
  pageLocator: IdentifierSchema,
  transferBoundary: IdentifierSchema,
  approved: z.boolean(),
  synthetic: z.boolean(),
  publiclyReleasable: z.boolean(),
  sourceLineageClass: z.enum(["public", "project_private"]),
}).strict().superRefine((reference, context) => {
  if (reference.storageClass === "public_canonical_fixture"
    && (!reference.synthetic || !reference.publiclyReleasable
      || reference.sourceLineageClass !== "public" || reference.rightsStatus === "project_private")) {
    context.addIssue({ code: "custom", message: "public canonical fixtures must be synthetic, publicly releasable, and public-lineage", path: ["storageClass"] });
  }
  if (reference.sourceLineageClass === "project_private"
    && reference.publiclyReleasable) {
    context.addIssue({ code: "custom", message: "project-private lineage must remain non-public", path: ["sourceLineageClass"] });
  }
  if (reference.rightsStatus === "project_private" && reference.sourceLineageClass !== "project_private") {
    context.addIssue({ code: "custom", message: "project-private rights require project-private source lineage", path: ["rightsStatus"] });
  }
});

export const HumanFigureReviewSchema = z.object({
  reviewId: IdentifierSchema,
  reviewerId: IdentifierSchema,
  reviewedAt: z.string().datetime({ offset: true }),
  reviewedFigureSvgSha256: Sha256Schema,
  reviewedFigureIrSha256: Sha256Schema,
  reviewedPageRenderSha256: Sha256Schema,
  pageLocator: IdentifierSchema,
  renderedInA4Context: z.boolean(),
  meaning: z.boolean(),
  trustworthiness: z.boolean(),
  documentFit: z.boolean(),
  sendReady: z.boolean(),
  approvalReceiptSha256: Sha256Schema,
}).strict();

export type DeterministicFigureRenderer = z.infer<typeof DeterministicFigureRendererSchema>;
export type FigureDataShape = z.infer<typeof FigureDataShapeSchema>;
export type FigureIntent = z.infer<typeof FigureIntentSchema>;
export type EvidenceFigureRelationship = z.infer<typeof EvidenceFigureRelationshipSchema>;
export type GovernedFigureReference = z.infer<typeof GovernedFigureReferenceSchema>;
export type HumanFigureReview = z.infer<typeof HumanFigureReviewSchema>;
export type LockedResearchLogic = z.infer<typeof LockedResearchLogicSchema>;
export type RequestedFigureFamily = z.infer<typeof RequestedFigureFamilySchema>;
export type RequirementFigureSpec = z.infer<typeof RequirementFigureSpecSchema>;
export type SemanticFigureFamily = z.infer<typeof SemanticFigureFamilySchema>;
export type SemanticFigureRequest = z.infer<typeof SemanticFigureRequestSchema>;
export type SemanticFigureSpec = z.infer<typeof SemanticFigureSpecSchema>;
export type SemanticFigureSpecV1 = z.infer<typeof SemanticFigureSpecV1Schema>;
export type TopologyStudyRequest = z.infer<typeof TopologyStudyRequestSchema>;
export type VisualReferencePage = z.infer<typeof VisualReferencePageSchema>;
export type VisualReferenceClassification = z.infer<typeof VisualReferenceClassificationSchema>;
export type VisualRightsStatus = z.infer<typeof VisualRightsStatusSchema>;
export type VisualSourcePacket = z.infer<typeof VisualSourcePacketSchema>;

function validateSemanticFigureMapping(
  figure: {
    readonly intent: z.infer<typeof FigureIntentSchema>;
    readonly dataShape: z.infer<typeof FigureDataShapeSchema>;
    readonly family: z.infer<typeof SemanticFigureFamilySchema>;
    readonly renderer: z.infer<typeof DeterministicFigureRendererSchema>;
  },
  context: z.RefinementCtx,
): void {
  const expectedIntentFamily = FAMILY_BY_INTENT[figure.intent];
  const expectedShapeFamily = FAMILY_BY_DATA_SHAPE[figure.dataShape];
  const expectedRenderer = RENDERER_BY_FAMILY[expectedIntentFamily];
  if (expectedIntentFamily !== expectedShapeFamily || figure.family !== expectedIntentFamily) {
    context.addIssue({
      code: "custom",
      message: "semantic figure intent, data shape, and family must agree",
      path: ["family"],
    });
  }
  if (figure.renderer !== expectedRenderer) {
    context.addIssue({
      code: "custom",
      message: "semantic figure family and deterministic renderer must agree",
      path: ["renderer"],
    });
  }
}

const FAMILY_BY_INTENT: Readonly<Record<z.infer<typeof FigureIntentSchema>, z.infer<typeof SemanticFigureFamilySchema>>> = {
  schedule: "gantt",
  responsibility: "raci",
  matrix: "matrix",
  comparison: "comparison_chart",
  evidence_chain: "evidence_chain",
  research_framework: "framework",
  flow: "flow",
};

const FAMILY_BY_DATA_SHAPE: Readonly<Record<z.infer<typeof FigureDataShapeSchema>, z.infer<typeof SemanticFigureFamilySchema>>> = {
  time_axis: "gantt",
  responsibility_matrix: "raci",
  two_by_two: "matrix",
  comparison_series: "comparison_chart",
  evidence_links: "evidence_chain",
  research_framework: "framework",
  process_flow: "flow",
};

const RENDERER_BY_FAMILY: Readonly<Record<z.infer<typeof SemanticFigureFamilySchema>, z.infer<typeof DeterministicFigureRendererSchema>>> = {
  gantt: "svg-gantt",
  raci: "word-native-raci-table",
  matrix: "svg-2x2-matrix",
  comparison_chart: "svg-comparison-chart",
  evidence_chain: "svg-evidence-chain",
  framework: "svg-academic-framework",
  flow: "svg-flow",
};

const VNEXT_REFERENCE_FAMILIES: Readonly<Record<z.infer<typeof EvidenceFigureRelationshipSchema>, readonly string[]>> = {
  trend: ["line", "time_trend", "time-trend", "gantt"],
  comparison: ["comparison", "comparison_chart", "bar"],
  composition: ["composition", "stacked_bar"],
  matrix: ["matrix", "requirement_matrix", "raci"],
  process: ["process", "flow", "evidence_chain"],
  framework: ["framework", "research_framework"],
};
