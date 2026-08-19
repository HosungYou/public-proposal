import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { EvidenceDataBundleV1, ProposalResearchRequestV1 } from "@longtable/proposal-research-contracts";
import {
  createResearchRequest,
  importEvidenceBundle,
  routeResearch,
} from "../src/research-bridge.js";

let core: typeof import("@longtable/kpp-core");

describe("proposal research bridge", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    core = await import("@longtable/kpp-core");
  });

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ));
  });

  it("routes an academic request to LongTable and records the exact bundle and receipt hashes", async () => {
    const root = await createLockedRequirementsProject(temporaryDirectories, "research_service");
    const request = await createResearchRequest(root, validRequestOptions());

    expect(request.sourcePriority[0]).toBe("user_provided");
    expect(request.requirementIds).toEqual(["REQ-INSTITUTION-METRIC"]);
    expect(request.budgets).toEqual({ fullPass: 1, deltaPasses: 2 });
    expect((await routeResearch({ proposalClass: request.proposalClass, academicEvidence: true })).invocations)
      .toEqual(["longtable"]);

    const bundlePath = await writeBundleFixture(temporaryDirectories, request);
    const imported = await importEvidenceBundle(root, bundlePath);

    expect(imported).toMatchObject({ state: "SUCCEEDED" });
    expect(imported.bundleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(imported.researchReceiptHash).toMatch(/^[a-f0-9]{64}$/u);
    const receipt = await core.verifyReceipt(imported.receiptPath);
    expect(receipt.valid).toBe(true);
    expect(receipt.receipt.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: imported.bundlePath, sha256: imported.bundleHash }),
    ]));
    expect(receipt.receipt.inputReceiptHashes).toContain(imported.bundleHash);
  });

  it("runs no LongTable call for ordinary general procurement", async () => {
    const result = await routeResearch({
      proposalClass: "general_procurement",
      academicEvidence: false,
    });

    expect(result.invocations).toEqual([]);
  });

  it("requires a valid official source or an explicit resolved official-source gap", async () => {
    const root = await createLockedRequirementsProject(temporaryDirectories, "research_service");
    const request = await createResearchRequest(root, validRequestOptions());
    const unsupportedInstitutionFixture = await writeBundleFixture(temporaryDirectories, request, {
      sources: [
        {
          sourceId: "source-web",
          sourceClass: "web_discovery",
          title: "검색 결과",
          locator: "https://example.test/discovery",
          verified: false,
          institutionId: "INST-A",
        },
        validBundleParts().sources[1]!,
      ],
      datasets: [{
        datasetId: "dataset-1",
        name: "기관 연도별 건수",
        sourceIds: ["source-web"],
        fieldIds: ["FIELD-ANNUAL-COUNT"],
        period: "2021-2025",
        unit: "건",
        grain: "year",
        records: [{ year: 2025, value: 10 }],
      }],
      claims: [{
        claimId: "CLAIM-INSTITUTION-METRIC",
        text: "기관의 연도별 건수는 확인된다.",
        requirementIds: ["REQ-INSTITUTION-METRIC"],
        sourceIds: ["source-web"],
        dataIds: ["dataset-1"],
        status: "candidate",
        caveats: [],
      }],
      transformations: [{
        ...validBundleParts().transformations[0]!,
        inputSourceIds: ["source-web"],
      }],
      figures: [{
        ...validBundleParts().figures[0]!,
        sourceCaption: { text: "발견용 검색 결과", sourceIds: ["source-web"] },
      }],
    });

    await expect(importEvidenceBundle(root, unsupportedInstitutionFixture))
      .rejects.toMatchObject({ code: "PP_REQUIRED_DATA_GAP" });
  });

  it("rejects time, unit, grain, entity, and file-hash mismatches before receipt creation", async () => {
    const cases: Array<{
      readonly code: string;
      readonly overrides: Partial<EvidenceDataBundleV1>;
    }> = [
      {
        code: "PP_DATA_GRAIN_MISMATCH",
        overrides: { datasets: [{ ...validBundleParts().datasets[0]!, grain: "month" }] },
      },
      {
        code: "PP_DATA_UNIT_MISMATCH",
        overrides: { datasets: [{ ...validBundleParts().datasets[0]!, unit: "명" }] },
      },
      {
        code: "PP_INSTITUTION_IDENTITY_AMBIGUOUS",
        overrides: { sources: [{ ...validBundleParts().sources[0]!, institutionId: "INST-B" }] },
      },
    ];

    for (const testCase of cases) {
      const root = await createLockedRequirementsProject(temporaryDirectories, "research_service");
      const request = await createResearchRequest(root, validRequestOptions());
      const bundlePath = await writeBundleFixture(temporaryDirectories, request, testCase.overrides);
      await expect(importEvidenceBundle(root, bundlePath)).rejects.toMatchObject({ code: testCase.code });
      await expect(readFile(join(root, "receipts", "research-lock.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    }

    const root = await createLockedRequirementsProject(temporaryDirectories, "research_service");
    const request = await createResearchRequest(root, validRequestOptions());
    const bundlePath = await writeBundleFixture(temporaryDirectories, request);
    const bundleDirectory = join(bundlePath, "..");
    await writeFile(join(bundleDirectory, "raw", "institution.json"), "tampered\n", "utf8");
    await expect(importEvidenceBundle(root, bundlePath))
      .rejects.toMatchObject({ code: "PP_RESEARCH_BUNDLE_INVALID" });
  });
});

function validRequestOptions() {
  return {
    institution: {
      canonicalName: "기관 A",
      aliases: ["A 기관"],
      identifiers: { alio: "INST-A" },
    },
    questions: [{
      questionId: "QUESTION-INSTITUTION-METRIC",
      text: "기관의 연도별 건수는 어떻게 변했는가?",
      requiredDataFieldIds: ["FIELD-ANNUAL-COUNT"],
    }],
    requiredData: [{
      fieldId: "FIELD-ANNUAL-COUNT",
      definition: "기관 연도별 건수",
      period: "2021-2025",
      unit: "건",
      grain: "year",
      required: true,
      allowedSourceClasses: ["institution_official", "official", "alio"] as const,
      targetClaimIds: ["CLAIM-INSTITUTION-METRIC"],
      targetFigureIds: ["FIG-INSTITUTION-TREND"],
    }],
    privacyClass: "PUBLIC" as const,
  };
}

async function createLockedRequirementsProject(
  temporaryDirectories: string[],
  proposalClass: "research_service" | "general_procurement",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-research-bridge-"));
  temporaryDirectories.push(root);
  await core.initializeProject(root, { projectId: "project-1", proposalClass });
  const sourcePath = join(root, "sources", "issuer-rfp.txt");
  await writeFile(sourcePath, "기관 연도별 지표를 제시한다.\n", "utf8");
  const sourceReceiptPath = join(root, "receipts", "source-lock.json");
  await core.writeReceipt({
    stage: "SOURCE_LOCKED",
    files: [sourcePath],
    inputReceiptHashes: [],
    output: sourceReceiptPath,
  });
  await core.advanceProject(root, "SOURCE_LOCKED");

  const requirementsPath = join(root, "requirements", "requirements.json");
  await writeFile(requirementsPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    confirmationStatus: "confirmed",
    confirmedBy: "proposal-owner",
    requirements: [{
      requirementId: "REQ-INSTITUTION-METRIC",
      title: "기관 연도별 지표",
      critical: true,
      pageRole: "academic_evidence",
      surfaceTemplateId: "research-evidence-v1",
      claims: [{ claimId: "CLAIM-INSTITUTION-METRIC", critical: true, evidenceIds: ["EVID-INSTITUTION"] }],
      figureSpecs: [{
        figureId: "FIG-INSTITUTION-TREND",
        title: "기관 연도별 건수 추이",
        intent: "comparison",
        dataShape: "comparison_series",
        decisionTask: "기관의 연도별 건수 추이를 확인한다.",
        claimIds: ["CLAIM-INSTITUTION-METRIC"],
        evidenceIds: ["EVID-INSTITUTION"],
        family: "comparison_chart",
        renderer: "svg-comparison-chart",
      }],
    }],
    evidenceBindings: [{
      evidenceId: "EVID-INSTITUTION",
      sourcePath,
      sourceSha256: await core.sha256File(sourcePath),
      scope: "기관 연도별 지표 요구",
      claimIds: ["CLAIM-INSTITUTION-METRIC"],
      targetRequirementId: "REQ-INSTITUTION-METRIC",
      targetPageId: "PAGE-001",
      targetPageRole: "academic_evidence",
    }],
  }, null, 2)}\n`, "utf8");
  const requirementsReceiptPath = join(root, "receipts", "requirements-lock.json");
  await core.writeReceipt({
    stage: "REQUIREMENTS_LOCKED",
    files: [requirementsPath],
    inputReceiptHashes: [await core.sha256File(sourceReceiptPath)],
    output: requirementsReceiptPath,
  });
  await core.advanceProject(root, "REQUIREMENTS_LOCKED");
  return root;
}

async function writeBundleFixture(
  temporaryDirectories: string[],
  request: ProposalResearchRequestV1,
  overrides: Partial<EvidenceDataBundleV1> = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "proposal-research-bundle-"));
  temporaryDirectories.push(directory);
  const artifactContents: Record<string, string> = {
    "raw/institution.json": "{\"year\":2025,\"value\":10}\n",
    "normalized/dataset.json": "{\"records\":[{\"year\":2025,\"value\":10}]}\n",
    "transformations/lineage.json": "{\"operation\":\"formatting\"}\n",
    "claims/candidates.json": "{\"claimIds\":[\"CLAIM-INSTITUTION-METRIC\"]}\n",
    "figures/specs.json": "{\"figureIds\":[\"FIG-INSTITUTION-TREND\"]}\n",
    "gaps/gaps.json": "{\"gaps\":[]}\n",
    "handoff.json": "{\"status\":\"SUCCEEDED\"}\n",
    "source-manifest.jsonl": "{\"sourceId\":\"source-official\"}\n",
  };
  for (const [relativePath, contents] of Object.entries(artifactContents)) {
    const path = join(directory, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  const files = await Promise.all(Object.keys(artifactContents).map(async (path) => ({
    path,
    sha256: await core.sha256File(join(directory, path)),
  })));
  const parts = validBundleParts();
  const bundle: EvidenceDataBundleV1 = {
    schemaVersion: "proposal-evidence-bundle/v1",
    bundleId: `bundle-${request.requestId}`,
    requestId: request.requestId,
    contractVersion: "1.0.0",
    files,
    sources: parts.sources,
    datasets: parts.datasets,
    transformations: parts.transformations,
    claims: parts.claims,
    figures: parts.figures,
    gaps: [],
    status: "complete",
    ...overrides,
  };
  const bundlePath = join(directory, "bundle.json");
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  return bundlePath;
}

function validBundleParts(): Pick<
  EvidenceDataBundleV1,
  "sources" | "datasets" | "transformations" | "claims" | "figures"
> {
  return {
    sources: [
      {
        sourceId: "source-official",
        sourceClass: "institution_official",
        title: "기관 A 공식 통계",
        locator: "https://example.test/official",
        verified: true,
        rightsStatus: "public",
        institutionId: "INST-A",
      },
      {
        sourceId: "source-scholarly",
        sourceClass: "scholarly_fulltext",
        title: "검증된 학술 근거",
        locator: "https://example.test/paper.pdf",
        verified: true,
        rightsStatus: "public",
      },
    ],
    datasets: [{
      datasetId: "dataset-1",
      name: "기관 연도별 건수",
      sourceIds: ["source-official"],
      fieldIds: ["FIELD-ANNUAL-COUNT"],
      period: "2021-2025",
      unit: "건",
      grain: "year",
      records: [{ year: 2025, value: 10 }],
    }],
    transformations: [{
      schemaVersion: "transformation-lineage/v1",
      transformationId: "transform-1",
      inputSourceIds: ["source-official"],
      inputDatasetIds: ["dataset-1"],
      outputDatasetId: "dataset-1",
      rawLocator: "source-official:row-1",
      normalizationSteps: ["formatting"],
      derivedFormula: null,
      outputCellOrRow: "row-1",
      claimIds: ["CLAIM-INSTITUTION-METRIC"],
      figureIds: ["FIG-INSTITUTION-TREND"],
    }],
    claims: [{
      claimId: "CLAIM-INSTITUTION-METRIC",
      text: "기관의 연도별 건수는 확인된다.",
      requirementIds: ["REQ-INSTITUTION-METRIC"],
      sourceIds: ["source-official"],
      dataIds: ["dataset-1"],
      status: "verified",
      caveats: [],
    }],
    figures: [{
      schemaVersion: "semantic-figure-spec/v1",
      figureId: "FIG-INSTITUTION-TREND",
      requirementIds: ["REQ-INSTITUTION-METRIC"],
      analyticalQuestion: "기관의 연도별 건수는 어떻게 변했는가?",
      readerTask: "연도별 추이를 확인한다.",
      supportedTakeaway: "기관의 연도별 건수를 확인할 수 있다.",
      dataIds: ["dataset-1"],
      relationship: "trend",
      minimumDataConditions: { minimumPeriods: 1 },
      uncertainty: [],
      sourceCaption: { text: "출처: 기관 A 공식 통계", sourceIds: ["source-official"] },
      targetSurface: "A4_DOCX",
      referenceFamily: "comparison_chart",
      rendererVersion: "1.0.0",
      approvalStatus: "reviewed",
    }],
  };
}
