import type { FigureSemanticValueRecord } from "@longtable/kpp-renderers";
import { blocked, makeSlice, type AuditFinding, type AuditSlice } from "./source.js";

export type { FigureSemanticValueRecord } from "@longtable/kpp-renderers";

/** A reader-facing prose or table block adjacent to a semantic figure. */
export interface NeighboringContentBlock {
  readonly blockId: string;
  readonly text: string;
}

/**
 * Evaluates whether an evidentiary figure changes a decision in a way prose
 * alone does not. It deliberately has no figure-count threshold.
 */
export function auditFigureSemanticValue(
  figures: readonly FigureSemanticValueRecord[],
  neighboringBlocks: readonly NeighboringContentBlock[],
): AuditSlice {
  const findings: AuditFinding[] = [];
  const seenFigureIds = new Set<string>();
  const blocksById = new Map(neighboringBlocks.map((block) => [block.blockId, block]));
  for (const figure of figures) {
    if (seenFigureIds.has(figure.figureId)) {
      findings.push(blocked("KPP_FIGURE_VALUE_ID_DUPLICATE", "semantic figure ID가 유일하지 않습니다.", { actual: figure.figureId }));
      continue;
    }
    seenFigureIds.add(figure.figureId);
    if (figure.semanticValueIntent === "decorative") {
      findings.push(blocked("KPP_FIGURE_VALUE_DECORATIVE", "장식용 도식은 근거나 의사결정 가치를 주장할 수 없습니다.", { actual: figure.figureId }));
      continue;
    }
    if (figure.evidenceIds.length === 0 || figure.claimIds.length === 0
      || figure.decisionEffect.trim().length === 0 || figure.nonDuplicateOf.length === 0
      || figure.encodedVariables.length === 0 || !/^[a-f0-9]{64}$/u.test(figure.topologySignature)) {
      findings.push(blocked("KPP_FIGURE_VALUE_UNBOUND", "비장식 도식에 결정 효과, 비중복 선언, 근거·주장·변수 또는 topology 결속이 없습니다.", {
        actual: figure.figureId,
      }));
      continue;
    }
    for (const blockId of figure.nonDuplicateOf) {
      const block = blocksById.get(blockId);
      if (block !== undefined && restatesBlock(figure, block)) {
        findings.push(blocked("KPP_FIGURE_VALUE_PROSE_RESTATEMENT", "도식이 인접한 prose/table block을 그대로 반복합니다.", {
          actual: { figureId: figure.figureId, blockId },
        }));
      }
    }
    if (!hasValueSpecificStructure(figure)) {
      findings.push(blocked("KPP_FIGURE_VALUE_STRUCTURE", "선언한 semantic value intent를 검토 가능한 구조로 인코딩하지 않았습니다.", {
        actual: { figureId: figure.figureId, intent: figure.semanticValueIntent },
      }));
    }
  }
  return makeSlice(findings, []);
}

function hasValueSpecificStructure(figure: FigureSemanticValueRecord): boolean {
  if (figure.semanticValueIntent === "data_evidence") {
    return figure.orderedLabels.length >= 2 && figure.evidenceIds.length > 0 && figure.encodedVariables.length > 0;
  }
  if (figure.semanticValueIntent === "causal_mechanism") {
    return figure.orderedLabels.length >= 2 && Object.values(figure.roleCounts).some((count) => count > 0);
  }
  if (figure.semanticValueIntent === "decision_tradeoff") {
    return figure.orderedLabels.length >= 2 && figure.encodedVariables.length >= 2;
  }
  const variables = new Set(figure.encodedVariables.map((value) => value.toLocaleLowerCase("en-US")));
  return ["owner", "timing", "acceptance"].every((value) => variables.has(value));
}

function restatesBlock(figure: FigureSemanticValueRecord, block: NeighboringContentBlock): boolean {
  const decision = normalize(figure.decisionEffect);
  const prose = normalize(block.text);
  return decision.length > 0 && prose === decision;
}

function normalize(value: string): string {
  return value.normalize("NFKC")
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[“”"'‘’·,;:!?()[\]{}]/g, "")
    .replace(/[.。…]+$/g, "")
    .trim()
    .toLocaleLowerCase("ko-KR");
}
