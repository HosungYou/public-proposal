import { describe, expect, it } from "vitest";
import {
  EvidenceDataBundleV1Schema,
  ProposalResearchRequestV1Schema,
  sha256Canonical,
} from "../src/index.js";

describe("proposal research contracts", () => {
  it("accepts a request with explicit institution, field, source, and artifact boundaries", () => {
    const result = ProposalResearchRequestV1Schema.safeParse({
      schemaVersion: "proposal-research-request/v1",
      requestId: "req-1",
      projectId: "project-1",
      proposalClass: "research_service",
      requirementIds: ["req-1"],
      institution: { canonicalName: "기관 A", aliases: [], identifiers: { alio: "A" } },
      questions: [{ questionId: "q-1", text: "무엇을 비교하는가?", requiredDataFieldIds: ["field-1"] }],
      requiredData: [{ fieldId: "field-1", definition: "연도별 건수", period: "2021-2025", unit: "건", grain: "year", required: true, allowedSourceClasses: ["official"] }],
      sourcePriority: ["user_provided", "institution_official", "alio", "scholarly_fulltext"],
      targetArtifacts: ["claim", "figure"],
      budgets: { fullPass: 1, deltaPasses: 2 },
      privacyClass: "PUBLIC",
    });
    expect(result.success).toBe(true);
  });

  it("changes the canonical hash when a lineage field changes", () => {
    expect(sha256Canonical({ a: 1 })).not.toBe(sha256Canonical({ a: 2 }));
  });

  it("rejects a bundle with an untraceable figure point", () => {
    const result = EvidenceDataBundleV1Schema.safeParse({
      schemaVersion: "proposal-evidence-bundle/v1",
      bundleId: "bundle-1", requestId: "req-1", contractVersion: "1.0.0",
      files: [], sources: [], datasets: [], transformations: [], claims: [], figures: [{ figureId: "fig-1", dataIds: ["missing"] }], gaps: [], status: "complete",
    });
    expect(result.success).toBe(false);
  });
});
