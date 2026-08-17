import {
  SemanticFigureRequestSchema,
  SemanticFigureSpecSchema,
  type DeterministicFigureRenderer,
  type SemanticFigureFamily,
  type SemanticFigureSpec,
} from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";

const FAMILY_BY_INTENT: Readonly<Record<string, SemanticFigureFamily>> = {
  schedule: "gantt",
  responsibility: "raci",
  matrix: "matrix",
  comparison: "comparison_chart",
  evidence_chain: "evidence_chain",
  research_framework: "framework",
  flow: "flow",
};

const FAMILY_BY_DATA_SHAPE: Readonly<Record<string, SemanticFigureFamily>> = {
  time_axis: "gantt",
  responsibility_matrix: "raci",
  two_by_two: "matrix",
  comparison_series: "comparison_chart",
  evidence_links: "evidence_chain",
  research_framework: "framework",
  process_flow: "flow",
};

const RENDERER_BY_FAMILY: Readonly<Record<SemanticFigureFamily, DeterministicFigureRenderer>> = {
  gantt: "svg-gantt",
  raci: "word-native-raci-table",
  matrix: "svg-2x2-matrix",
  comparison_chart: "svg-comparison-chart",
  evidence_chain: "svg-evidence-chain",
  framework: "svg-academic-framework",
  flow: "svg-flow",
};

/**
 * Selects the rendering family from the evaluator task and data shape. This
 * function deliberately has no generic-card fallback: schedules, role
 * assignment, matrices, comparisons, and evidence chains must retain their
 * inspectable semantic structure.
 */
export function planFigure(input: unknown): SemanticFigureSpec {
  const request = parseRequest(input);
  if (request.evidenceIds.length === 0) {
    throw new KppError(
      "KPP_EVIDENCE_FIGURE_UNBOUND",
      "근거 ID가 없는 도식은 계획할 수 없습니다.",
      { rule: "figure_evidence_required", actual: request.figureId },
    );
  }

  const expectedByIntent = FAMILY_BY_INTENT[request.intent];
  const expectedByShape = FAMILY_BY_DATA_SHAPE[request.dataShape];
  const expectedByTimeAxis = request.hasTimeAxis ? "gantt" : undefined;
  const expectedFamilies = [expectedByIntent, expectedByShape, expectedByTimeAxis]
    .filter((family): family is SemanticFigureFamily => family !== undefined);

  if (new Set(expectedFamilies).size !== 1) {
    throw familyError(request.figureId, {
      rule: "intent_data_shape_mismatch",
      expected: expectedFamilies,
      actual: { intent: request.intent, dataShape: request.dataShape, hasTimeAxis: request.hasTimeAxis },
    });
  }
  const family = expectedFamilies[0]!;

  if (request.requestedFamily === "generic_cards") {
    throw familyError(request.figureId, {
      rule: "generic_cards_prohibited",
      expected: family,
      actual: request.requestedFamily,
    });
  }
  if (request.requestedFamily !== undefined && request.requestedFamily !== family) {
    throw familyError(request.figureId, {
      rule: "requested_family_mismatch",
      expected: family,
      actual: request.requestedFamily,
    });
  }

  return SemanticFigureSpecSchema.parse({
    figureId: request.figureId,
    requirementId: request.requirementId,
    pageId: request.pageId,
    title: request.title,
    intent: request.intent,
    dataShape: request.dataShape,
    decisionTask: request.decisionTask,
    claimIds: uniqueInOrder(request.claimIds),
    evidenceIds: uniqueInOrder(request.evidenceIds),
    family,
    renderer: RENDERER_BY_FAMILY[family],
  });
}

function parseRequest(value: unknown) {
  const parsed = SemanticFigureRequestSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new KppError("KPP_INPUT_FIGURE_INVALID", "도식 계획 입력 형식이 올바르지 않습니다.", {
    rule: "semantic_figure_request_schema",
    actual: parsed.error.issues,
  });
}

function familyError(figureId: string, details: {
  readonly rule: string;
  readonly expected: unknown;
  readonly actual: unknown;
}): KppError {
  return new KppError("KPP_DESIGN_FIGURE_FAMILY", "도식의 의미와 유형이 일치하지 않습니다.", {
    ...details,
    path: figureId,
  });
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}
