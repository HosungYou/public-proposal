import { createHash } from "node:crypto";
import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ProposalResearchRequestVersionSchema = z.literal("proposal-research-request/v1");
export const EvidenceDataBundleVersionSchema = z.literal("proposal-evidence-bundle/v1");
export const TransformationLineageVersionSchema = z.literal("transformation-lineage/v1");
export const SemanticFigureSpecVersionSchema = z.literal("semantic-figure-spec/v1");

export const ResearchProposalClassSchema = z.enum([
  "academic_research",
  "research_service",
  "policy_research",
  "general_procurement",
  "document_restyle",
]);

export const SourceClassSchema = z.enum([
  "user_provided",
  "institution_official",
  "official",
  "alio",
  "data_go_kr",
  "kosis",
  "government_policy",
  "government_report",
  "scholarly_fulltext",
  "web_discovery",
]);

export const PrivacyClassSchema = z.enum(["PUBLIC", "PROJECT_CONFIDENTIAL"]);
export const ResearchRoutingDecisionSchema = z.enum(["required", "prohibited"]);
export const EvidenceFileClassificationSchema = z.enum([
  "PUBLIC",
  "PROJECT_CONFIDENTIAL",
  "RESTRICTED_PROOF",
  "SECRET",
]);

export const TargetArtifactSchema = z.enum(["claim", "table", "figure", "method"]);

const InstitutionSchema = z.object({
  canonicalName: IdentifierSchema,
  aliases: z.array(IdentifierSchema),
  identifiers: z.record(z.string().trim().min(1), IdentifierSchema),
}).strict();

const ResearchQuestionSchema = z.object({
  questionId: IdentifierSchema,
  text: IdentifierSchema,
  requiredDataFieldIds: z.array(IdentifierSchema),
}).strict();

const RequiredDataFieldSchema = z.object({
  fieldId: IdentifierSchema,
  definition: IdentifierSchema,
  period: IdentifierSchema,
  unit: IdentifierSchema,
  grain: IdentifierSchema,
  required: z.boolean(),
  allowedSourceClasses: z.array(SourceClassSchema).min(1),
  targetClaimIds: z.array(IdentifierSchema).optional(),
  targetFigureIds: z.array(IdentifierSchema).optional(),
}).strict();

const ResearchBudgetSchema = z.object({
  fullPass: z.literal(1),
  deltaPasses: z.literal(2),
}).strict();

export const ProposalResearchRequestV1Schema = z.object({
  schemaVersion: ProposalResearchRequestVersionSchema,
  requestId: IdentifierSchema,
  projectId: IdentifierSchema,
  proposalClass: ResearchProposalClassSchema,
  requirementIds: z.array(IdentifierSchema),
  institution: InstitutionSchema,
  questions: z.array(ResearchQuestionSchema),
  requiredData: z.array(RequiredDataFieldSchema),
  sourcePriority: z.array(SourceClassSchema).min(1),
  targetArtifacts: z.array(TargetArtifactSchema).min(1),
  budgets: ResearchBudgetSchema,
  privacyClass: PrivacyClassSchema,
  requirementsLockSha256: Sha256Schema,
  routingDecision: ResearchRoutingDecisionSchema,
}).strict();

export const EvidenceFileV1Schema = z.object({
  fileId: IdentifierSchema.optional(),
  path: IdentifierSchema,
  sha256: Sha256Schema,
  mediaType: IdentifierSchema.optional(),
  bytes: z.number().int().nonnegative().optional(),
  classification: EvidenceFileClassificationSchema,
}).strict();

export const ProposalResearchHandoffV1Schema = z.object({
  schemaVersion: z.literal("proposal-research-handoff/v1"),
  status: z.enum(["SUCCEEDED", "QUARANTINED"]),
  bundleId: IdentifierSchema,
  requestId: IdentifierSchema,
  accountableSynthesis: z.object({
    owner: IdentifierSchema,
    roles: z.array(IdentifierSchema),
    unresolvedGapIds: z.array(IdentifierSchema),
  }).strict(),
  searchBudget: z.object({
    fullPassesUsed: z.literal(1),
    deltaPassesUsed: z.number().int().min(0).max(2),
  }).strict(),
}).strict();

