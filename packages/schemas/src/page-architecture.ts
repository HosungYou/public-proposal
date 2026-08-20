import { z } from "zod";
import { DocumentModeSchema } from "./document-mode.js";

const IdentifierSchema = z.string().trim().min(1);

export const PageTitleScopeSchema = z.enum([
  "cover",
  "chapter",
  "section",
  "surface",
  "none",
]);

export const PageSurfaceVisibilitySchema = z.enum(["internal", "reader"]);

const DominantSurfaceSchema = z.enum([
  "narrative",
  "table",
  "figure",
  "mixed",
  "form",
]);

/** A source/issuer rule that justifies an exception to the title hierarchy. */
export const IssuerOverrideSchema = z.union([
  IdentifierSchema,
  z.object({
    ruleId: IdentifierSchema.optional(),
    sourceRuleId: IdentifierSchema.optional(),
    reason: IdentifierSchema.optional(),
    rationale: IdentifierSchema.optional(),
    approvedBy: IdentifierSchema.optional(),
  }).passthrough().superRefine((value, context) => {
    if (!value.ruleId && !value.sourceRuleId && !value.reason && !value.rationale) {
      context.addIssue({
        code: "custom",
        message: "issuer override must identify a source rule or reason",
      });
    }
  }),
]);

export const PageArchitecturePageSchema = z.object({
  pageId: IdentifierSchema,
  chapterId: IdentifierSchema,
  sectionId: IdentifierSchema,
  pageRole: IdentifierSchema,
  surfaceTemplateId: IdentifierSchema,
  titleScope: PageTitleScopeSchema,
  continuation: z.boolean(),
  dominantSurface: DominantSurfaceSchema,
  surfaceVisibility: PageSurfaceVisibilitySchema.default("internal"),
  evaluationQuestion: z.string().trim().min(1).optional(),
  directAnswer: z.string().trim().min(1).optional(),
  claimIds: z.array(IdentifierSchema).default([]),
  proofIds: z.array(IdentifierSchema).default([]),
  referenceIds: z.array(IdentifierSchema).default([]),
  figureIds: z.array(IdentifierSchema).default([]),
  continuityFromPageId: IdentifierSchema.optional(),
  continuityToPageId: IdentifierSchema.optional(),
  issuerOverride: IssuerOverrideSchema.optional(),
}).passthrough().superRefine((page, context) => {
  if (page.continuation && page.titleScope === "chapter" && page.issuerOverride === undefined) {
    context.addIssue({
      code: "custom",
      message: "continuation pages cannot use chapter title scope without an issuer override",
      path: ["issuerOverride"],
    });
  }
});

const ChapterSchema = z.object({
  chapterId: IdentifierSchema,
  title: z.string().trim().min(1).optional(),
  order: z.number().int().nonnegative().optional(),
}).passthrough();

const SectionSchema = z.object({
  sectionId: IdentifierSchema,
  chapterId: IdentifierSchema,
  title: z.string().trim().min(1).optional(),
  order: z.number().int().nonnegative().optional(),
}).passthrough();

export const PageArchitectureManifestSchema = z.object({
  schemaVersion: z.string().trim().min(1),
  projectId: IdentifierSchema,
  documentMode: DocumentModeSchema,
  modePolicyVersion: z.string().trim().min(1),
  chapters: z.array(ChapterSchema).default([]),
  sections: z.array(SectionSchema).default([]),
  pages: z.array(PageArchitecturePageSchema).min(1),
}).passthrough();

export type PageTitleScope = z.infer<typeof PageTitleScopeSchema>;
export type PageSurfaceVisibility = z.infer<typeof PageSurfaceVisibilitySchema>;
export type IssuerOverride = z.infer<typeof IssuerOverrideSchema>;
export type PageArchitecturePage = z.infer<typeof PageArchitecturePageSchema>;
export type PageArchitectureManifest = z.infer<typeof PageArchitectureManifestSchema>;
