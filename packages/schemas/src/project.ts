import { z } from "zod";

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

export const ProjectSchema = z.object({
  schemaVersion: z.string().min(1),
  projectId: z.string().min(1),
  state: ProjectStateSchema,
  issuerPack: z.string().min(1).nullable(),
  approvalPolicy: ApprovalPolicySchema,
});

export type ProjectRecord = z.infer<typeof ProjectSchema>;
