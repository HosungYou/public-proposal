import { describe, expect, it } from "vitest";
import { realpath } from "node:fs/promises";
import {
  VISUAL_EVIDENCE_RENDERER_VERSION,
  compileFigure,
  compileFigurePng,
  type GovernedFigureReference,
  type SemanticFigureSpecV1,
  type VisualEvidenceData,
} from "../src/index.js";
import {
  SemanticFigureSpecSchema,
  SemanticFigureSpecV1Schema,
} from "../../schemas/src/figure-spec.js";
import { resolveTool } from "../../../tests/support/tool-paths.js";

const SOURCE_SHA = "1".repeat(64);
const REFERENCE_SHA = "2".repeat(64);

const validSpec: SemanticFigureSpecV1 = {
  schemaVersion: "semantic-figure-spec/v1",
  figureId: "FIG-TREND-001",
  requirementIds: ["REQ-001"],
  analyticalQuestion: "최근 8개 분기의 처리량은 어떻게 변했는가?",
  readerTask: "분기별 변화와 전환점을 확인한다.",
  supportedTakeaway: "최근 8개 분기의 처리량이 점진적으로 증가했다.",
  dataIds: ["DATA-TREND-001"],
  relationship: "trend",
  minimumDataConditions: { minimumTemporalObservations: 8 },
  uncertainty: ["분기 집계치는 월별 변동을 표시하지 않는다."],
  sourceCaption: { text: "출처: 공공데이터 포털 공개 통계", sourceIds: ["SRC-001"] },
  targetSurface: "A4_DOCX",
  referenceFamily: "line",
  rendererVersion: VISUAL_EVIDENCE_RENDERER_VERSION,
  approvalStatus: "reviewed",
};

const validData: VisualEvidenceData = {
  datasets: [{
    dataId: "DATA-TREND-001",
    sourceIds: ["SRC-001"],
    unit: "건",
    denominator: "분기",
    observations: Array.from({ length: 8 }, (_, index) => ({
      observationId: `OBS-${index + 1}`,
      period: `202${4 + Math.floor(index / 4)}-Q${(index % 4) + 1}`,
      label: `${index + 1}분기`,
      value: 100 + index * 5,
      sourceId: "SRC-001",
      sourceSha256: SOURCE_SHA,
      rawLocator: `table:1,row:${index + 1}`,
      claimIds: ["CLAIM-001"],
    })),
  }],
};

const validReferences: readonly GovernedFigureReference[] = [{
  referenceId: "REF-LINE-001",
  referenceFamily: "line",
  storageClass: "extracted_visual_pattern",
  rightsStatus: "approved",
  sourceSha256: REFERENCE_SHA,
  pageLocator: "pattern:line-v1",
  transferBoundary: "정보 위계와 선형 추세 문법만 전이",
  approved: true,
}];

