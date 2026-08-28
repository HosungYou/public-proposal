import { z } from "zod";
import { DocumentModeSchema } from "./document-mode.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const AuditStatusSchema = z.enum(["PASS", "BLOCKED"]);
export const AuditFindingSeveritySchema = z.enum(["BLOCKER", "WARNING", "INFO"]);
export const AuditReviewerTypeSchema = z.enum(["machine", "korean_prose_reviewer", "human_reviewer"]);

export const AuditInputHashSchema = z.object({
  path: z.string().trim().min(1),
  sha256: Sha256Schema,
}).strict();

export const AuditArtifactBindingSchema = AuditInputHashSchema.extend({
  artifactClass: z.string().trim().min(1).regex(/^[a-z][a-z0-9_]*$/u),
  bytes: z.number().int().positive(),
}).strict();

export const AuditRuleFindingSchema = z.object({
  ruleId: z.string().trim().min(1),
  severity: AuditFindingSeveritySchema,
  message: z.string().trim().min(1),
  locator: z.string().trim().min(1).optional(),
  expected: z.unknown().optional(),
  observed: z.unknown().optional(),
  remediation: z.string().trim().min(1).optional(),
}).strict();

export const AuditReviewerScopeSchema = z.object({
  reviewerType: AuditReviewerTypeSchema,
  reviewedLocators: z.array(z.string().trim().min(1)),
  excludedLocators: z.array(z.string().trim().min(1)),
}).strict();

export const AuditSliceReceiptSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  sliceId: z.string().trim().min(1).regex(/^[a-z][a-z0-9_]*$/u),
  projectId: z.string().trim().min(1),
  documentMode: DocumentModeSchema,
  modePolicyVersion: z.string().trim().min(1),
  status: AuditStatusSchema,
  inputHashes: z.array(AuditInputHashSchema).min(1),
  findings: z.array(AuditRuleFindingSchema),
  reviewerScope: AuditReviewerScopeSchema,
  artifactBindings: z.array(AuditArtifactBindingSchema).min(1),
}).strict().superRefine((receipt, context) => {
  const hasBlocker = receipt.findings.some(({ severity }) => severity === "BLOCKER");
  if ((receipt.status === "PASS" && hasBlocker) || (receipt.status === "BLOCKED" && !hasBlocker)) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "slice status must be PASS exactly when no BLOCKER finding exists",
    });
  }
});

export const CompositeAuditReceiptSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  projectId: z.string().trim().min(1),
  documentMode: DocumentModeSchema,
  modePolicyVersion: z.string().trim().min(1),
  status: AuditStatusSchema,
  inputHashes: z.array(AuditInputHashSchema).min(1),
  slices: z.array(AuditSliceReceiptSchema).min(1),
  artifactBindings: z.array(AuditArtifactBindingSchema).min(1),
  findings: z.array(z.object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    path: z.string().trim().min(1).optional(),
    expected: z.unknown().optional(),
    actual: z.unknown().optional(),
  }).strict()).optional(),
  artifacts: z.array(z.object({
    path: z.string().trim().min(1),
    sha256: Sha256Schema,
    bytes: z.number().int().positive(),
  }).strict()).optional(),
  humanBoundary: z.literal("TECHNICAL_GATE_ONLY"),
}).strict().superRefine((receipt, context) => {
  const sliceIds = new Set<string>();
  for (const [index, slice] of receipt.slices.entries()) {
    if (sliceIds.has(slice.sliceId)) {
      context.addIssue({ code: "custom", path: ["slices", index, "sliceId"], message: "slice IDs must be unique" });
    }
    sliceIds.add(slice.sliceId);
    if (slice.projectId !== receipt.projectId
      || slice.documentMode !== receipt.documentMode
      || slice.modePolicyVersion !== receipt.modePolicyVersion) {
      context.addIssue({ code: "custom", path: ["slices", index], message: "slice identity must match composite identity" });
    }
  }
  const hasBlockedSlice = receipt.slices.some(({ status }) => status === "BLOCKED");
  if ((receipt.status === "PASS" && hasBlockedSlice) || (receipt.status === "BLOCKED" && !hasBlockedSlice)) {
    context.addIssue({ code: "custom", path: ["status"], message: "composite status must reflect slice statuses" });
  }
  const compositeInputs = new Set(receipt.inputHashes.map(inputKey));
  const sliceInputs = new Set(receipt.slices.flatMap(({ inputHashes }) => inputHashes.map(inputKey)));
  if (!sameSet(compositeInputs, sliceInputs)) {
    context.addIssue({ code: "custom", path: ["inputHashes"], message: "composite input hashes must exactly equal the slice input hash union" });
  }
  const compositeArtifacts = new Set(receipt.artifactBindings.map(artifactKey));
  const sliceArtifacts = new Set(receipt.slices.flatMap(({ artifactBindings }) => artifactBindings.map(artifactKey)));
  if (!sameSet(compositeArtifacts, sliceArtifacts)) {
    context.addIssue({ code: "custom", path: ["artifactBindings"], message: "composite artifact bindings must exactly equal the slice artifact union" });
  }
});

function inputKey(input: { readonly path: string; readonly sha256: string }): string {
  return `${input.path}\0${input.sha256}`;
}

function artifactKey(artifact: { readonly artifactClass: string; readonly path: string; readonly sha256: string; readonly bytes: number }): string {
  return `${artifact.artifactClass}\0${artifact.path}\0${artifact.sha256}\0${artifact.bytes}`;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export type AuditStatus = z.infer<typeof AuditStatusSchema>;
export type AuditFindingSeverity = z.infer<typeof AuditFindingSeveritySchema>;
export type AuditReviewerType = z.infer<typeof AuditReviewerTypeSchema>;
export type AuditInputHash = z.infer<typeof AuditInputHashSchema>;
export type AuditArtifactBinding = z.infer<typeof AuditArtifactBindingSchema>;
export type AuditRuleFinding = z.infer<typeof AuditRuleFindingSchema>;
export type AuditReviewerScope = z.infer<typeof AuditReviewerScopeSchema>;
export type AuditSliceReceipt = z.infer<typeof AuditSliceReceiptSchema>;
export type CompositeAuditReceipt = z.infer<typeof CompositeAuditReceiptSchema>;
