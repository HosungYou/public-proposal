import { z } from "zod";
import { EvidenceBindingSchema } from "./evidence.js";
import { RequirementSchema } from "./requirements.js";

const IdentifierSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SourceLocatorSchema = z.string().regex(/^(?:page|section):[1-9]\d*$/);

export const RequirementDecisionOutcomeSchema = z.enum([
  "confirm",
  "reject",
  "conflict",
  "no_rule",
]);

export const RequirementSourceAuthoritySchema = z.enum(["issuer", "cohort"]);

export const RequirementDecisionSchema = z.object({
  candidateId: IdentifierSchema,
  decision: RequirementDecisionOutcomeSchema,
  constraintKey: IdentifierSchema,
  sourceLocator: SourceLocatorSchema,
  sourceSha256: Sha256Schema,
  sourceAuthority: RequirementSourceAuthoritySchema,
  decidedBy: IdentifierSchema,
  decidedAt: z.string().datetime(),
  rationale: z.string().min(1),
});

export const RequirementConflictResolutionSchema = z.object({
  constraintKey: IdentifierSchema,
  selectedCandidateId: IdentifierSchema,
  resolvedBy: IdentifierSchema,
  resolvedAt: z.string().datetime(),
  rationale: z.string().min(1),
});

export const RequirementDecisionRequirementsSchema = z.object({
  requirements: z.array(RequirementSchema).min(1),
  evidenceBindings: z.array(EvidenceBindingSchema),
});

export const RequirementBindingSchema = z.object({
  candidateId: IdentifierSchema,
  targetRequirementIds: z.array(IdentifierSchema).min(1),
});

export const RequirementDecisionFileSchema = z.object({
  schemaVersion: z.string().min(1),
  confirmedBy: IdentifierSchema,
  requirements: RequirementDecisionRequirementsSchema,
  decisions: z.array(RequirementDecisionSchema),
  requirementBindings: z.array(RequirementBindingSchema).default([]),
  resolutions: z.array(RequirementConflictResolutionSchema),
}).superRefine((record, context) => {
  addDuplicateIssues(record.decisions.map(({ candidateId }) => candidateId), "candidateId", "decisions", context);
  addDuplicateIssues(record.resolutions.map(({ constraintKey }) => constraintKey), "constraintKey", "resolutions", context);
});

function addDuplicateIssues(
  values: readonly string[],
  field: string,
  path: string,
  context: z.RefinementCtx,
): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  for (const value of new Set(duplicates)) {
    context.addIssue({
      code: "custom",
      message: `${field} must be unique: ${value}`,
      path: [path],
    });
  }
}

export type RequirementDecision = z.infer<typeof RequirementDecisionSchema>;
export type RequirementBinding = z.infer<typeof RequirementBindingSchema>;
export type RequirementDecisionFile = z.infer<typeof RequirementDecisionFileSchema>;
export type RequirementDecisionOutcome = z.infer<typeof RequirementDecisionOutcomeSchema>;
export type RequirementConflictResolution = z.infer<typeof RequirementConflictResolutionSchema>;
export type RequirementSourceAuthority = z.infer<typeof RequirementSourceAuthoritySchema>;
