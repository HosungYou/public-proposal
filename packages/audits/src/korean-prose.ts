import type { ApprovedTerminology, AuthoringResponse } from "@longtable/kpp-schemas";
import { findRepeatedSentences, type RepetitionOccurrence } from "./repetition.js";

export type ContentFindingSeverity = "blocker" | "warning";

export interface ContentFinding {
  readonly code:
    | "KPP_CONTENT_UNDEFINED_TERM"
    | "KPP_CONTENT_VAGUE_PROMISE"
    | "KPP_CONTENT_PLACEHOLDER"
    | "KPP_CONTENT_REPETITION"
    | "KPP_CONTENT_STYLE_LONG_SENTENCE";
  readonly severity: ContentFindingSeverity;
  readonly message: string;
  readonly blockId?: string;
  readonly field?: "text" | "evaluatorAnswer";
  readonly actual?: unknown;
}

export interface KoreanProseLintResult {
  readonly findings: readonly ContentFinding[];
  readonly blockers: readonly ContentFinding[];
  readonly warnings: readonly ContentFinding[];
  readonly codes: readonly ContentFinding["code"][];
}

export interface ProseBlock {
  readonly blockId: string;
  readonly text: string;
  readonly evaluatorAnswer?: string;
}

const GENERALLY_DEFINED_ACRONYMS = new Set([
  "AI",
  "API",
  "DOCX",
  "HWP",
  "HWPX",
  "JSON",
  "KPI",
  "OOXML",
  "PDF",
  "PNG",
  "RACI",
  "RFP",
  "SVG",
]);

const VAGUE_PROMISE_PATTERNS: readonly RegExp[] = [
  /최적화된\s*(?:혁신\s*)?(?:솔루션|방안)/u,
  /혁신(?:적인|적)?\s*(?:솔루션|방안)/u,
  /성공(?:을|을\s*)?보장/u,
  /차별화된\s*(?:인사이트|솔루션|가치)/u,
  /원스톱\s*(?:솔루션|서비스|지원)/u,
  /(?:end-to-end|best\s*practice|game\s*changer)/iu,
];

const PLACEHOLDER_PATTERN = /\{\{[^}]+\}\}|\b(?:TBD|TO\s*BE\s*DECIDED)\b|\[(?:작성|입력|추후)[^\]]*\]|(?:추후\s*입력|입력\s*필요|미정)/giu;
const ACRONYM_PATTERN = /\b[A-Z][A-Z0-9-]{1,}\b/g;
const LONG_SENTENCE_LENGTH = 180;

export function lintKoreanProse(
  input: string | readonly ProseBlock[],
  glossary: ApprovedTerminology,
): KoreanProseLintResult {
  const blocks = typeof input === "string"
    ? [{ blockId: "content", text: input }]
    : input;
  const approvedTerms = new Set(glossary.entries.map(({ term }) => normalizeTerm(term)));
  const findings: ContentFinding[] = [];
  const occurrences: RepetitionOccurrence[] = [];

  for (const block of blocks) {
    inspectField(block.blockId, "text", block.text, approvedTerms, findings, occurrences);
    if (block.evaluatorAnswer !== undefined) {
      inspectField(block.blockId, "evaluatorAnswer", block.evaluatorAnswer, approvedTerms, findings, occurrences);
    }
  }

  for (const repeated of findRepeatedSentences(occurrences)) {
    findings.push({
      code: "KPP_CONTENT_REPETITION",
      severity: "blocker",
      message: "서로 다른 콘텐츠 블록에 동일한 문장이 반복되어 있습니다.",
      actual: repeated,
    });
  }

  return summarizeFindings(findings);
}

export function lintAuthoringResponse(
  response: AuthoringResponse,
  glossary: ApprovedTerminology,
): KoreanProseLintResult {
  return lintKoreanProse(response.blocks.map((block) => ({
    blockId: block.pageId,
    text: block.text,
    evaluatorAnswer: block.evaluatorAnswer,
  })), glossary);
}

function inspectField(
  blockId: string,
  field: "text" | "evaluatorAnswer",
  value: string,
  approvedTerms: ReadonlySet<string>,
  findings: ContentFinding[],
  occurrences: RepetitionOccurrence[],
): void {
  occurrences.push({ blockId, field, sentence: value });

  for (const acronym of value.match(ACRONYM_PATTERN) ?? []) {
    const normalized = normalizeTerm(acronym);
    if (!GENERALLY_DEFINED_ACRONYMS.has(normalized) && !approvedTerms.has(normalized)) {
      findings.push({
        code: "KPP_CONTENT_UNDEFINED_TERM",
        severity: "blocker",
        message: "용어집에 정의되지 않은 프로젝트성 영문 약어가 있습니다.",
        blockId,
        field,
        actual: acronym,
      });
    }
  }

  for (const pattern of VAGUE_PROMISE_PATTERNS) {
    const match = pattern.exec(value);
    if (match !== null) {
      findings.push({
        code: "KPP_CONTENT_VAGUE_PROMISE",
        severity: "blocker",
        message: "근거·수행방법 없이 결과를 약속하는 컨설팅식 표현이 있습니다.",
        blockId,
        field,
        actual: match[0],
      });
    }
  }

  for (const match of value.match(PLACEHOLDER_PATTERN) ?? []) {
    findings.push({
      code: "KPP_CONTENT_PLACEHOLDER",
      severity: "blocker",
      message: "제출용 콘텐츠에 미해결 자리표시자 또는 pending_blank가 남아 있습니다.",
      blockId,
      field,
      actual: match,
    });
  }

  for (const sentence of splitSentences(value)) {
    if ([...sentence].length > LONG_SENTENCE_LENGTH) {
      findings.push({
        code: "KPP_CONTENT_STYLE_LONG_SENTENCE",
        severity: "warning",
        message: "한 문장이 길어 평가자가 핵심을 읽기 어려울 수 있습니다.",
        blockId,
        field,
        actual: [...sentence].length,
      });
    }
  }
}

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").trim().toLocaleUpperCase("en-US");
}

function splitSentences(value: string): readonly string[] {
  return value
    .split(/(?<=[.!?。])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function summarizeFindings(findings: readonly ContentFinding[]): KoreanProseLintResult {
  const ordered = [...findings].sort(compareFinding);
  const blockers = ordered.filter(({ severity }) => severity === "blocker");
  const warnings = ordered.filter(({ severity }) => severity === "warning");
  return {
    findings: ordered,
    blockers,
    warnings,
    codes: [...new Set(ordered.map(({ code }) => code))],
  };
}

function compareFinding(left: ContentFinding, right: ContentFinding): number {
  return left.code.localeCompare(right.code, "en")
    || (left.blockId ?? "").localeCompare(right.blockId ?? "", "ko-KR")
    || (left.field ?? "").localeCompare(right.field ?? "", "en")
    || JSON.stringify(left.actual).localeCompare(JSON.stringify(right.actual), "ko-KR");
}
