import { z } from "zod";
import { DecisionScopeSchema } from "./living-brief.js";

const IdentifierSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const PolicyApprovalV1Schema = z.object({
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
}).strict();

export const PolicyProvenanceV1Schema = z.object({
  sourceId: IdentifierSchema,
  sourcePath: z.string().min(1),
  artifactHash: Sha256Schema,
}).strict();

export const PolicyBindingV1Schema = z.object({
  policyId: IdentifierSchema,
  value: z.string().min(1),
  approval: PolicyApprovalV1Schema.optional(),
  provenance: PolicyProvenanceV1Schema.optional(),
}).strict();

export const ApprovedPolicyBindingV1Schema = PolicyBindingV1Schema.extend({
  approval: PolicyApprovalV1Schema,
  provenance: PolicyProvenanceV1Schema,
}).strict();

export const ProjectPolicyDecisionV1Schema = PolicyBindingV1Schema.extend({
  explicitException: z.boolean(),
}).strict();

export const DecisionPromotionReceiptV1Schema = z.object({
  decisionId: IdentifierSchema,
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
}).strict();

export const DecisionScopePromotionV1Schema = z.object({
  currentScope: DecisionScopeSchema,
  requestedScope: DecisionScopeSchema,
  promotionReceipt: DecisionPromotionReceiptV1Schema.optional(),
}).strict();

export type PolicyBindingV1 = z.infer<typeof PolicyBindingV1Schema>;
export type ApprovedPolicyBindingV1 = z.infer<typeof ApprovedPolicyBindingV1Schema>;
export type PolicyApprovalV1 = z.infer<typeof PolicyApprovalV1Schema>;
export type PolicyProvenanceV1 = z.infer<typeof PolicyProvenanceV1Schema>;
export type ProjectPolicyDecisionV1 = z.infer<typeof ProjectPolicyDecisionV1Schema>;
export type DecisionPromotionReceiptV1 = z.infer<typeof DecisionPromotionReceiptV1Schema>;
export type DecisionScopePromotionV1 = z.infer<typeof DecisionScopePromotionV1Schema>;
