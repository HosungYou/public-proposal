import { z } from "zod";
import { EvidenceStatusSchema } from "./evidence.js";
import { SemanticFigureSpecSchema } from "./figure-spec.js";

const IdentifierSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const IssuerProfileSchema = z.object({
  schemaVersion: z.string().min(1),
  issuerName: z.string().min(1).optional(),
  issuerPack: z.string().min(1).nullable().optional(),
  rules: z.array(z.object({
    ruleId: IdentifierSchema,
    label: z.string().min(1),
  }).strict()).default([]),
}).strict();

export const ApprovedTerminologySchema = z.object({
  schemaVersion: z.string().min(1),
  entries: z.array(z.object({
    term: z.string().min(1),
    definition: z.string().min(1),
  }).strict()).default([]),
}).strict();

export const AuthoringInputProvenanceSchema = z.object({
  status: z.enum(["provided", "not_provided"]),
  path: z.string().min(1).nullable(),
  sha256: Sha256Schema.nullable(),
}).superRefine((value, context) => {
  const hasSource = value.path !== null || value.sha256 !== null;
  if (value.status === "provided" && (!hasSource || value.path === null || value.sha256 === null)) {
    context.addIssue({ code: "custom", message: "provided input requires path and SHA-256" });
  }
  if (value.status === "not_provided" && hasSource) {
    context.addIssue({ code: "custom", message: "not_provided input cannot declare a source" });
  }
});

export const AuthoringArtifactsSchema = z.object({
  requirementsPath: z.string().min(1),
  requirementsSha256: Sha256Schema,
  evidenceLedgerPath: z.string().min(1),
  evidenceLedgerSha256: Sha256Schema,
  pagePlanPath: z.string().min(1),
  pagePlanSha256: Sha256Schema,
}).strict();

export const AuthoringEvidenceProvenanceSchema = z.object({
  evidenceId: IdentifierSchema,
  sourcePath: z.string().min(1),
  sourceSha256: Sha256Schema,
  scope: z.string().min(1),
  claimIds: z.array(IdentifierSchema).min(1),
  status: EvidenceStatusSchema,
}).strict();

export const AuthoringClaimScopeSchema = z.object({
  claimId: IdentifierSchema,
  status: EvidenceStatusSchema,
  evidenceIds: z.array(IdentifierSchema),
}).strict();

export const AuthoringContentBlockSchema = z.object({
  pageId: IdentifierSchema,
  requirementId: IdentifierSchema,
  pageRole: IdentifierSchema,
  claimIds: z.array(IdentifierSchema),
  claimScopes: z.array(AuthoringClaimScopeSchema),
  allowedEvidenceIds: z.array(IdentifierSchema),
  terminology: z.array(z.object({
    term: z.string().min(1),
    definition: z.string().min(1),
  }).strict()),
  lengthBudget: z.object({
    maxCharacters: z.number().int().positive(),
  }).strict(),
  requiredEvaluatorAnswer: z.string().min(1),
  permittedPendingBlankFields: z.array(IdentifierSchema),
  figureSpecs: z.array(SemanticFigureSpecSchema),
}).strict();

export const AuthoringRequestSchema = z.object({
  schemaVersion: z.string().min(1),
  projectId: IdentifierSchema,
  issuerProfile: AuthoringInputProvenanceSchema.extend({
    profile: IssuerProfileSchema,
  }).strict(),
  terminology: AuthoringInputProvenanceSchema.extend({
    glossary: ApprovedTerminologySchema,
  }).strict(),
  artifacts: AuthoringArtifactsSchema,
  evidenceProvenance: z.array(AuthoringEvidenceProvenanceSchema),
  blocks: z.array(AuthoringContentBlockSchema).min(1),
}).strict();

export const AuthoringResponseBlockSchema = z.object({
  pageId: IdentifierSchema,
  claimIds: z.array(IdentifierSchema),
  evidenceIds: z.array(IdentifierSchema),
  status: z.enum(["draft", "provisional"]),
  text: z.string(),
  evaluatorAnswer: z.string(),
  pendingBlankFieldIds: z.array(IdentifierSchema),
}).strict();

export const AuthoringResponseSchema = z.object({
  schemaVersion: z.string().min(1),
  blocks: z.array(AuthoringResponseBlockSchema).min(1),
}).strict();

export type IssuerProfile = z.infer<typeof IssuerProfileSchema>;
export type ApprovedTerminology = z.infer<typeof ApprovedTerminologySchema>;
export type AuthoringInputProvenance = z.infer<typeof AuthoringInputProvenanceSchema>;
export type AuthoringArtifacts = z.infer<typeof AuthoringArtifactsSchema>;
export type AuthoringEvidenceProvenance = z.infer<typeof AuthoringEvidenceProvenanceSchema>;
export type AuthoringClaimScope = z.infer<typeof AuthoringClaimScopeSchema>;
export type AuthoringContentBlock = z.infer<typeof AuthoringContentBlockSchema>;
export type AuthoringRequest = z.infer<typeof AuthoringRequestSchema>;
export type AuthoringResponseBlock = z.infer<typeof AuthoringResponseBlockSchema>;
export type AuthoringResponse = z.infer<typeof AuthoringResponseSchema>;
