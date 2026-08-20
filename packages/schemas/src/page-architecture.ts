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
export const ArchitectureStatusSchema = z.enum(["staged", "complete"]);

const DominantSurfaceSchema = z.enum([
  "narrative",
  "table",
  "figure",
  "mixed",
  "form",
]);

export const SurfaceRepetitionExceptionRuleSchema = z.enum([
  "issuer_mandatory_form",
  "accessibility_repeated_instruction",
]);

/** A verified issuer/source authority for a reader-facing repeated surface. */
export const SurfaceRepetitionExceptionSchema = z.object({
  ruleId: SurfaceRepetitionExceptionRuleSchema,
  sourceId: IdentifierSchema,
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  rationale: IdentifierSchema,
}).strict();

/** A source/issuer rule that justifies an exception to the title hierarchy. */
export const IssuerOverrideSchema = z.object({
  documentMode: DocumentModeSchema,
  modePolicyVersion: IdentifierSchema,
  ruleId: IdentifierSchema.optional(),
  sourceId: IdentifierSchema.optional(),
  reason: IdentifierSchema,
}).strict().superRefine((value, context) => {
  if (value.ruleId === undefined && value.sourceId === undefined) {
    context.addIssue({
      code: "custom",
      message: "issuer override must identify a ruleId or sourceId",
      path: ["ruleId"],
    });
  }
  if (value.ruleId !== undefined && value.sourceId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "issuer override must identify either ruleId or sourceId, not both",
      path: ["ruleId"],
    });
  }
});

export const PageArchitecturePageSchema = z.object({
  pageId: IdentifierSchema,
  chapterId: IdentifierSchema,
  sectionId: IdentifierSchema,
  pageRole: IdentifierSchema,
  surfaceTemplateId: IdentifierSchema,
  titleScope: PageTitleScopeSchema,
  titlePointSize: z.number().finite().positive().max(72).optional(),
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
  surfaceRepetitionException: SurfaceRepetitionExceptionSchema.optional(),
}).passthrough().superRefine((page, context) => {
  if (page.continuation && page.titleScope === "chapter" && page.issuerOverride === undefined) {
    context.addIssue({
      code: "custom",
      message: "continuation pages cannot use chapter title scope without an issuer override",
      path: ["issuerOverride"],
    });
  }
  if (page.surfaceRepetitionException !== undefined
    && !page.referenceIds.includes(page.surfaceRepetitionException.sourceId)) {
    context.addIssue({
      code: "custom",
      message: "surface repetition exception sourceId must be declared by the page",
      path: ["surfaceRepetitionException", "sourceId"],
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
  architectureStatus: ArchitectureStatusSchema,
  chapters: z.array(ChapterSchema).default([]),
  sections: z.array(SectionSchema).default([]),
  pages: z.array(PageArchitecturePageSchema).min(1),
}).passthrough().superRefine((manifest, context) => {
  manifest.pages.forEach((page, index) => {
    if (page.issuerOverride === undefined) return;
    if (page.issuerOverride.documentMode !== manifest.documentMode) {
      context.addIssue({
        code: "custom",
        message: "issuer override documentMode must match the architecture manifest",
        path: ["pages", index, "issuerOverride", "documentMode"],
      });
    }
    if (page.issuerOverride.modePolicyVersion !== manifest.modePolicyVersion) {
      context.addIssue({
        code: "custom",
        message: "issuer override modePolicyVersion must match the architecture manifest",
        path: ["pages", index, "issuerOverride", "modePolicyVersion"],
      });
    }
  });
});

export type PageTitleScope = z.infer<typeof PageTitleScopeSchema>;
export type ArchitectureStatus = z.infer<typeof ArchitectureStatusSchema>;
export type PageSurfaceVisibility = z.infer<typeof PageSurfaceVisibilitySchema>;
export type SurfaceRepetitionException = z.infer<typeof SurfaceRepetitionExceptionSchema>;
export type IssuerOverride = z.infer<typeof IssuerOverrideSchema>;
export type PageArchitecturePage = z.infer<typeof PageArchitecturePageSchema>;
export type PageArchitectureManifest = z.infer<typeof PageArchitectureManifestSchema>;
