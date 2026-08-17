import { z } from "zod";
import { FigureSpecSchema } from "./requirements.js";

const IdentifierSchema = z.string().min(1);

export const PagePlanItemSchema = z.object({
  pageId: IdentifierSchema,
  requirementId: IdentifierSchema,
  pageRole: IdentifierSchema,
  surfaceTemplateId: IdentifierSchema,
  claimIds: z.array(IdentifierSchema),
  figureSpecs: z.array(FigureSpecSchema),
});

export const PagePlanSchema = z.object({
  schemaVersion: z.string().min(1),
  pages: z.array(PagePlanItemSchema).min(1),
});

export type PagePlan = z.infer<typeof PagePlanSchema>;
export type PagePlanItem = z.infer<typeof PagePlanItemSchema>;
