import { z } from "zod";
import { ProjectStateSchema } from "./project.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const ReceiptFileSchema = z.object({
  path: z.string().min(1),
  sha256: Sha256Schema,
});

export const ReceiptInputSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  sha256: Sha256Schema,
});

export const ReceiptResultSchema = z.enum(["PASS", "BLOCKED"]);

export const ReceiptSchema = z.object({
  schemaVersion: z.string().min(1),
  stage: ProjectStateSchema,
  createdAt: z.string().datetime(),
  toolVersion: z.string().min(1),
  files: z.array(ReceiptFileSchema),
  inputs: z.array(ReceiptInputSchema).default([]),
  inputReceiptHashes: z.array(Sha256Schema),
  result: ReceiptResultSchema,
}).superRefine((receipt, context) => {
  if (receipt.result === "PASS" && receipt.files.length === 0) {
    context.addIssue({
      code: "custom",
      message: "PASS receipts must bind at least one file",
      path: ["files"],
    });
  }
});

export type ReceiptFile = z.infer<typeof ReceiptFileSchema>;
export type ReceiptInputRecord = z.infer<typeof ReceiptInputSchema>;
export type ReceiptResult = z.infer<typeof ReceiptResultSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
