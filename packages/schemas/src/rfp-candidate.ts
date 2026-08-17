import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SourceLocatorSchema = z.string().regex(/^(?:page|section):[1-9]\d*$/);

export const RfpCandidateCategorySchema = z.enum([
  "page_limit",
  "format",
  "font",
  "deadline",
  "anonymity",
  "required_form",
]);

export const RfpCandidateStatusSchema = z.literal("pending");

export const RfpCandidateSchema = z.object({
  candidateId: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceSha256: Sha256Schema,
  sourceLocator: SourceLocatorSchema,
  extractedText: z.string().min(1),
  category: RfpCandidateCategorySchema,
  confidence: z.number().gt(0).lt(1),
  status: RfpCandidateStatusSchema,
});

export const RfpCandidatesFileSchema = z.object({
  schemaVersion: z.string().min(1),
  candidates: z.array(RfpCandidateSchema),
}).superRefine((record, context) => {
  const duplicateIds = record.candidates
    .map(({ candidateId }) => candidateId)
    .filter((candidateId, index, ids) => ids.indexOf(candidateId) !== index);

  for (const candidateId of new Set(duplicateIds)) {
    context.addIssue({
      code: "custom",
      message: `candidateId must be unique: ${candidateId}`,
      path: ["candidates"],
    });
  }
});

export const RequirementCandidateSchema = RfpCandidateSchema;
export const RequirementCandidatesFileSchema = RfpCandidatesFileSchema;

export type RfpCandidate = z.infer<typeof RfpCandidateSchema>;
export type RfpCandidateCategory = z.infer<typeof RfpCandidateCategorySchema>;
export type RfpCandidateStatus = z.infer<typeof RfpCandidateStatusSchema>;
export type RfpCandidatesFile = z.infer<typeof RfpCandidatesFileSchema>;
export type RequirementCandidate = RfpCandidate;
export type RequirementCandidatesFile = RfpCandidatesFile;
