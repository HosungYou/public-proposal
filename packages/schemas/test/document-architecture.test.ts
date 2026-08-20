import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MODES,
  DocumentModeSchema,
  PageArchitectureManifestSchema,
  PageArchitecturePageSchema,
  ReferenceManifestSchema,
  ReferenceTargetSchema,
} from "../src/index.js";

const page = {
  pageId: "PAGE-001",
  chapterId: "CH-01",
  sectionId: "SEC-01",
  pageRole: "cover",
  surfaceTemplateId: "cover-v1",
  titleScope: "cover" as const,
  continuation: false,
  dominantSurface: "narrative" as const,
  surfaceVisibility: "reader" as const,
  claimIds: ["CLAIM-001"],
  proofIds: ["PROOF-001"],
  referenceIds: ["REF-001"],
  figureIds: [],
};

describe("document architecture contracts", () => {
  it("accepts exactly the five supported document modes", () => {
    expect(DOCUMENT_MODES).toEqual([
      "public_procurement",
      "research_service",
      "private_partnership",
      "internal_decision",
      "document_restyle",
    ]);
    expect(DOCUMENT_MODES.map((mode) => DocumentModeSchema.parse(mode))).toEqual(DOCUMENT_MODES);
    expect(() => DocumentModeSchema.parse("general_procurement")).toThrow();
  });

  it("requires an issuer override before a continuation page can use chapter title scope", () => {
    expect(() => PageArchitecturePageSchema.parse({
      ...page,
      pageId: "PAGE-002",
      titleScope: "chapter",
      continuation: true,
    })).toThrow(/issuer override/i);

    expect(PageArchitecturePageSchema.parse({
      ...page,
      pageId: "PAGE-002",
      titleScope: "chapter",
      continuation: true,
      issuerOverride: { ruleId: "FORM-001", reason: "issuer form requires chapter heading" },
    }).pageId).toBe("PAGE-002");
  });

  it("requires non-empty target and reference identifiers", () => {
    expect(() => ReferenceTargetSchema.parse({ kind: "claim", id: "" })).toThrow();
    expect(() => ReferenceManifestSchema.parse({
      schemaVersion: "2.0.0",
      projectId: "project-1",
      documentMode: "research_service",
      modePolicyVersion: "1.0.0",
      references: [{
        referenceId: "",
        referenceClass: "official",
        targets: [{ kind: "claim", id: "CLAIM-001" }],
      }],
    })).toThrow();
  });

  it("accepts a minimal architecture and reference manifest", () => {
    const architecture = PageArchitectureManifestSchema.parse({
      schemaVersion: "2.0.0",
      projectId: "project-1",
      documentMode: "research_service",
      modePolicyVersion: "1.0.0",
      chapters: [{ chapterId: "CH-01", title: "연구 개요" }],
      sections: [{ sectionId: "SEC-01", chapterId: "CH-01", title: "배경" }],
      pages: [page],
    });
    expect(architecture.pages).toHaveLength(1);

    const references = ReferenceManifestSchema.parse({
      schemaVersion: "2.0.0",
      projectId: "project-1",
      documentMode: "research_service",
      modePolicyVersion: "1.0.0",
      references: [{
        referenceId: "REF-001",
        referenceClass: "official",
        sourceUri: "https://example.test/source",
        sourceSha256: "a".repeat(64),
        targets: [{ kind: "claim", id: "CLAIM-001" }],
        verificationStatus: "verified",
        verificationDate: "2026-08-20",
      }],
    });
    expect(references.references[0]?.referenceId).toBe("REF-001");
  });
});
