import { z } from "zod";
import { EvidenceBindingSchema } from "./evidence.js";

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

/**
 * The single reader-facing value a non-decorative figure is allowed to add.
 * A family (Gantt, RACI, framework, …) describes rendering structure; this
 * intent describes the decision value of the rendered surface.
 */
export const FigureSemanticValueIntentSchema = z.enum([
  "data_evidence",
  "causal_mechanism",
  "decision_tradeoff",
  "operational_control",
  "decorative",
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
  "svg-raci-matrix",
  "svg-2x2-matrix",
  "svg-comparison-chart",
  "svg-evidence-chain",
  "svg-academic-framework",
  "svg-flow",
]);

const FigureSemanticValueDeclarationSchema = z.object({
  semanticValueIntent: FigureSemanticValueIntentSchema,
  decisionEffect: z.string().trim(),
  nonDuplicateOf: z.array(IdentifierSchema),
  encodedVariables: z.array(IdentifierSchema),
});

export const SemanticFigureRequestSchema = z.object({
  figureId: IdentifierSchema,
  requirementId: IdentifierSchema,
  pageId: IdentifierSchema,
  title: IdentifierSchema,
  intent: FigureIntentSchema,
  dataShape: FigureDataShapeSchema,
  decisionTask: IdentifierSchema,
  claimIds: z.array(IdentifierSchema),
  evidenceIds: z.array(IdentifierSchema),
  hasTimeAxis: z.boolean().optional().default(false),
  requestedFamily: RequestedFigureFamilySchema.optional(),
}).extend(FigureSemanticValueDeclarationSchema.shape).superRefine(validateSemanticFigureRequestValue);

const SemanticFigureSpecFieldsSchema = z.object({
  figureId: IdentifierSchema,
  requirementId: IdentifierSchema,
  pageId: IdentifierSchema,
  title: IdentifierSchema,
  intent: FigureIntentSchema,
  dataShape: FigureDataShapeSchema,
  decisionTask: IdentifierSchema,
  claimIds: z.array(IdentifierSchema),
  evidenceIds: z.array(IdentifierSchema),
  family: SemanticFigureFamilySchema,
  renderer: DeterministicFigureRendererSchema,
}).extend(FigureSemanticValueDeclarationSchema.shape);

export const SemanticFigureSpecSchema = SemanticFigureSpecFieldsSchema.superRefine(
  (figure, context) => {
    validateSemanticFigureMapping(figure, context);
    validateSemanticFigureValue(figure, context);
  },
);

export const RequirementFigureSpecSchema = SemanticFigureSpecFieldsSchema
  .omit({ requirementId: true, pageId: true })
  .superRefine((figure, context) => {
    validateSemanticFigureMapping(figure, context);
    validateSemanticFigureValue(figure, context);
  });

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

export type DeterministicFigureRenderer = z.infer<typeof DeterministicFigureRendererSchema>;
export type FigureDataShape = z.infer<typeof FigureDataShapeSchema>;
export type FigureIntent = z.infer<typeof FigureIntentSchema>;
export type FigureSemanticValueIntent = z.infer<typeof FigureSemanticValueIntentSchema>;
export type LockedResearchLogic = z.infer<typeof LockedResearchLogicSchema>;
export type RequestedFigureFamily = z.infer<typeof RequestedFigureFamilySchema>;
export type RequirementFigureSpec = z.infer<typeof RequirementFigureSpecSchema>;
export type SemanticFigureFamily = z.infer<typeof SemanticFigureFamilySchema>;
export type SemanticFigureRequest = z.infer<typeof SemanticFigureRequestSchema>;
export type SemanticFigureSpec = z.infer<typeof SemanticFigureSpecSchema>;
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
  const rasterRaciException = figure.family === "raci" && figure.renderer === "svg-raci-matrix";
  if (figure.renderer !== expectedRenderer && !rasterRaciException) {
    context.addIssue({
      code: "custom",
      message: "semantic figure family and deterministic renderer must agree",
      path: ["renderer"],
    });
  }
}

function validateSemanticFigureValue(
  figure: {
    readonly semanticValueIntent: z.infer<typeof FigureSemanticValueIntentSchema>;
    readonly decisionEffect: string;
    readonly nonDuplicateOf: readonly string[];
    readonly encodedVariables: readonly string[];
    readonly claimIds: readonly string[];
    readonly evidenceIds: readonly string[];
  },
  context: z.RefinementCtx,
): void {
  const decorative = figure.semanticValueIntent === "decorative";
  if (decorative) {
    if (figure.decisionEffect.length > 0) {
      context.addIssue({ code: "custom", message: "decorative figures must not declare a decision effect", path: ["decisionEffect"] });
    }
    for (const field of ["nonDuplicateOf", "encodedVariables", "claimIds", "evidenceIds"] as const) {
      if (figure[field].length > 0) {
        context.addIssue({ code: "custom", message: "decorative figures must not carry evidentiary bindings", path: [field] });
      }
    }
    return;
  }
  if (figure.decisionEffect.length === 0) {
    context.addIssue({ code: "custom", message: "non-decorative figures must declare the decision effect", path: ["decisionEffect"] });
  }
  for (const field of ["nonDuplicateOf", "encodedVariables", "claimIds", "evidenceIds"] as const) {
    if (figure[field].length === 0) {
      context.addIssue({ code: "custom", message: "non-decorative figures require explicit semantic value bindings", path: [field] });
    }
  }
}

/**
 * The planner emits the stable KPP_EVIDENCE_FIGURE_UNBOUND diagnostic for a
 * missing evidence set, so request parsing intentionally leaves that one
 * check to the planner. Persisted semantic figure specs remain strict.
 */
function validateSemanticFigureRequestValue(
  figure: {
    readonly semanticValueIntent: z.infer<typeof FigureSemanticValueIntentSchema>;
    readonly decisionEffect: string;
    readonly nonDuplicateOf: readonly string[];
    readonly encodedVariables: readonly string[];
    readonly claimIds: readonly string[];
    readonly evidenceIds: readonly string[];
  },
  context: z.RefinementCtx,
): void {
  if (figure.semanticValueIntent === "decorative") {
    validateSemanticFigureValue(figure, context);
    return;
  }
  if (figure.decisionEffect.length === 0) {
    context.addIssue({ code: "custom", message: "non-decorative figures must declare the decision effect", path: ["decisionEffect"] });
  }
  for (const field of ["nonDuplicateOf", "encodedVariables", "claimIds"] as const) {
    if (figure[field].length === 0) {
      context.addIssue({ code: "custom", message: "non-decorative figures require explicit semantic value bindings", path: [field] });
    }
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
