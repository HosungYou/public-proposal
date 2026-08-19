import { z } from "zod";

const IdentifierSchema = z.string().min(1);

export const ArgumentMoveSchema = z.enum([
  "problem",
  "evidence",
  "interpretation",
  "method",
  "limit",
  "decision",
  "action",
]);

export const VisualNeedV1Schema = z.object({
  needId: IdentifierSchema,
  purpose: z.string().min(1),
  evidenceIds: z.array(IdentifierSchema),
}).strict();

export const SectionPlanItemV1Schema = z.object({
  sectionId: IdentifierSchema,
  parentSectionId: IdentifierSchema.nullable(),
  purpose: z.string().min(1),
  readerTasks: z.array(z.string().min(1)),
  requirementIds: z.array(IdentifierSchema),
  claimIds: z.array(IdentifierSchema),
  evidenceIds: z.array(IdentifierSchema),
  argumentMoves: z.array(ArgumentMoveSchema),
  visualNeeds: z.array(VisualNeedV1Schema),
  openDecisionIds: z.array(IdentifierSchema),
  representativeRole: z.enum(["problem", "method", "execution"]).nullable(),
}).strict();

export const SectionPlanV1Schema = z.object({
  schemaVersion: z.literal("section-plan/v1"),
  projectId: IdentifierSchema,
  sections: z.array(SectionPlanItemV1Schema),
}).strict();

export type ArgumentMove = z.infer<typeof ArgumentMoveSchema>;
export type VisualNeedV1 = z.infer<typeof VisualNeedV1Schema>;
export type SectionPlanItemV1 = z.infer<typeof SectionPlanItemV1Schema>;
export type SectionPlanV1 = z.infer<typeof SectionPlanV1Schema>;
