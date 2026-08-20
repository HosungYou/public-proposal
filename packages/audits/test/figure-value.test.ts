import { describe, expect, test } from "vitest";
import {
  auditFigureSemanticValue,
  type FigureSemanticValueRecord,
} from "../src/index.js";

const comparison: FigureSemanticValueRecord = {
  figureId: "FIG-COMPARISON-001",
  family: "comparison_chart",
  semanticValueIntent: "data_evidence",
  decisionEffect: "대안별 비용과 도입 우선순위를 변경한다.",
  nonDuplicateOf: ["BLK-COMPARISON-NARRATIVE"],
  evidenceIds: ["EV-COST-001"],
  claimIds: ["CL-COST-001"],
  orderedLabels: ["현행", "대안 A", "대안 B"],
  roleCounts: { series: 3 },
  stateCounts: {},
  encodedVariables: ["cost", "benefit", "priority"],
  encodedVariableValues: { cost: [10, 12, 15], benefit: [3, 5, 8], priority: [3, 2, 1] },
  topologySignature: "a".repeat(64),
};

describe("semantic figure-value audit", () => {
  test("credits a sourced comparison that changes a decision", () => {
    const result = auditFigureSemanticValue([comparison], [{
      blockId: "BLK-COMPARISON-NARRATIVE",
      text: "대안의 비용과 편익은 원자료에서 확인한다.",
    }]);

    expect(result.status).toBe("PASS");
    expect(result.findings).toEqual([]);
  });

  test("credits an owner, timing, and acceptance RACI as operational control", () => {
    const result = auditFigureSemanticValue([{
      ...comparison,
      figureId: "FIG-RACI-001",
      family: "raci",
      semanticValueIntent: "operational_control",
      decisionEffect: "각 과업의 담당자와 승인 시점을 확정한다.",
      nonDuplicateOf: ["BLK-RACI-NARRATIVE"],
      orderedLabels: ["착수", "중간보고", "최종검수"],
      roleCounts: { accountable: 3, responsible: 3 },
      stateCounts: { planned: 3 },
      encodedVariables: ["owner", "timing", "acceptance"],
      topologySignature: "b".repeat(64),
    }], [{ blockId: "BLK-RACI-NARRATIVE", text: "역할은 별도 표에서 검토한다." }]);

    expect(result.status).toBe("PASS");
  });

  test("gives a decorative figure no evidentiary credit", () => {
    const result = auditFigureSemanticValue([{
      ...comparison,
      figureId: "FIG-DECORATIVE-001",
      semanticValueIntent: "decorative",
      decisionEffect: "",
      nonDuplicateOf: [],
      evidenceIds: [],
      claimIds: [],
      encodedVariables: [],
      topologySignature: "c".repeat(64),
    }], []);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map(({ code }) => code)).toContain("KPP_FIGURE_VALUE_DECORATIVE");
  });

  test("blocks a figure that merely restates adjacent prose", () => {
    const result = auditFigureSemanticValue([comparison], [{
      blockId: "BLK-COMPARISON-NARRATIVE",
      text: comparison.decisionEffect,
    }]);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map(({ code }) => code)).toContain("KPP_FIGURE_VALUE_PROSE_RESTATEMENT");
  });
});
