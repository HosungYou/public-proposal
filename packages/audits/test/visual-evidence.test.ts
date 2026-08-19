import { describe, expect, it } from "vitest";
import {
  VISUAL_EVIDENCE_RENDERER_VERSION,
  compileFigure,
  type GovernedFigureReference,
  type SemanticFigureSpecV1,
  type VisualEvidenceData,
} from "@longtable/kpp-renderers";
import { auditFigureSemantics, type FigureSemanticAuditInput } from "../src/index.js";

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
  sourceCaption: { text: "출처: 공개 통계", sourceIds: ["SRC-001"] },
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
  transferBoundary: "정보 위계와 추세 문법만 전이",
  approved: true,
}];

describe("independent visual evidence audit", () => {
  it("passes a traceable figure without granting human approval", async () => {
    const input = await validAuditInput();
    const report = auditFigureSemantics(input);

    expect(report.status, JSON.stringify(report.findings)).toBe("PASS");
    expect(report.auditorBoundary).toBe("INDEPENDENT_QA_ONLY");
    expect(report.humanApprovalStatus).toBe("reviewed");
  });

  it("blocks a line chart with fewer than eight temporal observations", async () => {
    const input = await validAuditInput();
    const shortSeries = {
      datasets: [{ ...validData.datasets[0]!, observations: validData.datasets[0]!.observations.slice(0, 7) }],
    };
    const report = auditFigureSemantics({ ...input, data: shortSeries });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_SAMPLE_INSUFFICIENT" }));
  });

  it("blocks a plotted point without raw-source lineage", async () => {
    const input = await validAuditInput();
    const report = auditFigureSemantics({ ...input, lineage: [] });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_LINEAGE_MISSING" }));
  });

  it.each([
    ["source/data mismatch", { sourceIds: ["SRC-OTHER"] }, "PP_FIGURE_SOURCE_DATA_MISMATCH"],
    ["unit mismatch", { units: ["건", "%"] }, "PP_FIGURE_UNIT_MISMATCH"],
    ["denominator mismatch", { denominators: ["분기", "연간"] }, "PP_FIGURE_DENOMINATOR_MISMATCH"],
    ["dishonest scale", { scale: { min: 120, max: 125, includeZero: false } }, "PP_FIGURE_SCALE_DISHONEST"],
    ["label collision", { labelCollisions: 1 }, "PP_FIGURE_LABEL_COLLISION"],
    ["clipping", { clippedElements: 1 }, "PP_FIGURE_CLIPPING"],
    ["low contrast", { minimumContrastRatio: 3.1 }, "PP_FIGURE_CONTRAST"],
    ["grayscale failure", { grayscaleDistinct: false }, "PP_FIGURE_GRAYSCALE"],
    ["A4 overflow", { widthMm: 190 }, "PP_FIGURE_A4_FOOTPRINT"],
    ["missing caption", { captionPresent: false }, "PP_FIGURE_CAPTION_MISSING"],
    ["missing section callout", { sectionCalloutPresent: false }, "PP_FIGURE_SECTION_CALLOUT_MISSING"],
    ["repeated geometry", { repeatedGeometryCount: 3 }, "PP_FIGURE_GEOMETRY_REPEATED"],
  ] as const)("blocks %s", async (_name, layoutOverride, code) => {
    const input = await validAuditInput();
    const report = auditFigureSemantics({
      ...input,
      renderContext: { ...input.renderContext, ...layoutOverride },
    });

    expect(report.findings).toContainEqual(expect.objectContaining({ code }));
  });

  it("requires two independent A4-context approvals before human_approved", async () => {
    const input = await validAuditInput();
    const report = auditFigureSemantics({
      ...input,
      spec: { ...input.spec, approvalStatus: "human_approved" },
      humanReviews: [{
        reviewerId: "reviewer-1",
        renderedInA4Context: true,
        meaning: true,
        trustworthiness: true,
        documentFit: true,
        sendReady: true,
      }],
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_HUMAN_APPROVAL_INCOMPLETE" }));
  });

  it("accepts human_approved only with two complete independent reviews", async () => {
    const input = await validAuditInput();
    const review = {
      renderedInA4Context: true,
      meaning: true,
      trustworthiness: true,
      documentFit: true,
      sendReady: true,
    } as const;
    const report = auditFigureSemantics({
      ...input,
      spec: { ...input.spec, approvalStatus: "human_approved" },
      humanReviews: [
        { reviewerId: "reviewer-1", ...review },
        { reviewerId: "reviewer-2", ...review },
      ],
    });

    expect(report.status, JSON.stringify(report.findings)).toBe("PASS");
    expect(report.humanApprovalStatus).toBe("human_approved");
  });
});

async function validAuditInput(): Promise<FigureSemanticAuditInput> {
  const artifact = await compileFigure(validSpec, validData, validReferences);
  return {
    spec: validSpec,
    data: validData,
    references: validReferences,
    artifact,
    lineage: artifact.pointLineage,
    renderContext: {
      sourceIds: ["SRC-001"],
      units: ["건"],
      denominators: ["분기"],
      scale: { min: 0, max: 140, includeZero: true },
      labelCollisions: 0,
      clippedElements: 0,
      minimumContrastRatio: 7,
      grayscaleDistinct: true,
      widthMm: 170,
      heightMm: 100,
      captionPresent: true,
      sectionCalloutPresent: true,
      repeatedGeometryCount: 1,
    },
    humanReviews: [],
  };
}
