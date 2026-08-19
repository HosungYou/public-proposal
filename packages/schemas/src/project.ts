import { z } from "zod";

export const ProposalClassSchema = z.enum([
  "academic_research",
  "research_service",
  "policy_research",
  "general_procurement",
  "document_restyle",
]);

export type ProposalClass = z.infer<typeof ProposalClassSchema>;

export const ProjectStateSchema = z.enum([
  "UNMANAGED_DRAFT",
  "INIT",
  "SOURCE_LOCKED",
  "REQUIREMENTS_LOCKED",
  "BRIEF_LOCKED",
  "RESEARCH_LOCKED",
  "EVIDENCE_LOCKED",
  "DESIGN_LOCKED",
  "REPRESENTATIVE_REVIEW_REQUIRED",
  "REPRESENTATIVE_APPROVED",
  "CONTENT_APPROVED",
  "BUILT",
  "RENDERED",
  "AUDITED",
  "HUMAN_APPROVED",
  "RELEASED",
]);

export type ProjectState = z.infer<typeof ProjectStateSchema>;

export const ApprovalPolicySchema = z.literal("single_owner");

export const ProjectSchema = z.object({
  schemaVersion: z.string().min(1),
  projectId: z.string().min(1),
  proposalClass: ProposalClassSchema,
  state: ProjectStateSchema,
  issuerPack: z.string().min(1).nullable(),
  approvalPolicy: ApprovalPolicySchema,
});

export type ProjectRecord = z.infer<typeof ProjectSchema>;
