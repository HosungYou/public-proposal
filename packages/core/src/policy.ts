import {
  ApprovedPolicyBindingV1Schema,
  DecisionPromotionReceiptV1Schema,
  type DecisionScope,
  type PolicyBindingV1,
  type ProjectPolicyDecisionV1,
} from "@longtable/kpp-schemas";

export interface DecisionAcceptanceInput {
  readonly turnText: string;
  readonly presentedDecisionIds: readonly string[];
}

export type DecisionAcceptanceResult =
  | { readonly ok: true; readonly decisionId: string }
  | { readonly ok: false; readonly code: "PP_DECISION_ACCEPTANCE_AMBIGUOUS" | "PP_DECISION_ACCEPTANCE_MISSING" | "PP_DECISION_ACCEPTANCE_UNRECOGNIZED" };

export interface DecisionScopeResolutionInput {
  readonly decisionId: string;
  readonly currentScope: DecisionScope;
  readonly requestedScope: DecisionScope;
  readonly promotionReceipt?: unknown;
}

export type DecisionScopeResolution =
  | { readonly ok: true; readonly scope: DecisionScope }
  | { readonly ok: false; readonly code: "PP_DECISION_SCOPE_PROMOTION_REQUIRED" | "PP_DECISION_PROMOTION_RECEIPT_INVALID" | "PP_DECISION_PROMOTION_RECEIPT_MISMATCH" };

export interface PositivePolicyInput {
  readonly issuerRule?: PolicyBindingV1;
  readonly projectDecision?: ProjectPolicyDecisionV1;
  readonly proposalFamilyProfile?: PolicyBindingV1;
  readonly referencePattern?: PolicyBindingV1;
  readonly pluginDefault?: PolicyBindingV1;
}

export type PositivePolicyResolution =
  | { readonly ok: true; readonly source: "issuer_rule" | "project_decision" | "proposal_family_profile" | "reference_pattern" | "plugin_default"; readonly value: string }
  | { readonly ok: false; readonly code: "PP_POLICY_ISSUER_CONFLICT" | "PP_POLICY_ID_MISMATCH" | "PP_POLICY_BINDING_UNAPPROVED" };

const BARE_ACCEPTANCES = new Set(["응", "수용", "제안대로"]);

export function recordDecisionAcceptance(input: DecisionAcceptanceInput): DecisionAcceptanceResult {
  const response = input.turnText.trim().replace(/[.!。]/gu, "");
  if (!BARE_ACCEPTANCES.has(response)) return { ok: false, code: "PP_DECISION_ACCEPTANCE_UNRECOGNIZED" };
  if (input.presentedDecisionIds.length === 0) return { ok: false, code: "PP_DECISION_ACCEPTANCE_MISSING" };
  if (input.presentedDecisionIds.length !== 1) return { ok: false, code: "PP_DECISION_ACCEPTANCE_AMBIGUOUS" };
  return { ok: true, decisionId: input.presentedDecisionIds[0]! };
}

export function resolveDecisionScope(input: DecisionScopeResolutionInput): DecisionScopeResolution {
  if (input.currentScope === input.requestedScope || !requiresPromotionReceipt(input.currentScope, input.requestedScope)) {
    return { ok: true, scope: input.requestedScope };
  }
  if (input.promotionReceipt === undefined) return { ok: false, code: "PP_DECISION_SCOPE_PROMOTION_REQUIRED" };
  const parsed = DecisionPromotionReceiptV1Schema.safeParse(input.promotionReceipt);
  if (!parsed.success) return { ok: false, code: "PP_DECISION_PROMOTION_RECEIPT_INVALID" };
  if (parsed.data.decisionId !== input.decisionId) {
    return { ok: false, code: "PP_DECISION_PROMOTION_RECEIPT_MISMATCH" };
  }
  return { ok: true, scope: input.requestedScope };
}

export function resolvePositivePolicy(input: PositivePolicyInput): PositivePolicyResolution {
  if (
    (input.proposalFamilyProfile !== undefined && !ApprovedPolicyBindingV1Schema.safeParse(input.proposalFamilyProfile).success)
    || (input.referencePattern !== undefined && !ApprovedPolicyBindingV1Schema.safeParse(input.referencePattern).success)
  ) {
    return { ok: false, code: "PP_POLICY_BINDING_UNAPPROVED" };
  }
  const candidates = [
    input.issuerRule,
    input.projectDecision,
    input.proposalFamilyProfile,
    input.referencePattern,
    input.pluginDefault,
  ].filter((candidate): candidate is PolicyBindingV1 => candidate !== undefined);
  if (candidates.length === 0) return { ok: false, code: "PP_POLICY_ID_MISMATCH" };
  if (!candidates.every(({ policyId }) => policyId === candidates[0]!.policyId)) {
    return { ok: false, code: "PP_POLICY_ID_MISMATCH" };
  }
  if (input.issuerRule !== undefined && input.projectDecision !== undefined
    && input.issuerRule.value !== input.projectDecision.value
    && !input.projectDecision.explicitException) {
    return { ok: false, code: "PP_POLICY_ISSUER_CONFLICT" };
  }
  if (input.issuerRule !== undefined && input.projectDecision?.explicitException !== true) {
    return { ok: true, source: "issuer_rule", value: input.issuerRule.value };
  }
  if (input.projectDecision !== undefined) return { ok: true, source: "project_decision", value: input.projectDecision.value };
  if (input.proposalFamilyProfile !== undefined) return { ok: true, source: "proposal_family_profile", value: input.proposalFamilyProfile.value };
  if (input.referencePattern !== undefined) return { ok: true, source: "reference_pattern", value: input.referencePattern.value };
  return { ok: true, source: "plugin_default", value: input.pluginDefault!.value };
}

function requiresPromotionReceipt(currentScope: DecisionScope, requestedScope: DecisionScope): boolean {
  const scopeRank: Record<DecisionScope, number> = {
    temporary: 0,
    document: 1,
    project: 2,
    proposal_family: 3,
    global: 4,
  };
  return (requestedScope === "proposal_family" || requestedScope === "global")
    && scopeRank[requestedScope] > scopeRank[currentScope];
}
