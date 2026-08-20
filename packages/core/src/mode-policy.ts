import { type DocumentMode } from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";

export const MODE_POLICY_VERSION = "1.0.0";

export interface DocumentModePolicy {
  readonly documentMode: DocumentMode;
  readonly modePolicyVersion: typeof MODE_POLICY_VERSION;
  readonly requiredPageRoles: readonly string[];
  readonly allowedPageRoles: readonly string[];
  readonly pageRoleAliases: Readonly<Record<string, string>>;
  readonly allowedSurfaceFamilies: readonly string[];
  readonly surfaceTemplateFamilies: Readonly<Record<string, string>>;
  readonly requiredAuditSlices: readonly string[];
  readonly artifactAllowlist: readonly string[];
  readonly allowedReferenceClasses: readonly string[];
  readonly issuerOverridePolicy: {
    readonly allowedReferenceClasses: readonly string[];
    readonly allowedRuleIds: readonly string[];
  };
}

const DOCUMENT_MODE_POLICIES: Record<DocumentMode, DocumentModePolicy> = {
  public_procurement: {
    documentMode: "public_procurement",
    modePolicyVersion: MODE_POLICY_VERSION,
    requiredPageRoles: [
      "executive_summary",
      "procurement_evaluation_crosswalk",
      "requirement_response",
      "delivery_control",
    ],
    allowedPageRoles: [
      "executive_summary",
      "procurement_evaluation_crosswalk",
      "requirement_response",
      "delivery_control",
      "mandatory_form",
    ],
    pageRoleAliases: {
      approach_overview: "requirement_response",
      academic_evidence: "procurement_evaluation_crosswalk",
      qualification_evidence: "procurement_evaluation_crosswalk",
      supplementary_input: "requirement_response",
    },
    allowedSurfaceFamilies: [
      "narrative_continuation",
      "evidence_analysis",
      "process_control",
      "comparison_decision",
      "schedule_ownership",
      "mandatory_form",
    ],
    surfaceTemplateFamilies: {
      "narrative-v1": "narrative_continuation",
      "evidence-grid-v1": "evidence_analysis",
      "r08-research-method-v1": "evidence_analysis",
      "r08-supplementary-input-v1": "narrative_continuation",
    },
    requiredAuditSlices: [
      "page_architecture",
      "reference_integrity",
      "render_repetition",
      "figure_value",
      "korean_prose_review",
      "procurement_evaluation_crosswalk",
    ],
    artifactAllowlist: [
      "rfp_requirement_matrix",
      "evaluation_crosswalk",
      "delivery_control_plan",
      "evidence_ledger",
      "audit_receipt",
    ],
    allowedReferenceClasses: ["official", "evidence", "academic", "visual", "issuer_rule", "unavailable"],
    issuerOverridePolicy: { allowedReferenceClasses: ["issuer_rule"], allowedRuleIds: [] },
  },
  research_service: {
    documentMode: "research_service",
    modePolicyVersion: MODE_POLICY_VERSION,
    requiredPageRoles: [
      "research_question",
      "research_method",
      "evidence_plan",
      "limitations",
      "utilization_plan",
    ],
    allowedPageRoles: [
      "research_question",
      "research_method",
      "evidence_plan",
      "limitations",
      "utilization_plan",
    ],
    pageRoleAliases: { supplementary_input: "evidence_plan" },
    allowedSurfaceFamilies: [
      "research_narrative",
      "method_design",
      "evidence_analysis",
      "limitations_register",
      "utilization_roadmap",
    ],
    surfaceTemplateFamilies: {
      "r08-research-method-v1": "method_design",
      "r08-supplementary-input-v1": "evidence_analysis",
    },
    requiredAuditSlices: [
      "page_architecture",
      "reference_integrity",
      "research_method_traceability",
      "figure_value",
      "korean_prose_review",
    ],
    artifactAllowlist: [
      "research_specification",
      "method_protocol",
      "source_ledger",
      "citation_slot_matrix",
      "audit_receipt",
    ],
    allowedReferenceClasses: ["official", "evidence", "academic", "dataset", "visual", "issuer_rule", "unavailable"],
    issuerOverridePolicy: { allowedReferenceClasses: ["issuer_rule"], allowedRuleIds: [] },
  },
  private_partnership: {
    documentMode: "private_partnership",
    modePolicyVersion: MODE_POLICY_VERSION,
    requiredPageRoles: [
      "mutual_value",
      "party_roles",
      "operating_model",
      "collaboration_options",
      "next_decision",
    ],
    allowedPageRoles: ["mutual_value", "party_roles", "operating_model", "collaboration_options", "next_decision"],
    pageRoleAliases: {},
    allowedSurfaceFamilies: [
      "partnership_narrative",
      "role_handoff",
      "operating_model",
      "option_comparison",
      "decision_record",
    ],
    surfaceTemplateFamilies: {},
    requiredAuditSlices: [
      "page_architecture",
      "reference_integrity",
      "operating_model_traceability",
      "render_repetition",
      "korean_prose_review",
    ],
    artifactAllowlist: [
      "partnership_value_map",
      "role_handoff_matrix",
      "operating_model",
      "decision_options",
      "audit_receipt",
    ],
    allowedReferenceClasses: ["official", "evidence", "partner", "commercial", "visual", "issuer_rule", "unavailable"],
    issuerOverridePolicy: { allowedReferenceClasses: ["issuer_rule"], allowedRuleIds: [] },
  },
  internal_decision: {
    documentMode: "internal_decision",
    modePolicyVersion: MODE_POLICY_VERSION,
    requiredPageRoles: [
      "decision_request",
      "alternatives",
      "tradeoffs",
      "risk_register",
      "owner_approval",
    ],
    allowedPageRoles: ["decision_request", "alternatives", "tradeoffs", "risk_register", "owner_approval"],
    pageRoleAliases: {},
    allowedSurfaceFamilies: [
      "decision_brief",
      "option_comparison",
      "tradeoff_table",
      "risk_register",
      "approval_form",
    ],
    surfaceTemplateFamilies: {},
    requiredAuditSlices: [
      "page_architecture",
      "decision_traceability",
      "risk_owner_traceability",
      "render_repetition",
      "korean_prose_review",
    ],
    artifactAllowlist: [
      "decision_memo",
      "options_matrix",
      "risk_register",
      "approval_record",
      "audit_receipt",
    ],
    allowedReferenceClasses: ["official", "evidence", "internal", "decision", "visual", "issuer_rule", "unavailable"],
    issuerOverridePolicy: { allowedReferenceClasses: ["issuer_rule"], allowedRuleIds: [] },
  },
  document_restyle: {
    documentMode: "document_restyle",
    modePolicyVersion: MODE_POLICY_VERSION,
    requiredPageRoles: [
      "source_inventory",
      "content_ledger",
      "layout_accessibility",
      "mutation_report",
      "acceptance_record",
    ],
    allowedPageRoles: ["source_inventory", "content_ledger", "layout_accessibility", "mutation_report", "acceptance_record"],
    pageRoleAliases: {},
    allowedSurfaceFamilies: [
      "source_output_comparison",
      "content_ledger",
      "layout_review",
      "mutation_log",
      "acceptance_form",
    ],
    surfaceTemplateFamilies: {},
    requiredAuditSlices: [
      "source_output_traceability",
      "layout_accessibility",
      "mutation_integrity",
      "reference_integrity",
      "korean_prose_review",
    ],
    artifactAllowlist: [
      "source_inventory",
      "content_ledger",
      "layout_accessibility_report",
      "mutation_report",
      "acceptance_record",
    ],
    allowedReferenceClasses: ["official", "evidence", "source_document", "visual", "issuer_rule", "unavailable"],
    issuerOverridePolicy: { allowedReferenceClasses: ["issuer_rule"], allowedRuleIds: [] },
  },
};

export function getDocumentModePolicy(mode: DocumentMode): DocumentModePolicy {
  const policy = DOCUMENT_MODE_POLICIES[mode];
  if (policy === undefined) {
    throw new KppError("KPP_MODE_POLICY_UNKNOWN", "지원하지 않는 문서 모드 정책입니다.", {
      actual: mode,
    });
  }
  return policy;
}
