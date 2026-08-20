import { describe, expect, test } from "vitest";
import { SemanticFigureSpecSchema } from "@longtable/kpp-schemas";
import { expectedEmbeddedRenderer } from "../src/figure-family.js";

describe("embedded semantic figure renderer contract", () => {
  test.each([
    ["gantt", "svg-gantt"],
    ["raci", "word-native-raci-table"],
    ["framework", "svg-academic-framework"],
  ] as const)("uses the schema-approved renderer for %s", (family, renderer) => {
    expect(expectedEmbeddedRenderer(family)).toBe(renderer);
  });

  test("the RACI and framework mappings remain accepted by the persisted figure schema", () => {
    const common = {
      figureId: "FIG-01",
      requirementId: "REQ-01",
      pageId: "P-01",
      title: "검증 도식",
      decisionTask: "담당과 의사결정 경계를 확인한다.",
      claimIds: ["CLM-01"],
      evidenceIds: ["EV-01"],
      semanticValueIntent: "operational_control",
      decisionEffect: "담당과 승인 기준을 확정한다.",
      nonDuplicateOf: ["P-01"],
      encodedVariables: ["owner", "timing", "acceptance"],
    } as const;
    expect(SemanticFigureSpecSchema.safeParse({
      ...common,
      intent: "responsibility",
      dataShape: "responsibility_matrix",
      family: "raci",
      renderer: expectedEmbeddedRenderer("raci"),
    }).success).toBe(true);
    expect(SemanticFigureSpecSchema.safeParse({
      ...common,
      intent: "research_framework",
      dataShape: "research_framework",
      family: "framework",
      renderer: expectedEmbeddedRenderer("framework"),
    }).success).toBe(true);
  });
});
