import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceLedger, PageArchitectureManifest, ReferenceManifest } from "@longtable/kpp-schemas";
import { validateReferenceManifest } from "../src/index.js";

const SOURCE_SHA256 = "d347e1e682594a9b1124e9e797fa850402f2faa898adaa621ec9af744e543ea9";
const temporaryDirectories: string[] = [];

function fixture(): { manifest: ReferenceManifest; architecture: PageArchitectureManifest; evidence: EvidenceLedger } {
  const root = mkdtempSync(join(tmpdir(), "kpp-reference-"));
  temporaryDirectories.push(root);
  const sourcePath = join(root, "source.txt");
  writeFileSync(sourcePath, "official source\n", "utf8");
  return {
    manifest: {
      schemaVersion: "2.0.0",
      projectId: "fixture-project",
      documentMode: "public_procurement",
      modePolicyVersion: "1.0.0",
      references: [{
        referenceId: "SRC-001",
        referenceClass: "official",
        sourcePath,
        sourceSha256: SOURCE_SHA256,
        targets: [{ kind: "claim", id: "CLAIM-001" }, { kind: "page", id: "PAGE-001" }],
        verificationStatus: "verified",
        availability: "available",
      }],
    },
    architecture: {
      schemaVersion: "2.0.0",
      projectId: "fixture-project",
      documentMode: "public_procurement",
      modePolicyVersion: "1.0.0",
      chapters: [{ chapterId: "CH-001" }],
      sections: [{ sectionId: "SEC-001", chapterId: "CH-001" }],
      pages: [{
        pageId: "PAGE-001",
        chapterId: "CH-001",
        sectionId: "SEC-001",
        pageRole: "requirement_response",
        surfaceTemplateId: "evidence_analysis",
        titleScope: "chapter",
        continuation: false,
        dominantSurface: "mixed",
        surfaceVisibility: "internal",
        claimIds: ["CLAIM-001"],
        proofIds: ["PROOF-001"],
        referenceIds: ["SRC-001"],
        figureIds: ["FIG-001"],
      }],
    },
    evidence: {
      schemaVersion: "1.0.0",
      claims: [{ claimId: "CLAIM-001", status: "verified", evidenceIds: ["PROOF-001"] }],
      bindings: [{
        evidenceId: "PROOF-001",
        sourcePath,
        sourceSha256: SOURCE_SHA256,
        scope: "official source",
        claimIds: ["CLAIM-001"],
        targetRequirementId: "REQ-001",
        targetPageId: "PAGE-001",
        targetPageRole: "requirement_response",
      }],
    },
  };
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("validateReferenceManifest", () => {
  it("accepts a verified reference manifest", () => {
    const value = fixture();
    expect(validateReferenceManifest(value.manifest, value.architecture, value.evidence))
      .toEqual({ status: "PASS", findings: [] });
  });

  it("rejects dangling SRC-004 architecture references", () => {
    const value = fixture();
    value.architecture.pages[0] = { ...value.architecture.pages[0]!, referenceIds: ["SRC-001", "SRC-004"] };
    expect(validateReferenceManifest(value.manifest, value.architecture, value.evidence)).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "KPP_REF_DANGLING_ID", evidence: expect.objectContaining({ locator: "page:PAGE-001/reference:SRC-004" }) })]),
    });
  });

  it("rejects a stale local source hash", () => {
    const value = fixture();
    value.manifest.references[0] = { ...value.manifest.references[0]!, sourceSha256: "a".repeat(64) };
    expect(validateReferenceManifest(value.manifest, value.architecture, value.evidence)).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "KPP_REF_STALE_HASH", evidence: expect.objectContaining({ locator: "reference:SRC-001" }) })]),
    });
  });

  it("rejects targets not declared by the architecture", () => {
    const value = fixture();
    value.manifest.references[0] = { ...value.manifest.references[0]!, targets: [{ kind: "claim", id: "CLAIM-404" }] };
    expect(validateReferenceManifest(value.manifest, value.architecture, value.evidence)).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "KPP_REF_UNDECLARED_TARGET", evidence: expect.objectContaining({ locator: "reference:SRC-001/target:claim:CLAIM-404" }) })]),
    });
  });

  it("rejects unavailable declarations that still point to local bytes", () => {
    const value = fixture();
    value.manifest.references[0] = {
      ...value.manifest.references[0]!, sourceSha256: undefined, availability: "unavailable", verificationStatus: "unavailable",
    };
    expect(validateReferenceManifest(value.manifest, value.architecture, value.evidence)).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "KPP_REF_UNAVAILABLE_SOURCE", evidence: expect.objectContaining({ locator: "reference:SRC-001" }) })]),
    });
  });

  it("accepts a permitted issuer title override backed by a declared source", () => {
    const value = fixture();
    value.architecture.pages[0] = {
      ...value.architecture.pages[0]!,
      continuation: true,
      issuerOverride: {
        documentMode: "public_procurement",
        modePolicyVersion: "1.0.0",
        sourceId: "SRC-001",
        reason: "Issuer form requires the heading.",
      },
    };
    expect(validateReferenceManifest(value.manifest, value.architecture, value.evidence))
      .toEqual({ status: "PASS", findings: [] });
  });

  it("rejects issuer overrides whose source is undeclared", () => {
    const value = fixture();
    value.architecture.pages[0] = {
      ...value.architecture.pages[0]!,
      issuerOverride: {
        documentMode: "public_procurement",
        modePolicyVersion: "1.0.0",
        sourceId: "SRC-404",
        reason: "Unbound override.",
      },
    };
    expect(validateReferenceManifest(value.manifest, value.architecture, value.evidence)).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "KPP_REF_ISSUER_OVERRIDE_INVALID", evidence: expect.objectContaining({ locator: "page:PAGE-001/issuerOverride" }) })]),
    });
  });

  it("rejects reference classes not allowed by the selected mode", () => {
    const value = fixture();
    value.manifest.references[0] = { ...value.manifest.references[0]!, referenceClass: "private_partner_only" };
    expect(validateReferenceManifest(value.manifest, value.architecture, value.evidence)).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "KPP_REF_CLASS_NOT_ALLOWED", evidence: expect.objectContaining({ locator: "reference:SRC-001" }) })]),
    });
  });
});
