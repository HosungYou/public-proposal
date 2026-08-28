import { describe, expect, test } from "vitest";
import {
  AuditSliceReceiptSchema,
  CompositeAuditReceiptSchema,
  type AuditSliceReceipt,
  type CompositeAuditReceipt,
} from "@longtable/kpp-schemas";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function slice(sliceId: string): AuditSliceReceipt {
  return {
    schemaVersion: "1.0.0",
    sliceId,
    projectId: "private-partnership-fixture",
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    status: "PASS",
    inputHashes: [{ path: "/project/content/page-architecture.json", sha256: SHA_A }],
    findings: [],
    reviewerScope: {
      reviewerType: "machine",
      reviewedLocators: ["page:P-01"],
      excludedLocators: [],
    },
    artifactBindings: [{
      artifactClass: "page_architecture",
      path: "/project/content/page-architecture.json",
      sha256: SHA_A,
      bytes: 128,
    }],
  };
}

function composite(): CompositeAuditReceipt {
  const slices = [
    "page_architecture",
    "reference_integrity",
    "render_repetition",
    "figure_value",
    "korean_prose_review",
  ].map(slice);
  return {
    schemaVersion: "1.0.0",
    projectId: "private-partnership-fixture",
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    status: "PASS",
    inputHashes: [
      { path: "/project/content/page-architecture.json", sha256: SHA_A },
      { path: "/project/evidence/reference-manifest.json", sha256: SHA_B },
    ],
    slices,
    artifactBindings: slices.flatMap((entry) => entry.artifactBindings),
    humanBoundary: "TECHNICAL_GATE_ONLY",
  };
}

describe("structured audit receipts", () => {
  test("rejects a free-form PASS assertion", () => {
    expect(AuditSliceReceiptSchema.safeParse("PASS").success).toBe(false);
    expect(CompositeAuditReceiptSchema.safeParse({ status: "PASS" }).success).toBe(false);
  });

  test("rejects a PASS slice with a blocking rule finding", () => {
    const value = slice("page_architecture");
    value.findings = [{
      ruleId: "KPP_PAGE_TITLE_CONTINUATION_LARGE",
      severity: "BLOCKER",
      message: "continuation title exceeds the mode maximum",
      locator: "page:P-02/title:1",
    }];
    expect(AuditSliceReceiptSchema.safeParse(value).success).toBe(false);
  });

  test("rejects a composite whose slice identity differs from the project identity", () => {
    const value = composite();
    value.slices[0] = { ...value.slices[0]!, documentMode: "public_procurement" };
    expect(CompositeAuditReceiptSchema.safeParse(value).success).toBe(false);
  });
});