const SourceLocatorSchema = z.union([
  IdentifierSchema,
  z.object({
    uri: IdentifierSchema.optional(),
    path: IdentifierSchema.optional(),
    page: z.number().int().positive().optional(),
    fragment: IdentifierSchema.optional(),
  }).strict().refine((locator) => Object.keys(locator).length > 0, {
    message: "a source locator must contain at least one location",
  }),
]);

export const SourceRecordV1Schema = z.object({
  sourceId: IdentifierSchema,
  sourceClass: SourceClassSchema,
  title: IdentifierSchema,
  locator: SourceLocatorSchema,
  retrievedAt: z.string().datetime({ offset: true }).optional(),
  sha256: Sha256Schema.optional(),
  rightsStatus: z.enum(["public", "project_confidential", "restricted", "unknown"]).optional(),
  verified: z.boolean().optional(),
  institutionId: IdentifierSchema.optional(),
}).strict();

const JsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  JsonPrimitiveSchema,
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

export const NormalizedDatasetV1Schema = z.object({
  datasetId: IdentifierSchema,
  name: IdentifierSchema,
  sourceIds: z.array(IdentifierSchema),
  fieldIds: z.array(IdentifierSchema),
  period: IdentifierSchema.optional(),
  unit: IdentifierSchema.optional(),
  grain: IdentifierSchema.optional(),
  records: z.array(z.record(z.string(), JsonValueSchema)).optional(),
  contentSha256: Sha256Schema.optional(),
}).strict();

export const TransformationLineageV1Schema = z.object({
  schemaVersion: TransformationLineageVersionSchema.optional(),
  transformationId: IdentifierSchema,
  inputSourceIds: z.array(IdentifierSchema).optional(),
  inputDatasetIds: z.array(IdentifierSchema).optional(),
  inputDataIds: z.array(IdentifierSchema).optional(),
  outputDatasetId: IdentifierSchema.optional(),
  rawLocator: IdentifierSchema,
  normalizationSteps: z.array(IdentifierSchema),
  derivedFormula: IdentifierSchema.nullable(),
  outputCellOrRow: IdentifierSchema,
  claimIds: z.array(IdentifierSchema),
  figureIds: z.array(IdentifierSchema),
}).strict().refine((lineage) =>
  lineage.outputDatasetId !== undefined || lineage.inputDataIds !== undefined,
  { message: "lineage must identify an output dataset or input data ids", path: ["outputDatasetId"] },
);

export const ClaimCandidateV1Schema = z.object({
  claimId: IdentifierSchema,
  text: IdentifierSchema,
  requirementIds: z.array(IdentifierSchema),
  sourceIds: z.array(IdentifierSchema),
  dataIds: z.array(IdentifierSchema),
  status: z.enum(["candidate", "verified", "bounded", "blocked", "pending_blank"]),
  caveats: z.array(IdentifierSchema),
}).strict();

const SourceCaptionV1Schema = z.object({
  text: IdentifierSchema,
  sourceIds: z.array(IdentifierSchema).min(1),
}).strict();

export const FigureRelationshipSchema = z.enum([
  "trend",
  "comparison",
  "composition",
  "matrix",
  "process",
  "framework",
]);

