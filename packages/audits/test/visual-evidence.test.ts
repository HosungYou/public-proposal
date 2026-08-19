import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  R08_TOKEN_PROFILE,
  R08_TOKEN_PROFILE_SHA256,
  VISUAL_EVIDENCE_FONT_PROFILE,
  VISUAL_EVIDENCE_FONT_PROFILE_SHA256,
  VISUAL_EVIDENCE_RENDERER_VERSION,
  canonicalFigureInputsJson,
  compileFigure,
  renderFigureA4Page,
  type FigureA4Context,
  type GovernedFigureReference,
  type HumanFigureReview,
  type SemanticFigureSpecV1,
  type VisualEvidenceData,
  type VisualEvidenceFigureArtifact,
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
  evidenceIds: ["EV-001"],
  relationship: "trend",
  minimumDataConditions: { minimumTemporalObservations: 8 },
  uncertainty: ["분기 집계치는 월별 변동을 표시하지 않는다."],
  sourceCaption: { text: "출처: 공개 통계", sourceIds: ["SRC-001"] },
  targetSurface: "A4_DOCX",
  referenceFamily: "line",
  rendererVersion: VISUAL_EVIDENCE_RENDERER_VERSION,
  rendererFingerprint: {
    renderer: { name: "@longtable/kpp-renderers", version: VISUAL_EVIDENCE_RENDERER_VERSION },
    tokenProfile: { id: R08_TOKEN_PROFILE, sha256: R08_TOKEN_PROFILE_SHA256 },
    fontProfile: { id: VISUAL_EVIDENCE_FONT_PROFILE, sha256: VISUAL_EVIDENCE_FONT_PROFILE_SHA256 },
    rasterizer: {
      name: "LibreOffice",
      executablePath: "/test/soffice",
      executableSha256: "3".repeat(64),
      version: "LibreOffice 26.2.4.2 20(Build:2)",
    },
  },
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
  synthetic: false,
  publiclyReleasable: false,
  sourceLineageClass: "project_private",
  approved: true,
}];

const validPageContext: FigureA4Context = {
  pageLocator: "page:5",
  pageWidthMm: 210,
  pageHeightMm: 297,
  figureBox: { xMm: 20, yMm: 58, widthMm: 170, heightMm: 100 },
  sectionCallout: "그림 FIG-TREND-001은 최근 분기별 처리량 변화를 보여준다.",
  caption: "출처: 공개 통계",
  peerFigureBoxes: [],
};

