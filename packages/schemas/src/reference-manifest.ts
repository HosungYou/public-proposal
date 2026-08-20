import { z } from "zod";
import { DocumentModeSchema } from "./document-mode.js";

const IdentifierSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** Reference classes are intentionally extensible: issuers may name local source classes. */
export const ReferenceClassSchema = IdentifierSchema;

const ReferenceTargetKindSchema = z.enum([
  "claim",
  "proof",
  "page",
  "figure",
  "table",
  "quotation",
]);

/** A target may be written with either the canonical kind/id pair or targetType/targetId aliases. */
export const ReferenceTargetSchema = z.object({
  kind: ReferenceTargetKindSchema.optional(),
  id: IdentifierSchema.optional(),
  targetType: ReferenceTargetKindSchema.optional(),
  targetId: IdentifierSchema.optional(),
}).passthrough().superRefine((target, context) => {
  const hasCanonical = target.kind !== undefined || target.id !== undefined;
  const hasAliases = target.targetType !== undefined || target.targetId !== undefined;
  if (!hasCanonical && !hasAliases) {
    context.addIssue({ code: "custom", message: "reference target requires a target kind and id" });
    return;
  }
  if (hasCanonical && (target.kind === undefined || target.id === undefined)) {
    context.addIssue({ code: "custom", message: "reference target kind and id must be non-empty" });
  }
  if (hasAliases && (target.targetType === undefined || target.targetId === undefined)) {
    context.addIssue({ code: "custom", message: "reference target targetType and targetId must be non-empty" });
  }
});

const VerificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "external",
  "unavailable",
]);

const AvailabilitySchema = z.enum(["available", "external", "unavailable"]);

export const ReferenceRecordSchema = z.object({
  referenceId: IdentifierSchema,
  referenceClass: ReferenceClassSchema,
  path: z.string().trim().min(1).optional(),
  uri: z.string().trim().min(1).optional(),
  sourcePath: z.string().trim().min(1).optional(),
  sourceUri: z.string().trim().min(1).optional(),
  locator: IdentifierSchema.optional(),
  classification: IdentifierSchema.optional(),
  rightsStatus: IdentifierSchema.optional(),
  sourceSha256: Sha256Schema.optional(),
  sha256: Sha256Schema.optional(),
  targets: z.array(ReferenceTargetSchema).min(1),
  verificationStatus: VerificationStatusSchema.optional(),
  verificationDate: z.string().trim().min(1).optional(),
  verifiedAt: z.string().datetime({ offset: true }).optional(),
  availability: AvailabilitySchema.optional(),
}).passthrough().superRefine((reference, context) => {
  if (!reference.path && !reference.uri && !reference.sourcePath && !reference.sourceUri) {
    context.addIssue({
      code: "custom",
      message: "reference must declare a local path or URI",
      path: ["sourcePath"],
    });
  }
  const unavailable = reference.availability === "unavailable"
    || reference.verificationStatus === "unavailable";
  if (unavailable && (reference.sourceSha256 !== undefined || reference.sha256 !== undefined)) {
    context.addIssue({
      code: "custom",
      message: "unavailable references cannot declare a source SHA-256",
      path: ["sourceSha256"],
    });
  }
});

export const ReferenceManifestSchema = z.object({
  schemaVersion: z.string().trim().min(1),
  projectId: IdentifierSchema,
  documentMode: DocumentModeSchema,
  modePolicyVersion: z.string().trim().min(1),
  references: z.array(ReferenceRecordSchema),
}).passthrough();

export type ReferenceClass = z.infer<typeof ReferenceClassSchema>;
export type ReferenceTarget = z.infer<typeof ReferenceTargetSchema>;
export type ReferenceRecord = z.infer<typeof ReferenceRecordSchema>;
export type ReferenceManifest = z.infer<typeof ReferenceManifestSchema>;
