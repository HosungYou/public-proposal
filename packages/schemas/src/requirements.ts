import { z } from "zod";
import { EvidenceBindingSchema } from "./evidence.js";

const IdentifierSchema = z.string().min(1);

export const RequirementClaimSchema = z.object({
  claimId: IdentifierSchema,
  critical: z.boolean(),
  evidenceIds: z.array(IdentifierSchema),
});

export const FigureSpecSchema = z.object({
  figureId: IdentifierSchema,
  type: IdentifierSchema,
  title: IdentifierSchema,
});

export const RequirementSchema = z.object({
  requirementId: IdentifierSchema,
  title: IdentifierSchema,
  critical: z.boolean(),
  pageRole: IdentifierSchema,
  surfaceTemplateId: IdentifierSchema,
  claims: z.array(RequirementClaimSchema),
  figureSpecs: z.array(FigureSpecSchema),
});

const RequirementsRecordSchema = z.object({
  schemaVersion: z.string().min(1),
  requirements: z.array(RequirementSchema),
});

export const PendingRequirementsSchema = RequirementsRecordSchema.extend({
  confirmationStatus: z.literal("pending"),
  confirmedBy: z.null(),
});

export const ConfirmedRequirementsSchema = RequirementsRecordSchema.extend({
  confirmationStatus: z.literal("confirmed"),
  confirmedBy: z.string().min(1),
  evidenceBindings: z.array(EvidenceBindingSchema),
  requirements: z.array(RequirementSchema).min(1),
});

export const RequirementsFileSchema = z.discriminatedUnion("confirmationStatus", [
  PendingRequirementsSchema,
  ConfirmedRequirementsSchema,
]).superRefine((record, context) => {
  addDuplicateIssues(record.requirements.map(({ requirementId }) => requirementId), "requirementId", context);
  addDuplicateIssues(
    record.requirements.flatMap(({ claims }) => claims.map(({ claimId }) => claimId)),
    "claimId",
    context,
  );
  if (record.confirmationStatus === "confirmed") {
    addDuplicateIssues(
      record.evidenceBindings.map(({ evidenceId }) => evidenceId),
      "evidenceId",
      context,
    );
  }
});

function addDuplicateIssues(
  values: readonly string[],
  field: string,
  context: z.RefinementCtx,
): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  for (const duplicate of new Set(duplicates)) {
    context.addIssue({
      code: "custom",
      message: `${field} must be unique: ${duplicate}`,
      path: ["requirements"],
    });
  }
}

export type ConfirmedRequirements = z.infer<typeof ConfirmedRequirementsSchema>;
export type FigureSpec = z.infer<typeof FigureSpecSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type RequirementClaim = z.infer<typeof RequirementClaimSchema>;
export type RequirementsFile = z.infer<typeof RequirementsFileSchema>;
