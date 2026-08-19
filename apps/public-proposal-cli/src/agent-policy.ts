export type AgentRole =
  | "Proposal Architect"
  | "RFP/Compliance Reviewer"
  | "Methods/Evidence Reviewer"
  | "Institutional Evidence and Data Reviewer"
  | "Korean Prose Reviewer"
  | "Evaluator Red Team"
  | "Visual/Render Reviewer"
  | "Proof/Privacy Reviewer"
  | "fresh-context Submission Gate Reviewer";

export type ProposalClass =
  | "academic_research"
  | "research_service"
  | "policy_research"
  | "general_procurement"
  | "document_restyle";

export type ProposalRisk = "low" | "medium" | "high";
export type AgentStage = "authoring" | "representative" | "release";
export type AgentProfile = "quick" | "standard" | "deep";

/**
 * Single policy source shared by the public CLI route and both bundled skill
 * copies. The skill text is deliberately descriptive; it never creates a
 * second executable role matrix.
 */
export const AGENT_TRIGGER_MATRIX = {
  everyProposal: ["Proposal Architect", "RFP/Compliance Reviewer"],
  researchOrPolicy: ["Methods/Evidence Reviewer"],
  institutionFacts: ["Institutional Evidence and Data Reviewer"],
  representative: ["Korean Prose Reviewer", "Evaluator Red Team"],
  figureOrTable: ["Visual/Render Reviewer"],
  qualificationOrPii: ["Proof/Privacy Reviewer"],
  release: ["fresh-context Submission Gate Reviewer"],
} as const satisfies Record<string, readonly AgentRole[]>;

const PROFILE_LIMITS = {
  quick: { maxConcurrency: 3 },
  standard: { maxConcurrency: 6 },
  deep: { maxConcurrency: 10 },
} as const;

export interface AgentProfileInput {
  readonly proposalClass: ProposalClass;
  readonly risk: ProposalRisk;
  readonly hasFigure: boolean;
  readonly hasTable?: boolean;
  readonly representative: boolean;
  readonly hasInstitutionFacts?: boolean;
  readonly hasQualificationOrPii?: boolean;
  readonly hasAcademicEvidence?: boolean;
  readonly stage?: AgentStage;
  readonly profile?: AgentProfile;
}

export interface AgentProfilePlan {
  readonly roles: readonly AgentRole[];
  readonly longtable: boolean;
  readonly profile: AgentProfile;
  readonly maxConcurrency: number;
  readonly maxRebuttalsPerFinding: 1;
  readonly maxAutomaticSectionRevisions: 2;
  readonly maxAgentRunsPerStage: 12;
}

export function selectAgentProfile(input: AgentProfileInput): AgentProfilePlan {
  const profile = input.profile ?? selectProfile(input.proposalClass, input.risk);
  const requiresResearch = isResearchClass(input.proposalClass) || Boolean(input.hasAcademicEvidence);
  const roles: AgentRole[] = [...AGENT_TRIGGER_MATRIX.everyProposal];

  if (requiresResearch) roles.push(...AGENT_TRIGGER_MATRIX.researchOrPolicy);
  if (input.hasInstitutionFacts) roles.push(...AGENT_TRIGGER_MATRIX.institutionFacts);
  if (input.representative || input.stage === "representative") roles.push(...AGENT_TRIGGER_MATRIX.representative);
  if (input.hasFigure || input.hasTable) roles.push(...AGENT_TRIGGER_MATRIX.figureOrTable);
  if (input.hasQualificationOrPii) roles.push(...AGENT_TRIGGER_MATRIX.qualificationOrPii);
  if (input.stage === "release") roles.push(...AGENT_TRIGGER_MATRIX.release);

  return {
    roles,
    longtable: requiresResearch,
    profile,
    maxConcurrency: PROFILE_LIMITS[profile].maxConcurrency,
    maxRebuttalsPerFinding: 1,
    maxAutomaticSectionRevisions: 2,
    maxAgentRunsPerStage: 12,
  };
}

function isResearchClass(proposalClass: ProposalClass): boolean {
  return proposalClass === "academic_research"
    || proposalClass === "research_service"
    || proposalClass === "policy_research";
}

function selectProfile(proposalClass: ProposalClass, risk: ProposalRisk): AgentProfile {
  if (risk === "high") return "deep";
  if (isResearchClass(proposalClass)) return "standard";
  return risk === "medium" ? "standard" : "quick";
}
