import { z } from "zod";

const IdentifierSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const PatchProposalV1Schema = z.object({
  originalExcerpt: z.string().min(1),
  originalHash: Sha256Schema,
  replacement: z.string().min(1),
  reason: z.string().min(1),
  evidenceIds: z.array(IdentifierSchema),
  affectedRequirementIds: z.array(IdentifierSchema),
  risk: z.string().min(1),
}).strict();

export const ReviewerFindingV1Schema = z.object({
  findingId: IdentifierSchema,
  artifactHash: Sha256Schema,
  target: z.object({
    sectionId: IdentifierSchema.optional(),
    claimId: IdentifierSchema.optional(),
    figureId: IdentifierSchema.optional(),
  }).strict(),
  authorityClass: z.enum(["issuer", "evidence", "method", "editorial", "visual", "privacy", "release"]),
  severity: z.enum(["blocker", "editorial_hold", "warning"]),
  readerImpact: z.string().min(1),
  evidence: z.array(z.string().min(1)),
  proposedPatch: PatchProposalV1Schema.nullable(),
  confidence: z.number().min(0).max(1),
  dependencies: z.array(IdentifierSchema),
}).strict();

export type PatchProposalV1 = z.infer<typeof PatchProposalV1Schema>;
export type ReviewerFindingV1 = z.infer<typeof ReviewerFindingV1Schema>;
