import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

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
  pageId: IdentifierSchema,
  title: IdentifierSchema,
  intent: FigureIntentSchema,
  dataShape: FigureDataShapeSchema,
  decisionTask: IdentifierSchema,
  evidenceIds: z.array(IdentifierSchema),
  hasTimeAxis: z.boolean().optional().default(false),
  requestedFamily: RequestedFigureFamilySchema.optional(),
});

export const SemanticFigureSpecSchema = z.object({
  figureId: IdentifierSchema,
  pageId: IdentifierSchema,
  title: IdentifierSchema,
  intent: FigureIntentSchema,
  dataShape: FigureDataShapeSchema,
  decisionTask: IdentifierSchema,
  evidenceIds: z.array(IdentifierSchema).min(1),
  family: SemanticFigureFamilySchema,
  renderer: DeterministicFigureRendererSchema,
});

export const VisualRightsStatusSchema = z.enum([
  "issuer_provided",
  "public_reference",
  "licensed",
  "owned",
]);

export const VisualReferencePageSchema = z.object({
  path: z.string().min(1),
  sha256: Sha256Schema,
  language: z.literal("ko"),
  rightsStatus: VisualRightsStatusSchema,
  inspectedAt: z.string().datetime({ offset: true }),
});

export const VisualSourcePacketSchema = z.object({
  schemaVersion: z.string().min(1),
  referencePages: z.array(VisualReferencePageSchema).min(3),
}).superRefine((packet, context) => {
  if (!packet.referencePages.some(({ rightsStatus }) => rightsStatus === "issuer_provided")) {
    context.addIssue({
      code: "custom",
      message: "at least one issuer-provided Korean reference page is required",
      path: ["referencePages"],
    });
  }
  if (packet.referencePages.filter(({ rightsStatus }) => rightsStatus !== "issuer_provided").length < 2) {
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
  status: z.literal("composition_candidate"),
  directFinalUse: z.literal(false),
  finalEvidenceAllowed: z.literal(false),
  topologyOnly: z.literal(true),
});

export type DeterministicFigureRenderer = z.infer<typeof DeterministicFigureRendererSchema>;
export type FigureDataShape = z.infer<typeof FigureDataShapeSchema>;
export type FigureIntent = z.infer<typeof FigureIntentSchema>;
export type LockedResearchLogic = z.infer<typeof LockedResearchLogicSchema>;
export type RequestedFigureFamily = z.infer<typeof RequestedFigureFamilySchema>;
export type SemanticFigureFamily = z.infer<typeof SemanticFigureFamilySchema>;
export type SemanticFigureRequest = z.infer<typeof SemanticFigureRequestSchema>;
export type SemanticFigureSpec = z.infer<typeof SemanticFigureSpecSchema>;
export type TopologyStudyRequest = z.infer<typeof TopologyStudyRequestSchema>;
export type VisualReferencePage = z.infer<typeof VisualReferencePageSchema>;
export type VisualRightsStatus = z.infer<typeof VisualRightsStatusSchema>;
export type VisualSourcePacket = z.infer<typeof VisualSourcePacketSchema>;
