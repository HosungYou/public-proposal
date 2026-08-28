import { z } from "zod";
import { SemanticFigureSpecSchema } from "./figure-spec.js";

const IdentifierSchema = z.string().trim().min(1);

export const PagePlanItemSchema = z.object({
  pageId: IdentifierSchema,
  requirementId: IdentifierSchema,
  pageRole: IdentifierSchema,
  surfaceTemplateId: IdentifierSchema,
  claimIds: z.array(IdentifierSchema),
  figureSpecs: z.array(SemanticFigureSpecSchema),
  sourceCandidateIds: z.array(IdentifierSchema).min(1).optional(),
});

export const PagePlanSchema = z.object({
  schemaVersion: z.string().min(1),
  pages: z.array(PagePlanItemSchema).min(1),
});

export type PagePlan = z.infer<typeof PagePlanSchema>;
export type PagePlanItem = z.infer<typeof PagePlanItemSchema>;
