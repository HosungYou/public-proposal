import { z } from "zod";

const EvidenceIdSchema = z.string().min(1);
const IdentifierSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const EvidenceBindingSchema = z.object({
  evidenceId: EvidenceIdSchema,
  sourcePath: z.string().min(1),
  sourceSha256: Sha256Schema,
  scope: z.string().min(1),
  claimIds: z.array(IdentifierSchema).min(1),
  targetRequirementId: IdentifierSchema,
  targetPageId: IdentifierSchema,
  targetPageRole: IdentifierSchema,
});

export type EvidenceBinding = z.infer<typeof EvidenceBindingSchema>;

export const EvidenceStatusSchema = z.enum([
  "verified",
  "bounded",
  "pending_blank",
  "blocked",
]);

export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const EvidenceItemSchema = z.discriminatedUnion("status", [
  z.object({
    claimId: z.string().min(1),
    status: z.literal("verified"),
    evidenceIds: z.array(EvidenceIdSchema).min(1),
  }),
  z.object({
    claimId: z.string().min(1),
    status: z.literal("bounded"),
    evidenceIds: z.array(EvidenceIdSchema).min(1),
  }),
  z.object({
    claimId: z.string().min(1),
    status: z.literal("pending_blank"),
    evidenceIds: z.array(EvidenceIdSchema),
  }),
  z.object({
    claimId: z.string().min(1),
    status: z.literal("blocked"),
    evidenceIds: z.array(EvidenceIdSchema),
  }),
]);

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidenceLedgerSchema = z.object({
  schemaVersion: z.string().min(1),
  claims: z.array(EvidenceItemSchema),
  bindings: z.array(EvidenceBindingSchema),
});

export type EvidenceLedger = z.infer<typeof EvidenceLedgerSchema>;
