import { z } from "zod";
import { DocumentModeSchema } from "./document-mode.js";

export const ProposalClassSchema = z.enum([
  "academic_research",
  "research_service",
  "policy_research",
  "general_procurement",
  "document_restyle",
]);

export type ProposalClass = z.infer<typeof ProposalClassSchema>;

export const ProjectStateSchema = z.enum([
  "INIT",
  "SOURCE_LOCKED",
  "REQUIREMENTS_LOCKED",
  "EVIDENCE_LOCKED",
  "DESIGN_LOCKED",
  "CONTENT_APPROVED",
  "BUILT",
  "RENDERED",
  "AUDITED",
  "HUMAN_APPROVED",
  "RELEASED",
]);

export type ProjectState = z.infer<typeof ProjectStateSchema>;

export const ApprovalPolicySchema = z.literal("single_owner");

const ProjectFieldsSchema = z.object({
  projectId: z.string().trim().min(1),
  proposalClass: ProposalClassSchema,
  state: ProjectStateSchema,
  issuerPack: z.string().min(1).nullable(),
  approvalPolicy: ApprovalPolicySchema,
});

/** The v1 shape remains readable for diagnosis and explicit migration. */
export const ProjectV1Schema = ProjectFieldsSchema.extend({
  schemaVersion: z.string().min(1).refine((version) => !version.startsWith("2."), {
    message: "schema version 2.x requires the v2 project fields",
  }),
});

export const ProjectV2Schema = ProjectFieldsSchema.extend({
  schemaVersion: z.literal("2.0.0"),
  documentMode: DocumentModeSchema,
  modePolicyVersion: z.string().trim().min(1),
  migrationHistory: z.array(z.string().trim().min(1)),
});

/**
 * Version-aware project contract. v1 is intentionally accepted as-is so reads
 * do not silently migrate legacy projects; v2 requires all mode metadata.
 */
export const ProjectSchema = z.union([ProjectV2Schema, ProjectV1Schema]);

export type ProjectRecord = z.infer<typeof ProjectSchema>;
export type ProjectV1Record = z.infer<typeof ProjectV1Schema>;
export type ProjectV2Record = z.infer<typeof ProjectV2Schema>;