export const SemanticFigureSpecV1Schema = z.object({
  schemaVersion: SemanticFigureSpecVersionSchema,
  figureId: IdentifierSchema,
  requirementIds: z.array(IdentifierSchema),
  evidenceIds: z.array(IdentifierSchema).min(1),
  analyticalQuestion: IdentifierSchema,
  readerTask: IdentifierSchema,
  supportedTakeaway: IdentifierSchema,
  dataIds: z.array(IdentifierSchema).min(1),
  relationship: FigureRelationshipSchema,
  minimumDataConditions: z.record(z.string().trim().min(1), z.union([z.number(), z.boolean(), z.string()])),
  uncertainty: z.array(IdentifierSchema),
  sourceCaption: SourceCaptionV1Schema,
  targetSurface: z.enum(["A4_DOCX", "A4_PDF"]),
  referenceFamily: IdentifierSchema,
  rendererVersion: IdentifierSchema,
  rendererFingerprint: z.object({
    renderer: z.object({ name: z.literal("@longtable/kpp-renderers"), version: z.literal("1.0.0") }).strict(),
    tokenProfile: z.object({ id: z.literal("R08-approved-project-profile"), sha256: z.literal("c6d87996c7ad2dfcce67b6d45373f30ff7026e33ba6fd05a22b1944cfa6f7afa") }).strict(),
    fontProfile: z.object({ id: z.literal("Noto-Sans-CJK-KR-2.004"), sha256: z.literal("0d0f75a19d1f9993378f58314cdbd7b3926ed6780fd6be2b031a0c67ddf9cd48") }).strict(),
    rasterizer: z.object({
      name: z.literal("LibreOffice"),
      executablePath: IdentifierSchema,
      executableSha256: Sha256Schema,
      version: z.string().regex(/^LibreOffice\s+\d+/),
    }).strict(),
  }).strict(),
  approvalStatus: z.enum(["candidate", "reviewed", "human_approved"]),
}).strict();

export const ResearchGapV1Schema = z.object({
  gapId: IdentifierSchema,
  kind: z.enum([
    "missing_data",
    "official_source_unavailable",
    "identity_ambiguous",
    "data_grain_mismatch",
    "data_unit_mismatch",
    "data_conflict_open",
    "required_data_gap",
    "other",
  ]),
  description: IdentifierSchema,
  status: z.enum(["open", "resolved", "checkpoint"]),
  requiredDataFieldId: IdentifierSchema.optional(),
  attempts: z.number().int().nonnegative().optional(),
}).strict();

export const EvidenceBundleStatusSchema = z.enum(["complete", "incomplete", "blocked", "checkpoint"]);

