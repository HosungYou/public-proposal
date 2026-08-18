import { z } from "zod";
import { ProposalClassSchema } from "./project.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ProjectRelativePathSchema = z.string().min(1);

export const ResearchLockSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  longtableVersion: z.string().min(1),
  projectId: z.string().min(1),
  proposalClass: ProposalClassSchema,
  researchSpecificationPath: ProjectRelativePathSchema,
  researchSpecificationSha256: Sha256Schema,
  citationSlotMatrixPath: ProjectRelativePathSchema,
  citationSlotMatrixSha256: Sha256Schema,
  sourceLedgerPath: ProjectRelativePathSchema,
  sourceLedgerSha256: Sha256Schema,
  claimTransferLedgerPath: ProjectRelativePathSchema,
  claimTransferLedgerSha256: Sha256Schema,
  openRequiredCheckpoints: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
}).strict();

export type ResearchLock = z.infer<typeof ResearchLockSchema>;
