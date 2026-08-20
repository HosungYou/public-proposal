import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { sha256File, writeReceipt } from "@longtable/kpp-core";
import type { AuditArtifactBinding, AuditSliceReceipt, DocumentMode } from "@longtable/kpp-schemas";
import { validateCompositeAuditReceiptForRelease } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(documentMode: DocumentMode = "private_partnership") {
  const root = await mkdtemp(join(tmpdir(), "kpp-mode-release-"));
  roots.push(root);
  const paths = {
    architecture: join(root, "content", "page-architecture.json"),
    references: join(root, "evidence", "reference-manifest.json"),
    observations: join(root, "audit", "docx-geometry.json"),
    evidence: join(root, "evidence", "evidence-ledger.json"),
    authoring: join(root, "content", "authoring-response.json"),
    contentReceipt: join(root, "receipts", "content-approval.json"),
    source: join(root, "evidence", "source.txt"),
    audit: join(root, "audit", "audit.json"),
  };
  await Promise.all([mkdir(join(root, "content")), mkdir(join(root, "evidence")), mkdir(join(root, "audit")), mkdir(join(root, "receipts"))]);
  await writeFile(paths.source, "verified source bytes\n");
  const sourceSha256 = await sha256File(paths.source);
  const projectId = `${documentMode}-fixture`;
  const roleSlices: Readonly<Record<DocumentMode, Readonly<Record<string, readonly string[]>>>> = {
    public_procurement: { procurement_evaluation_crosswalk: ["procurement_evaluation_crosswalk"] },
    research_service: { research_method_traceability: ["research_method", "evidence_plan"] },
    private_partnership: { operating_model_traceability: ["party_roles", "operating_model", "next_decision"] },
    internal_decision: {
      decision_traceability: ["decision_request", "alternatives", "tradeoffs", "owner_approval"],
      risk_owner_traceability: ["risk_register", "owner_approval"],
    },
    document_restyle: {
      source_output_traceability: ["source_inventory", "content_ledger", "mutation_report"],
      layout_accessibility: ["layout_accessibility", "acceptance_record"],
      mutation_integrity: ["content_ledger", "mutation_report", "acceptance_record"],
    },
  };
  const requiredRoles: Readonly<Record<DocumentMode, readonly string[]>> = {
    public_procurement: ["executive_summary", "procurement_evaluation_crosswalk", "requirement_response", "delivery_control"],
    research_service: ["research_question", "research_method", "evidence_plan", "limitations", "utilization_plan"],
    private_partnership: ["mutual_value", "party_roles", "operating_model", "collaboration_options", "next_decision"],
    internal_decision: ["decision_request", "alternatives", "tradeoffs", "risk_register", "owner_approval"],
    document_restyle: ["source_inventory", "content_ledger", "layout_accessibility", "mutation_report", "acceptance_record"],
  };
  const baseRole = requiredRoles[documentMode][0]!;
  const architecturePages = requiredRoles[documentMode]
    .map((pageRole, index) => ({
      pageId: index === 0 ? "P-01" : `P-${String(index + 1).padStart(2, "0")}`,
      chapterId: "C-01",
      sectionId: "S-01",
      pageRole,
      surfaceTemplateId: "fixture-v1",
      titleScope: index === 0 ? "chapter" : "none",
      continuation: index !== 0,
      dominantSurface: "narrative",
      surfaceVisibility: "reader",
      claimIds: index === 0 ? ["claim-1"] : [],
      proofIds: index === 0 ? ["ref-1"] : [],
      referenceIds: index === 0 ? ["ref-1"] : [],
      figureIds: [],
    }));
  await writeFile(paths.architecture, `${JSON.stringify({
    schemaVersion: "2.0.0",
    projectId,
    documentMode,
    modePolicyVersion: "1.0.0",
    architectureStatus: "complete",
    chapters: [{ chapterId: "C-01", title: "Fixture" }],
    sections: [{ sectionId: "S-01", chapterId: "C-01", title: "Fixture" }],
    pages: architecturePages,
  })}\n`);
  await writeFile(paths.references, `${JSON.stringify({
    schemaVersion: "2.0.0",
    projectId,
    documentMode,
    modePolicyVersion: "1.0.0",
    references: [{
      referenceId: "ref-1",
      referenceClass: "evidence",
      sourcePath: paths.source,
      sourceSha256,
      targets: [{ kind: "claim", id: "claim-1" }],
      verificationStatus: "verified",
      availability: "available",
    }],
  })}\n`);
  await writeFile(paths.observations, "observations-v1\n");
  await writeFile(paths.evidence, `${JSON.stringify({
    schemaVersion: "1.0.0",
    claims: [{ claimId: "claim-1", status: "verified", evidenceIds: ["ref-1"] }],
    bindings: [{
      evidenceId: "ref-1",
      sourcePath: paths.source,
      sourceSha256,
      scope: "fixture source",
      claimIds: ["claim-1"],
      targetRequirementId: "REQ-1",
      targetPageId: "P-01",
      targetPageRole: baseRole,
    }],
  })}\n`);
  await writeFile(paths.authoring, "authoring-v1\n");
  await writeReceipt({ stage: "CONTENT_APPROVED", files: [paths.authoring], output: paths.contentReceipt });
  const binding = async (artifactClass: string, path: string): Promise<AuditArtifactBinding> => ({
    artifactClass, path, sha256: await sha256File(path), bytes: (await stat(path)).size,
  });
  const artifacts = {
    architecture: await binding("page_architecture", paths.architecture),
    references: await binding("reference_manifest", paths.references),
    observations: await binding("render_observation", paths.observations),
    evidence: await binding("evidence_ledger", paths.evidence),
    authoring: await binding("authoring_response", paths.authoring),
    contentReceipt: await binding("content_approval_receipt", paths.contentReceipt),
  };
  const pageByRole = new Map(architecturePages.map(({ pageId, pageRole }) => [pageRole, pageId]));
  const definition: Array<{ id: string; bindings: AuditArtifactBinding[]; locators: string[] }> = [
    { id: "page_architecture", bindings: [artifacts.architecture, artifacts.observations], locators: ["page:P-01"] },
    { id: "reference_integrity", bindings: [artifacts.architecture, artifacts.references, artifacts.evidence], locators: ["reference:ref-1", "evidence:ref-1"] },
    { id: "render_repetition", bindings: [artifacts.architecture, artifacts.observations], locators: ["page:P-01"] },
    { id: "figure_value", bindings: [artifacts.authoring, artifacts.contentReceipt], locators: ["figure:none"] },
    { id: "korean_prose_review", bindings: [artifacts.authoring, artifacts.contentReceipt], locators: ["page:P-01"] },
    ...Object.entries(roleSlices[documentMode]).map(([id, roles]) => ({
      id, bindings: [artifacts.architecture], locators: roles.map((role) => `page:${pageByRole.get(role)!}/role:${role}`),
    })),
  ];
  const slices: AuditSliceReceipt[] = definition.map(({ id: sliceId, bindings, locators }) => ({
    schemaVersion: "1.0.0",
    sliceId,
    projectId,
    documentMode,
    modePolicyVersion: "1.0.0",
    status: "PASS",
    inputHashes: bindings.map(({ path, sha256 }) => ({ path, sha256 })),
    findings: [],
    reviewerScope: { reviewerType: sliceId === "korean_prose_review" ? "korean_prose_reviewer" : "machine", reviewedLocators: locators, excludedLocators: [] },
    artifactBindings: bindings,
  }));
  const bindings = [...new Map(slices.flatMap(({ artifactBindings }) => artifactBindings).map((entry) => [`${entry.artifactClass}:${entry.path}`, entry])).values()];
  return {
    root, paths, artifacts,
    receipt: {
      schemaVersion: "1.0.0",
      projectId,
      documentMode,
      modePolicyVersion: "1.0.0",
      status: "PASS",
      inputHashes: bindings.map(({ path, sha256 }) => ({ path, sha256 })),
      slices,
      artifactBindings: bindings,
      humanBoundary: "TECHNICAL_GATE_ONLY",
    },
  };
}