export const EvidenceDataBundleV1Schema = z.object({
  schemaVersion: EvidenceDataBundleVersionSchema,
  bundleId: IdentifierSchema,
  requestId: IdentifierSchema,
  contractVersion: IdentifierSchema,
  files: z.array(EvidenceFileV1Schema),
  sources: z.array(SourceRecordV1Schema),
  datasets: z.array(NormalizedDatasetV1Schema),
  transformations: z.array(TransformationLineageV1Schema),
  claims: z.array(ClaimCandidateV1Schema),
  figures: z.array(SemanticFigureSpecV1Schema),
  gaps: z.array(ResearchGapV1Schema),
  status: EvidenceBundleStatusSchema,
}).strict().superRefine((bundle, context) => {
  const datasetIds = new Set(bundle.datasets.map((dataset) => dataset.datasetId));
  const sourceIds = new Set(bundle.sources.map((source) => source.sourceId));
  const claimIds = new Set(bundle.claims.map((claim) => claim.claimId));
  const figureIds = new Set(bundle.figures.map((figure) => figure.figureId));

  for (const [figureIndex, figure] of bundle.figures.entries()) {
    for (const [dataIndex, dataId] of figure.dataIds.entries()) {
      if (!datasetIds.has(dataId)) {
        context.addIssue({
          code: "custom",
          message: `figure data id ${dataId} is not present in datasets`,
          path: ["figures", figureIndex, "dataIds", dataIndex],
        });
      }
    }
    for (const [sourceIndex, sourceId] of figure.sourceCaption.sourceIds.entries()) {
      if (!sourceIds.has(sourceId)) {
        context.addIssue({
          code: "custom",
          message: `figure caption source id ${sourceId} is not present in sources`,
          path: ["figures", figureIndex, "sourceCaption", "sourceIds", sourceIndex],
        });
      }
    }
  }

  for (const [datasetIndex, dataset] of bundle.datasets.entries()) {
    for (const [sourceIndex, sourceId] of dataset.sourceIds.entries()) {
      if (!sourceIds.has(sourceId)) {
        context.addIssue({
          code: "custom",
          message: `dataset source id ${sourceId} is not present in sources`,
          path: ["datasets", datasetIndex, "sourceIds", sourceIndex],
        });
      }
    }
  }

  for (const [transformationIndex, transformation] of bundle.transformations.entries()) {
    for (const sourceId of transformation.inputSourceIds ?? []) {
      if (!sourceIds.has(sourceId)) {
        context.addIssue({ code: "custom", message: `transformation source id ${sourceId} is not present in sources`, path: ["transformations", transformationIndex, "inputSourceIds"] });
      }
    }
    for (const [datasetIndex, datasetId] of (transformation.inputDatasetIds ?? []).entries()) {
      if (!datasetIds.has(datasetId)) {
        context.addIssue({
          code: "custom",
          message: `transformation input dataset id ${datasetId} is not present in datasets`,
          path: ["transformations", transformationIndex, "inputDatasetIds", datasetIndex],
        });
      }
    }
    for (const claimId of transformation.claimIds) {
      if (!claimIds.has(claimId)) {
        context.addIssue({ code: "custom", message: `transformation claim id ${claimId} is not present in claims`, path: ["transformations", transformationIndex, "claimIds"] });
      }
    }
    for (const figureId of transformation.figureIds) {
      if (!figureIds.has(figureId)) {
        context.addIssue({ code: "custom", message: `transformation figure id ${figureId} is not present in figures`, path: ["transformations", transformationIndex, "figureIds"] });
      }
    }
    if (transformation.outputDatasetId !== undefined && !datasetIds.has(transformation.outputDatasetId)) {
      context.addIssue({ code: "custom", message: `transformation output dataset id ${transformation.outputDatasetId} is not present in datasets`, path: ["transformations", transformationIndex, "outputDatasetId"] });
    }
  }

  for (const [claimIndex, claim] of bundle.claims.entries()) {
    for (const [sourceIndex, sourceId] of claim.sourceIds.entries()) {
      if (!sourceIds.has(sourceId)) {
        context.addIssue({
          code: "custom",
          message: `claim source id ${sourceId} is not present in sources`,
          path: ["claims", claimIndex, "sourceIds", sourceIndex],
        });
      }
    }
    for (const [dataIndex, dataId] of claim.dataIds.entries()) {
      if (!datasetIds.has(dataId)) {
        context.addIssue({
          code: "custom",
          message: `claim data id ${dataId} is not present in datasets`,
          path: ["claims", claimIndex, "dataIds", dataIndex],
        });
      }
    }
  }
});

export type ProposalResearchRequestV1 = z.infer<typeof ProposalResearchRequestV1Schema>;
export type EvidenceFileV1 = z.infer<typeof EvidenceFileV1Schema>;
export type ProposalResearchHandoffV1 = z.infer<typeof ProposalResearchHandoffV1Schema>;
export type SourceRecordV1 = z.infer<typeof SourceRecordV1Schema>;
export type NormalizedDatasetV1 = z.infer<typeof NormalizedDatasetV1Schema>;
export type TransformationLineageV1 = z.infer<typeof TransformationLineageV1Schema>;
export type ClaimCandidateV1 = z.infer<typeof ClaimCandidateV1Schema>;
export type SemanticFigureSpecV1 = z.infer<typeof SemanticFigureSpecV1Schema>;
export type ResearchGapV1 = z.infer<typeof ResearchGapV1Schema>;
export type EvidenceDataBundleV1 = z.infer<typeof EvidenceDataBundleV1Schema>;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Returns deterministic JSON with recursively sorted object keys. Arrays retain their input order. */
export function parseCanonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonicalJson(value));
}

/** Hashes deterministic UTF-8 JSON without a trailing newline. */
export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(parseCanonicalJson(value), "utf8").digest("hex");
}

function sortCanonicalJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not support non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(sortCanonicalJson);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON only supports plain objects");
    }
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) throw new TypeError(`canonical JSON cannot encode undefined at ${key}`);
      sorted[key] = sortCanonicalJson(entry);
    }
    return sorted;
  }
  throw new TypeError(`canonical JSON cannot encode ${typeof value}`);
}
