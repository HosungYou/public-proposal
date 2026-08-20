import { z } from "zod";

/** The reader decision and page grammar a document is being built for. */
export const DOCUMENT_MODES = [
  "public_procurement",
  "research_service",
  "private_partnership",
  "internal_decision",
  "document_restyle",
] as const;

export const DocumentModeSchema = z.enum(DOCUMENT_MODES);

export type DocumentMode = z.infer<typeof DocumentModeSchema>;
