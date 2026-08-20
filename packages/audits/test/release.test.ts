import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { sha256File } from "@longtable/kpp-core";
import { validateCompositeAuditReceiptForRelease } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "kpp-mode-release-"));
  roots.push(root);
  const paths = {
    architecture: join(root, "content", "page-architecture.json"),
    references: join(root, "evidence", "reference-manifest.json"),
    observations: join(root, "audit", "docx-geometry.json"),
    audit: join(root, "audit", "audit.json"),
  };
  await Promise.all([mkdir(join(root, "content")), mkdir(join(root, "evidence")), mkdir(join(root, "audit"))]);
  await writeFile(paths.architecture, "architecture-v1\n");
  await writeFile(paths.references, "references-v1\n");
  await writeFile(paths.observations, "observations-v1\n");
  const hashes = {
    architecture: await sha256File(paths.architecture),
    references: await sha256File(paths.references),
    observations: await sha256File(paths.observations),
  };
  const bindings = [
    { artifactClass: "page_architecture", path: paths.architecture, sha256: hashes.architecture, bytes: 16 },
    { artifactClass: "reference_manifest", path: paths.references, sha256: hashes.references, bytes: 14 },
    { artifactClass: "render_observation", path: paths.observations, sha256: hashes.observations, bytes: 16 },
  ];
  const ids = [
    "page_architecture", "reference_integrity", "render_repetition", "figure_value",
    "korean_prose_review", "operating_model_traceability",
  ];
  const slices = ids.map((sliceId) => ({
    schemaVersion: "1.0.0",
    sliceId,
    projectId: "private-partnership-fixture",
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    status: "PASS",
    inputHashes: bindings.map(({ path, sha256 }) => ({ path, sha256 })),
    findings: [],
    reviewerScope: { reviewerType: sliceId === "korean_prose_review" ? "korean_prose_reviewer" : "machine", reviewedLocators: ["page:P-01"], excludedLocators: [] },
    artifactBindings: bindings,
  }));
  return {
    root, paths, hashes,
    receipt: {
      schemaVersion: "1.0.0",
      projectId: "private-partnership-fixture",
      documentMode: "private_partnership",
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
    receipt.artifactBindings.push({
      artifactClass: "rfp_requirement_matrix",
      path: receipt.artifactBindings[0]!.path,
      sha256: receipt.artifactBindings[0]!.sha256,
      bytes: receipt.artifactBindings[0]!.bytes,
    });
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RELEASE_ARTIFACT_CLASS_NOT_ALLOWED");
  });

  test("accepts a hash-current private-partnership technical chain", async () => {
    const { root, receipt } = await fixture();
    const result = await validateCompositeAuditReceiptForRelease(root, receipt);
    expect(result).toMatchObject({ status: "PASS", findings: [] });
  });
});