describe("independent visual evidence audit", () => {
  it("passes a reconstructed traceable figure without granting human approval", async () => {
    const input = await validAuditInput();
    const report = auditFigureSemantics(input);

    expect(report.status, JSON.stringify(report.findings)).toBe("PASS");
    expect(report.auditorBoundary).toBe("INDEPENDENT_QA_ONLY");
    expect(report.humanApprovalStatus).toBe("reviewed");
  });

  it("rejects a self-consistent but wrong SVG, IR, and point lineage", async () => {
    const input = await validAuditInput();
    const ir = {
      ...input.artifact.ir,
      marks: input.artifact.ir.marks.map((mark, index) => index === 0
        ? { ...mark, value: 999, sourceSha256: "9".repeat(64), evidenceIds: ["EV-FORGED"] }
        : mark),
    };
    const svg = input.artifact.svg
      .replace("100건", "999건")
      .replace(SOURCE_SHA, "9".repeat(64))
      .replace("EV-001", "EV-FORGED");
    const artifact: VisualEvidenceFigureArtifact = {
      ...input.artifact,
      svg,
      sha256: sha256(svg),
      ir,
      pointLineage: input.artifact.pointLineage.map((point, index) => index === 0
        ? { ...point, sourceSha256: "9".repeat(64), evidenceIds: ["EV-FORGED"] }
        : point),
      hashes: {
        ...input.artifact.hashes,
        irSha256: sha256(canonicalFigureInputsJson(ir)),
        outputSha256: sha256(svg),
      },
    };
    const pageArtifact = renderFigureA4Page(artifact, input.pageContext);
    const report = auditFigureSemantics({ ...input, artifact, pageArtifact });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_ARTIFACT_MISMATCH" }));
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_LINEAGE_MISMATCH" }));
  });

  it("blocks a line chart with fewer than eight temporal observations", async () => {
    const input = await validAuditInput();
    const shortSeries = {
      datasets: [{ ...validData.datasets[0]!, observations: validData.datasets[0]!.observations.slice(0, 7) }],
    };
    const report = auditFigureSemantics({ ...input, data: shortSeries });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_SAMPLE_INSUFFICIENT" }));
  });

  it("blocks unresolved evidence and claim bindings", async () => {
    const input = await validAuditInput();
    const report = auditFigureSemantics({ ...input, spec: { ...input.spec, evidenceIds: ["EV-MISSING"] } });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_EVIDENCE_UNRESOLVED" }));
  });

  it("derives source, unit, and denominator findings from canonical data", async () => {
    const input = await validAuditInput();
    const secondDataset = {
      ...validData.datasets[0]!,
      dataId: "DATA-OTHER",
      sourceIds: ["SRC-OTHER"],
      unit: "%",
      denominator: "연간",
      observations: validData.datasets[0]!.observations.map((observation) => ({
        ...observation,
        observationId: `OTHER-${observation.observationId}`,
        sourceId: "SRC-OTHER",
      })),
    };
    const spec = { ...input.spec, dataIds: ["DATA-TREND-001", "DATA-OTHER"] };
    const data = { datasets: [validData.datasets[0]!, secondDataset] };
    const report = auditFigureSemantics({ ...input, spec, data });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_SOURCE_DATA_MISMATCH" }));
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_UNIT_MISMATCH" }));
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_DENOMINATOR_MISMATCH" }));
  });

  it.each([
    ["A4 overflow", { figureBox: { ...validPageContext.figureBox, widthMm: 190 } }, "PP_FIGURE_A4_FOOTPRINT"],
    ["missing caption", { caption: "" }, "PP_FIGURE_CAPTION_MISSING"],
    ["missing section callout", { sectionCallout: "" }, "PP_FIGURE_SECTION_CALLOUT_MISSING"],
    ["repeated geometry", { peerFigureBoxes: [validPageContext.figureBox, validPageContext.figureBox] }, "PP_FIGURE_GEOMETRY_REPEATED"],
  ] as const)("blocks %s from the measured final-page artifact", async (_name, override, code) => {
    const input = await validAuditInput();
    const pageContext = { ...input.pageContext, ...override };
    const pageArtifact = renderFigureA4Page(input.artifact, pageContext);
    const report = auditFigureSemantics({ ...input, pageContext, pageArtifact });

    expect(report.findings).toContainEqual(expect.objectContaining({ code }));
  });

  it("requires two independent hash-bound approval receipts before human_approved", async () => {
    const input = await validAuditInput();
    const report = auditFigureSemantics({
      ...input,
      spec: { ...input.spec, approvalStatus: "human_approved" },
      humanReviews: [reviewReceipt(input, "reviewer-1")],
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_HUMAN_APPROVAL_INCOMPLETE" }));
  });

  it("rejects stale human review after final page bytes or locator change", async () => {
    const input = await validAuditInput();
    const reviews = [reviewReceipt(input, "reviewer-1"), reviewReceipt(input, "reviewer-2")];
    const pageContext = { ...input.pageContext, pageLocator: "page:6", sectionCallout: `${input.pageContext.sectionCallout} 수정` };
    const pageArtifact = renderFigureA4Page(input.artifact, pageContext);
    const report = auditFigureSemantics({
      ...input,
      spec: { ...input.spec, approvalStatus: "human_approved" },
      pageContext,
      pageArtifact,
      humanReviews: reviews,
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_HUMAN_APPROVAL_STALE" }));
  });

  it("accepts human_approved only with two current independent approval receipts", async () => {
    const input = await validAuditInput();
    const reviews = [reviewReceipt(input, "reviewer-1"), reviewReceipt(input, "reviewer-2")];
    const report = auditFigureSemantics({
      ...input,
      spec: { ...input.spec, approvalStatus: "human_approved" },
      humanReviews: reviews,
    });

    expect(report.status, JSON.stringify(report.findings)).toBe("PASS");
    expect(report.humanApprovalStatus).toBe("human_approved");
  });

  it("rejects a public canonical fixture with private or nonsynthetic lineage", async () => {
    const input = await validAuditInput();
    const references = [{
      ...validReferences[0]!,
      storageClass: "public_canonical_fixture" as const,
      rightsStatus: "project_private" as const,
      synthetic: false,
      publiclyReleasable: true,
      sourceLineageClass: "project_private" as const,
    }];
    const report = auditFigureSemantics({ ...input, references });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PP_FIGURE_REFERENCE_UNGOVERNED" }));
  });
});

async function validAuditInput(): Promise<FigureSemanticAuditInput> {
  const artifact = await compileFigure(validSpec, validData, validReferences);
  const pageArtifact = renderFigureA4Page(artifact, validPageContext);
  return {
    spec: validSpec,
    data: validData,
    references: validReferences,
    artifact,
    pageContext: validPageContext,
    pageArtifact,
    humanReviews: [],
  };
}

function reviewReceipt(input: FigureSemanticAuditInput, reviewerId: string): HumanFigureReview {
  const receipt = {
    reviewId: `REVIEW-${reviewerId}`,
    reviewerId,
    reviewedAt: "2026-08-19T10:00:00.000Z",
    reviewedFigureSvgSha256: input.artifact.sha256,
    reviewedFigureIrSha256: input.artifact.hashes.irSha256,
    reviewedPageRenderSha256: input.pageArtifact.sha256,
    pageLocator: input.pageContext.pageLocator,
    renderedInA4Context: true,
    meaning: true,
    trustworthiness: true,
    documentFit: true,
    sendReady: true,
  } as const;
  return { ...receipt, approvalReceiptSha256: sha256(canonicalFigureInputsJson(receipt)) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