describe("mode-aware audit release validation", () => {
  test("rejects a private-partnership receipt whose required slices reuse generic artifacts and one locator", async () => {
    const { root, receipt } = await fixture();
    const generic = receipt.artifactBindings.filter(({ artifactClass }) => ["page_architecture", "reference_manifest", "render_observation"].includes(artifactClass));
    receipt.slices = receipt.slices.map((slice) => ({
      ...slice,
      inputHashes: generic.map(({ path, sha256 }) => ({ path, sha256 })),
      reviewerScope: { ...slice.reviewerScope, reviewedLocators: ["page:P-01"] },
      artifactBindings: generic,
    }));
    receipt.inputHashes = generic.map(({ path, sha256 }) => ({ path, sha256 }));
    receipt.artifactBindings = generic;
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_SLICE_COVERAGE");
  });

  test("rejects a missing mode-required slice", async () => {
    const { root, receipt } = await fixture();
    receipt.slices = receipt.slices.filter(({ sliceId }) => sliceId !== "operating_model_traceability");
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_SLICE_MISSING");
  });

  test("rejects a mode mismatch", async () => {
    const { root, receipt } = await fixture();
    const result = await validateCompositeAuditReceiptForRelease(root, receipt, {
      projectId: receipt.projectId,
      documentMode: "public_procurement",
      modePolicyVersion: "1.0.0",
    });
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_MODE_MISMATCH");
  });

  test("rejects a stale input hash", async () => {
    const { root, paths, receipt } = await fixture();
    await writeFile(paths.references, "references-v2\n");
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_INPUT_STALE");
  });

  test("rejects an artifact class outside the selected mode allowlist", async () => {
    const { root, receipt } = await fixture();
    const forbidden = {
      artifactClass: "rfp_requirement_matrix",
      path: receipt.artifactBindings[0]!.path,
      sha256: receipt.artifactBindings[0]!.sha256,
      bytes: receipt.artifactBindings[0]!.bytes,
    };
    receipt.slices[0]!.artifactBindings.push(forbidden);
    receipt.artifactBindings.push(forbidden);
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_ARTIFACT_CLASS_NOT_ALLOWED");
  });

  test("rejects a hash-current role locator whose page does not exist in the bound architecture", async () => {
    const { root, receipt } = await fixture();
    const slice = receipt.slices.find(({ sliceId }) => sliceId === "operating_model_traceability")!;
    slice.reviewerScope.reviewedLocators = slice.reviewerScope.reviewedLocators.map((locator) => locator.endsWith("/role:party_roles")
      ? "page:P-forged/role:party_roles"
      : locator);
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_SUBJECT_UNBOUND");
  });

  test("rejects malformed hash-current manifest bytes despite self-claimed locators", async () => {
    const { root, paths, receipt } = await fixture();
    await writeFile(paths.architecture, "architecture-v1\n");
    const sha256 = await sha256File(paths.architecture);
    const bytes = (await stat(paths.architecture)).size;
    for (const slice of receipt.slices) {
      slice.inputHashes = slice.inputHashes.map((input) => input.path === paths.architecture ? { path: input.path, sha256 } : input);
      slice.artifactBindings = slice.artifactBindings.map((binding) => binding.path === paths.architecture ? { ...binding, sha256, bytes } : binding);
    }
    receipt.inputHashes = receipt.inputHashes.map((input) => input.path === paths.architecture ? { path: input.path, sha256 } : input);
    receipt.artifactBindings = receipt.artifactBindings.map((binding) => binding.path === paths.architecture ? { ...binding, sha256, bytes } : binding);
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_SUBJECT_UNBOUND");
  });

  test("rejects a complete architecture that omits a mode-required page role", async () => {
    const { root, paths, receipt } = await fixture();
    const architecture = JSON.parse(await readFile(paths.architecture, "utf8")) as { pages: Array<{ pageRole: string }> };
    architecture.pages = architecture.pages.filter(({ pageRole }) => pageRole !== "collaboration_options");
    await writeFile(paths.architecture, `${JSON.stringify(architecture)}\n`);
    const sha256 = await sha256File(paths.architecture);
    const bytes = (await stat(paths.architecture)).size;
    for (const slice of receipt.slices) {
      slice.inputHashes = slice.inputHashes.map((input) => input.path === paths.architecture ? { path: input.path, sha256 } : input);
      slice.artifactBindings = slice.artifactBindings.map((binding) => binding.path === paths.architecture ? { ...binding, sha256, bytes } : binding);
    }
    receipt.inputHashes = receipt.inputHashes.map((input) => input.path === paths.architecture ? { path: input.path, sha256 } : input);
    receipt.artifactBindings = receipt.artifactBindings.map((binding) => binding.path === paths.architecture ? { ...binding, sha256, bytes } : binding);
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_SUBJECT_UNBOUND");
  });

  test("rejects a reference manifest when its declared source hash is no longer current", async () => {
    const { root, paths, receipt } = await fixture();
    await writeFile(paths.source, "mutated source bytes\n");
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_SUBJECT_UNBOUND");
  });

  test.each<DocumentMode>([
    "public_procurement",
    "research_service",
    "private_partnership",
    "internal_decision",
    "document_restyle",
  ])("accepts a hash-current %s technical chain with an evidence ledger", async (mode) => {
    const { root, receipt } = await fixture(mode);
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result).toMatchObject({ status: "PASS", findings: [] });
  });

  test("rejects an authoring response whose claimed content-approval receipt is not a receipt", async () => {
    const { root, paths, receipt } = await fixture();
    await writeFile(paths.contentReceipt, "forged-current-bytes\n");
    const sha256 = await sha256File(paths.contentReceipt);
    const bytes = (await stat(paths.contentReceipt)).size;
    for (const slice of receipt.slices) {
      slice.inputHashes = slice.inputHashes.map((input) => input.path === paths.contentReceipt ? { path: input.path, sha256 } : input);
      slice.artifactBindings = slice.artifactBindings.map((binding) => binding.path === paths.contentReceipt ? { ...binding, sha256, bytes } : binding);
    }
    receipt.inputHashes = receipt.inputHashes.map((input) => input.path === paths.contentReceipt ? { path: input.path, sha256 } : input);
    receipt.artifactBindings = receipt.artifactBindings.map((binding) => binding.path === paths.contentReceipt ? { ...binding, sha256, bytes } : binding);
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUTHORING_RECEIPT_INVALID");
  });

  test("rejects an unapproved authoring response mixed into a figure slice with an approved response", async () => {
    const { root, paths, receipt } = await fixture();
    const unapprovedPath = join(root, "content", "unapproved-authoring-response.json");
    await writeFile(unapprovedPath, "unapproved-current-bytes\n");
    const unapproved = {
      artifactClass: "authoring_response",
      path: unapprovedPath,
      sha256: await sha256File(unapprovedPath),
      bytes: (await stat(unapprovedPath)).size,
    };
    const figureSlice = receipt.slices.find(({ sliceId }) => sliceId === "figure_value")!;
    figureSlice.artifactBindings.push(unapproved);
    figureSlice.inputHashes.push({ path: unapproved.path, sha256: unapproved.sha256 });
    receipt.artifactBindings.push(unapproved);
    receipt.inputHashes.push({ path: unapproved.path, sha256: unapproved.sha256 });
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUTHORING_RECEIPT_INVALID");
  });

  test("rejects compatibility-only direct prose data without a content receipt binding", async () => {
    const { root, receipt } = await fixture();
    const architecture = receipt.artifactBindings.find(({ artifactClass }) => artifactClass === "page_architecture")!;
    receipt.slices = receipt.slices.map((slice) => ["figure_value", "korean_prose_review"].includes(slice.sliceId)
      ? { ...slice, inputHashes: [{ path: architecture.path, sha256: architecture.sha256 }], artifactBindings: [architecture] }
      : slice);
    receipt.artifactBindings = [...new Map(receipt.slices.flatMap(({ artifactBindings }) => artifactBindings)
      .map((binding) => [`${binding.artifactClass}:${binding.path}`, binding])).values()];
    receipt.inputHashes = [...new Map(receipt.slices.flatMap(({ inputHashes }) => inputHashes)
      .map((input) => [`${input.path}:${input.sha256}`, input])).values()];
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_AUDIT_SLICE_COVERAGE");
  });
});
