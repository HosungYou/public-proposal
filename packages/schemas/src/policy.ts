import { z } from "zod";
import { DecisionScopeSchema } from "./living-brief.js";

const IdentifierSchema = z.string().min(1);

export const PolicyBindingV1Schema = z.object({
  policyId: IdentifierSchema,
  value: z.string().min(1),
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
export type ProjectPolicyDecisionV1 = z.infer<typeof ProjectPolicyDecisionV1Schema>;
export type DecisionPromotionReceiptV1 = z.infer<typeof DecisionPromotionReceiptV1Schema>;
export type DecisionScopePromotionV1 = z.infer<typeof DecisionScopePromotionV1Schema>;
