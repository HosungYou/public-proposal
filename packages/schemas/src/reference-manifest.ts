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

/** Stable, unambiguous target representation used by every reference record. */
export const ReferenceTargetSchema = z.object({
  kind: ReferenceTargetKindSchema,
  id: IdentifierSchema,
}).strict();

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
}).passthrough().superRefine((manifest, context) => {
  const seen = new Set<string>();
  manifest.references.forEach((reference, index) => {
    if (seen.has(reference.referenceId)) {
      context.addIssue({
        code: "custom",
        message: `referenceId must be unique: ${reference.referenceId}`,
        path: ["references", index, "referenceId"],
      });
    }
    seen.add(reference.referenceId);
  });
});

export type ReferenceClass = z.infer<typeof ReferenceClassSchema>;
export type ReferenceTarget = z.infer<typeof ReferenceTargetSchema>;
export type ReferenceRecord = z.infer<typeof ReferenceRecordSchema>;
export type ReferenceManifest = z.infer<typeof ReferenceManifestSchema>;
