import { z } from "zod";
import { ProposalClassSchema } from "./project.js";

const IdentifierSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const DecisionScopeSchema = z.enum([
  "global",
  "proposal_family",
  "project",
  "document",
  "temporary",
]);

export const DecisionStatusSchema = z.enum(["active", "superseded", "expired"]);

export const DecisionSourceSchema = z.object({
  threadId: IdentifierSchema.optional(),
  turnId: IdentifierSchema.optional(),
  artifactHash: Sha256Schema.optional(),
}).strict();

export const DecisionRecordV1Schema = z.object({
  decisionId: IdentifierSchema,
  scope: DecisionScopeSchema,
  statement: z.string().min(1),
  rationale: z.string().min(1),
  source: DecisionSourceSchema,
  status: DecisionStatusSchema,
  supersedes: z.array(IdentifierSchema),
  affects: z.array(IdentifierSchema),
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
}).strict();

export const ReaderTaskSchema = z.object({
  reader: z.string().min(1),
  task: z.string().min(1),
}).strict();

export const OpenDecisionV1Schema = z.object({
  decisionId: IdentifierSchema,
  question: z.string().min(1),
  affects: z.array(IdentifierSchema),
  critical: z.boolean(),
}).strict();

export const ReferenceBindingV1Schema = z.object({
  referenceId: IdentifierSchema,
  sourcePath: z.string().min(1),
  sourceSha256: Sha256Schema,
  useBoundary: z.string().min(1),
}).strict();

export const LivingProposalBriefV1Schema = z.object({
  schemaVersion: z.literal("living-proposal-brief/v1"),
  projectId: IdentifierSchema,
  proposalClass: ProposalClassSchema,
  problem: z.string().min(1),
  primaryReaders: z.array(ReaderTaskSchema),
  doctrineVersion: z.string().min(1),
  evidenceBoundary: z.array(z.string().min(1)),
  activeDecisions: z.array(DecisionRecordV1Schema),
  openDecisions: z.array(OpenDecisionV1Schema),
  approvedReferences: z.array(ReferenceBindingV1Schema),
  nextHumanGate: z.string().min(1),
}).strict().superRefine((brief, context) => {
  const activeIds = new Set<string>();
  for (const [index, decision] of brief.activeDecisions.entries()) {
    if (decision.status !== "active") {
      context.addIssue({
        code: "custom",
        message: "activeDecisions may contain only active decision records",
        path: ["activeDecisions", index, "status"],
      });
    }
    if (activeIds.has(decision.decisionId)) {
      context.addIssue({
        code: "custom",
        message: "active decision IDs must be unique",
        path: ["activeDecisions", index, "decisionId"],
      });
    }
    activeIds.add(decision.decisionId);
  }
  for (const [index, decision] of brief.openDecisions.entries()) {
    if (activeIds.has(decision.decisionId)) {
      context.addIssue({
        code: "custom",
        message: "open and active decision IDs must not overlap",
        path: ["openDecisions", index, "decisionId"],
      });
    }
  }
});

export type DecisionScope = z.infer<typeof DecisionScopeSchema>;
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;
export type DecisionSource = z.infer<typeof DecisionSourceSchema>;
export type DecisionRecordV1 = z.infer<typeof DecisionRecordV1Schema>;
export type ReaderTask = z.infer<typeof ReaderTaskSchema>;
export type OpenDecisionV1 = z.infer<typeof OpenDecisionV1Schema>;
export type ReferenceBindingV1 = z.infer<typeof ReferenceBindingV1Schema>;
export type LivingProposalBriefV1 = z.infer<typeof LivingProposalBriefV1Schema>;
