import { describe, expect, it } from "vitest";
import {
  EvidenceDataBundleV1Schema,
  EvidenceFileV1Schema,
  ProposalResearchHandoffV1Schema,
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
      requirementsLockSha256: "a".repeat(64),
      routingDecision: "required",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the existing document_restyle proposal class for compatibility", () => {
    const result = ProposalResearchRequestV1Schema.safeParse({
      schemaVersion: "proposal-research-request/v1",
      requestId: "req-restyle",
      projectId: "project-restyle",
      proposalClass: "document_restyle",
      requirementIds: [],
      institution: { canonicalName: "기관 A", aliases: [], identifiers: {} },
      questions: [],
      requiredData: [],
      sourcePriority: ["user_provided"],
      targetArtifacts: ["method"],
      budgets: { fullPass: 1, deltaPasses: 2 },
      privacyClass: "PUBLIC",
      requirementsLockSha256: "b".repeat(64),
      routingDecision: "prohibited",
    });
    expect(result.success).toBe(true);
  });

  it("changes the canonical hash when a lineage field changes", () => {
    expect(sha256Canonical({ a: 1 })).not.toBe(sha256Canonical({ a: 2 }));
  });

  it("requires an explicit evidence-file classification", () => {
    expect(EvidenceFileV1Schema.safeParse({
      path: "raw/source.json",
      sha256: "a".repeat(64),
    }).success).toBe(false);
    expect(EvidenceFileV1Schema.safeParse({
      path: "raw/source.json",
      sha256: "a".repeat(64),
      classification: "PUBLIC",
    }).success).toBe(true);
  });

  it("accepts only the exact proposal research handoff wire shape", () => {
    expect(ProposalResearchHandoffV1Schema.safeParse({ status: "SUCCEEDED" }).success).toBe(false);
    expect(ProposalResearchHandoffV1Schema.safeParse({
      schemaVersion: "proposal-research-handoff/v1",
      status: "SUCCEEDED",
      bundleId: "bundle-1",
      requestId: "request-1",
      accountableSynthesis: { owner: "owner", roles: [], unresolvedGapIds: [] },
      searchBudget: { fullPassesUsed: 1, deltaPassesUsed: 0 },
    }).success).toBe(true);
  });

  it("rejects a bundle with an untraceable figure point", () => {
    const result = EvidenceDataBundleV1Schema.safeParse({
      schemaVersion: "proposal-evidence-bundle/v1",
      bundleId: "bundle-1", requestId: "req-1", contractVersion: "1.0.0",
      files: [], sources: [], datasets: [], transformations: [], claims: [], figures: [{ figureId: "fig-1", dataIds: ["missing"] }], gaps: [], status: "complete",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a claim with a dangling source reference", () => {
    const result = EvidenceDataBundleV1Schema.safeParse(validBundle({
      claims: [{ ...validBundle().claims[0], sourceIds: ["missing-source"] }],
    }));
    expect(result.success).toBe(false);
  });

  it("rejects a claim with a dangling data reference", () => {
    const result = EvidenceDataBundleV1Schema.safeParse(validBundle({
      claims: [{ ...validBundle().claims[0], dataIds: ["missing-dataset"] }],
    }));
    expect(result.success).toBe(false);
  });

  it("rejects a figure caption with a dangling source reference", () => {
    const result = EvidenceDataBundleV1Schema.safeParse(validBundle({
      figures: [{ ...validBundle().figures[0], sourceCaption: { text: "출처", sourceIds: ["missing-source"] } }],
    }));
    expect(result.success).toBe(false);
  });

  it("rejects a transformation with a dangling input dataset reference", () => {
    const result = EvidenceDataBundleV1Schema.safeParse(validBundle({
      transformations: [{ ...validBundle().transformations[0], inputDatasetIds: ["missing-dataset"] }],
    }));
    expect(result.success).toBe(false);
  });
});

function validBundle(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "proposal-evidence-bundle/v1",
    bundleId: "bundle-1",
    requestId: "req-1",
    contractVersion: "1.0.0",
    files: [],
    sources: [{ sourceId: "source-1", sourceClass: "official", title: "기관 자료", locator: "https://example.test/source" }],
    datasets: [{ datasetId: "dataset-1", name: "연도별 건수", sourceIds: ["source-1"], fieldIds: ["field-1"], records: [] }],
    transformations: [{ transformationId: "transform-1", inputDatasetIds: ["dataset-1"], outputDatasetId: "dataset-1", rawLocator: "source-1:table-1", normalizationSteps: ["identity"], derivedFormula: null, outputCellOrRow: "row-1", claimIds: ["claim-1"], figureIds: ["figure-1"] }],
    claims: [{ claimId: "claim-1", text: "기관의 건수는 확인된다.", requirementIds: [], sourceIds: ["source-1"], dataIds: ["dataset-1"], status: "candidate", caveats: [] }],
    figures: [{ schemaVersion: "semantic-figure-spec/v1", figureId: "figure-1", requirementIds: [], analyticalQuestion: "무엇을 비교하는가?", readerTask: "추세를 확인한다.", supportedTakeaway: "연도별 추세를 확인할 수 있다.", dataIds: ["dataset-1"], relationship: "trend", minimumDataConditions: {}, uncertainty: [], sourceCaption: { text: "출처: 기관 자료", sourceIds: ["source-1"] }, targetSurface: "A4_DOCX", referenceFamily: "line", rendererVersion: "1.0.0", approvalStatus: "candidate" }],
    gaps: [],
    status: "complete",
    ...overrides,
  };
}