describe("visual evidence compiler", () => {
  it("accepts the additive vNext schema while retaining legacy Gantt mappings", () => {
    expect(SemanticFigureSpecV1Schema.safeParse(validSpec).success).toBe(true);
    expect(SemanticFigureSpecSchema.safeParse({
      figureId: "FIG-GANTT-LEGACY",
      requirementId: "REQ-001",
      pageId: "PAGE-001",
      title: "수행 일정",
      intent: "schedule",
      dataShape: "time_axis",
      decisionTask: "일정의 타당성을 검토한다.",
      claimIds: ["CLAIM-001"],
      evidenceIds: ["EV-001"],
      family: "gantt",
      renderer: "svg-gantt",
    }).success).toBe(true);
  });

  it("rejects vNext relationship/reference-family and renderer-version mismatches", () => {
    expect(SemanticFigureSpecV1Schema.safeParse({ ...validSpec, referenceFamily: "matrix" }).success).toBe(false);
    expect(SemanticFigureSpecV1Schema.safeParse({ ...validSpec, rendererVersion: "0.0.0" }).success).toBe(false);
  });

  it("renders the same spec and data to the same SVG hash", async () => {
    const first = await compileFigure(validSpec, validData, validReferences);
    const second = await compileFigure(validSpec, validData, validReferences);

    expect(first.sha256).toBe(second.sha256);
    expect(first.svg).toBe(second.svg);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rasterizes the same canonical SVG to the same locked PNG hash", async () => {
    const svg = await compileFigure(validSpec, validData, validReferences);
    const sofficePath = await resolveTool("soffice");
    const first = await compileFigurePng(svg, { sofficePath });
    const second = await compileFigurePng(svg, { sofficePath });

    expect(first.sha256).toBe(second.sha256);
    expect(Buffer.compare(first.png, second.png)).toBe(0);
    expect(first.sourceSvgSha256).toBe(svg.sha256);
    expect(first.rasterizer.path).toBe(await realpath(sofficePath));
  }, 60_000);

  it.each([
    ["trend", "line", "time-trend"],
    ["comparison", "comparison_chart", "comparison"],
    ["composition", "composition", "composition"],
    ["matrix", "matrix", "requirement-matrix"],
    ["process", "flow", "process"],
    ["framework", "framework", "research-framework"],
  ] as const)("renders the %s relationship through the %s canonical IR family", async (
    relationship,
    referenceFamily,
    expectedFamily,
  ) => {
    const spec = { ...validSpec, relationship, referenceFamily };
    const references = [{ ...validReferences[0]!, referenceFamily }];
    const artifact = await compileFigure(spec, dataFor(relationship), references);

    expect(artifact.ir.family).toBe(expectedFamily);
    expect(artifact.svg).toContain(`data-kpp-family="${expectedFamily}"`);
    expect(artifact.svg).toContain(spec.analyticalQuestion);
    expect(artifact.svg).toContain(spec.sourceCaption.text);
  });

  it("binds source, data, claim, reference, IR, renderer, and output hashes", async () => {
    const artifact = await compileFigure(validSpec, validData, validReferences);

    expect(artifact.lineage).toMatchObject({
      dataIds: ["DATA-TREND-001"],
      sourceIds: ["SRC-001"],
      claimIds: ["CLAIM-001"],
      referenceIds: ["REF-LINE-001"],
    });
    expect(artifact.hashes).toEqual(expect.objectContaining({
      specSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      dataSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      referencesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      irSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      outputSha256: artifact.sha256,
    }));
    expect(artifact.rendererVersion).toBe(VISUAL_EVIDENCE_RENDERER_VERSION);
    expect(artifact.compilerApproval).toBe("not_authorized");
    expect(artifact.svg).toContain(`data-source-sha256="${SOURCE_SHA}"`);
    expect(artifact.svg).toContain('data-claim-ids="CLAIM-001"');
  });

  it("rejects data, reference-family, renderer-version, and rights mismatches", async () => {
    await expect(compileFigure(
      { ...validSpec, dataIds: ["DATA-MISSING"] },
      validData,
      validReferences,
    )).rejects.toThrow(/data.*id|dataset/i);
    await expect(compileFigure(
      { ...validSpec, referenceFamily: "bar" },
      validData,
      validReferences,
    )).rejects.toThrow(/reference.*family|family.*reference/i);
    await expect(compileFigure(
      { ...validSpec, rendererVersion: "0.0.0" },
      validData,
      validReferences,
    )).rejects.toThrow(/renderer.*version|version.*renderer/i);
    await expect(compileFigure(
      validSpec,
      validData,
      [{ ...validReferences[0]!, approved: false }],
    )).rejects.toThrow(/approved.*reference|reference.*approved/i);
    await expect(compileFigure(
      validSpec,
      validData,
      [{ ...validReferences[0]!, rightsStatus: "unknown" } as unknown as GovernedFigureReference],
    )).rejects.toThrow(/rights|reference/i);
  });

  it("never promotes reviewed input to human approval", async () => {
    const artifact = await compileFigure(validSpec, validData, validReferences);

    expect(artifact.approvalStatus).toBe("reviewed");
    expect(artifact).not.toHaveProperty("humanApprovedBy");
  });
});

function dataFor(relationship: SemanticFigureSpecV1["relationship"]): VisualEvidenceData {
  if (relationship === "trend") return validData;
  const common = {
    sourceId: "SRC-001",
    sourceSha256: SOURCE_SHA,
    rawLocator: "table:1,row:1",
    claimIds: ["CLAIM-001"],
  } as const;
  const observations = relationship === "comparison"
    ? [
        { observationId: "OBS-A", label: "기관 A", category: "기관 A", value: 70, ...common },
        { observationId: "OBS-B", label: "기관 B", category: "기관 B", value: 55, ...common },
      ]
    : relationship === "composition"
      ? [
          { observationId: "OBS-A", label: "인건비", category: "인건비", value: 60, ...common },
          { observationId: "OBS-B", label: "운영비", category: "운영비", value: 40, ...common },
        ]
      : relationship === "matrix"
        ? [
            { observationId: "OBS-A", label: "충족", row: "REQ-001", column: "방법론", value: 1, ...common },
            { observationId: "OBS-B", label: "보완", row: "REQ-002", column: "산출물", value: 0, ...common },
          ]
        : [
            { observationId: "NODE-A", label: "현황 진단", nodeId: "A", layer: "입력", ...common },
            { observationId: "NODE-B", label: "실행 설계", nodeId: "B", layer: "산출", ...common },
            { observationId: "EDGE-A-B", label: "분석", from: "A", to: "B", ...common },
          ];
  return {
    datasets: [{
      dataId: "DATA-TREND-001",
      sourceIds: ["SRC-001"],
      unit: relationship === "composition" ? "%" : "점",
      denominator: relationship === "composition" ? "전체 예산" : "동일 지표",
      observations,
    }],
  };
}
