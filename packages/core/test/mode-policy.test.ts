import { describe, expect, it } from "vitest";
import { DOCUMENT_MODES } from "@longtable/kpp-schemas";
import { getDocumentModePolicy } from "../src/mode-policy.js";

describe("document mode policies", () => {
  it("gives every supported mode a distinct reader contract", () => {
    const policies = DOCUMENT_MODES.map(getDocumentModePolicy);

    expect(new Set(policies.map((policy) => policy.requiredPageRoles.join("|"))).size).toBe(5);
    expect(new Set(policies.map((policy) => policy.allowedSurfaceFamilies.join("|"))).size).toBe(5);
    expect(new Set(policies.map((policy) => policy.requiredAuditSlices.join("|"))).size).toBe(5);
    expect(new Set(policies.map((policy) => policy.artifactAllowlist.join("|"))).size).toBe(5);
    for (const policy of policies) {
      expect(policy.modePolicyVersion).toBe("1.0.0");
      expect(policy.requiredPageRoles.length).toBeGreaterThan(0);
      expect(policy.allowedSurfaceFamilies.length).toBeGreaterThan(0);
      expect(policy.requiredAuditSlices.length).toBeGreaterThan(0);
      expect(policy.artifactAllowlist.length).toBeGreaterThan(0);
    }
  });

  it("does not impose a procurement evaluation crosswalk on private partnerships", () => {
    const policy = getDocumentModePolicy("private_partnership");

    expect(policy.requiredPageRoles).not.toContain("procurement_evaluation_crosswalk");
    expect(policy.requiredAuditSlices).not.toContain("procurement_evaluation_crosswalk");
    expect(policy.artifactAllowlist).not.toContain("procurement_evaluation_crosswalk");
  });

  it("rejects an unknown mode when an untyped caller bypasses TypeScript", () => {
    let thrown: unknown;
    try {
      getDocumentModePolicy("unknown_mode" as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "KPP_MODE_POLICY_UNKNOWN",
    });
  });
});
