import { blocked, makeSlice, sha256Text, type AuditFinding, type AuditSlice } from "./source.js";

/**
 * Normalizes a Korean proposal sentence for exact-content repetition checks.
 * This deliberately does not apply semantic similarity: a deterministic
 * submission gate must not infer that two different sentences mean the same
 * thing.
 */
export function sentenceFingerprint(sentence: string): string {
  return sentence
    .normalize("NFKC")
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[“”"'‘’·,;:!?()[\]{}]/g, "")
    .replace(/[.。…]+$/g, "")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

export interface RepetitionOccurrence {
  readonly blockId: string;
  readonly field: string;
  readonly sentence: string;
}

export interface RepeatedSentence {
  readonly fingerprint: string;
  readonly occurrences: readonly RepetitionOccurrence[];
}

export function findRepeatedSentences(
  entries: readonly RepetitionOccurrence[],
): readonly RepeatedSentence[] {
  const byFingerprint = new Map<string, RepetitionOccurrence[]>();
  for (const entry of entries) {
    for (const sentence of splitSentences(entry.sentence)) {
      const fingerprint = sentenceFingerprint(sentence);
      if (fingerprint.length < 12) {
        continue;
      }
      const occurrences = byFingerprint.get(fingerprint) ?? [];
      occurrences.push({ ...entry, sentence });
      byFingerprint.set(fingerprint, occurrences);
    }
  }
  return [...byFingerprint.entries()]
    .filter(([, occurrences]) => new Set(occurrences.map(({ blockId }) => blockId)).size > 1)
    .sort(([left], [right]) => left.localeCompare(right, "ko-KR"))
    .map(([fingerprint, occurrences]) => ({
      fingerprint,
      occurrences: occurrences.sort(compareOccurrence),
    }));
}

export interface SurfaceRepetitionException {
  readonly ruleId: "issuer_mandatory_form" | "accessibility_repeated_instruction";
  readonly sourceId: string;
  /** SHA-256 of the verified source record carried by the page architecture. */
  readonly sourceSha256: string;
  readonly rationale: string;
}

export interface SurfaceTopologyObservation {
  readonly pageLocator: string;
  readonly topologySignature: string;
  readonly permittedException?: SurfaceRepetitionException;
}

/**
 * Blocks consecutive page skeletons by semantic topology, not pixels. A
 * repeated mandatory form is permissible only when every page in its run has
 * the same explicit, source-bound exception class.
 */
export function auditSurfaceRepetition(observations: readonly SurfaceTopologyObservation[]): AuditSlice {
  const findings: AuditFinding[] = [];
  for (const observation of observations) {
    if (!/^page:\d{4}$/u.test(observation.pageLocator)
      || !/^[a-f0-9]{64}$/u.test(observation.topologySignature)) {
      findings.push(blocked("KPP_RENDER_SURFACE_TOPOLOGY_INVALID", "rendered surface topology observation 형식이 올바르지 않습니다.", { actual: observation }));
    }
  }
  let start = 0;
  while (start < observations.length) {
    const first = observations[start]!;
    let end = start + 1;
    while (end < observations.length && observations[end]!.topologySignature === first.topologySignature) end += 1;
    const run = observations.slice(start, end);
    if (run.length > 1 && !hasSinglePermittedException(run)) {
      findings.push(blocked("KPP_RENDER_SURFACE_TOPOLOGY_REPETITION", "연속 페이지가 같은 reader-facing surface topology를 반복합니다.", {
        actual: { pages: run.map(({ pageLocator }) => pageLocator), topologySignature: first.topologySignature },
      }));
    }
    start = end;
  }
  return makeSlice(findings, []);
}

/**
 * The derived signature excludes pixel and text-region hashes. It records
 * only observable surface family, heading hierarchy, and block geometry.
 */
export function surfaceTopologySignature(input: {
  readonly surfaceFamily: string;
  readonly titleBlocks: readonly { readonly region: string; readonly pointSize: number }[];
  readonly geometry: { readonly textBlockCount: number; readonly tableCount: number; readonly figureCount: number };
  readonly continuationFromPrevious: boolean;
  readonly continuationToNext: boolean;
}): string {
  return sha256Text(JSON.stringify({
    surfaceFamily: input.surfaceFamily,
    titleBlocks: input.titleBlocks.map(({ region, pointSize }) => ({ region, pointSize })),
    geometry: input.geometry,
    continuationFromPrevious: input.continuationFromPrevious,
    continuationToNext: input.continuationToNext,
  }));
}

function hasPermittedException(value: SurfaceRepetitionException | undefined): boolean {
  return value !== undefined
    && (value.ruleId === "issuer_mandatory_form" || value.ruleId === "accessibility_repeated_instruction")
    && value.sourceId.trim().length > 0
    && /^[a-f0-9]{64}$/u.test(value.sourceSha256)
    && value.rationale.trim().length > 0;
}

function hasSinglePermittedException(run: readonly SurfaceTopologyObservation[]): boolean {
  const first = run[0]?.permittedException;
  return first !== undefined
    && hasPermittedException(first)
    && run.every(({ permittedException }) => permittedException !== undefined
      && hasPermittedException(permittedException)
      && permittedException.ruleId === first.ruleId
      && permittedException.sourceId === first.sourceId
      && permittedException.sourceSha256 === first.sourceSha256);
}

function splitSentences(value: string): readonly string[] {
  return value
    .split(/(?<=[.!?。])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function compareOccurrence(left: RepetitionOccurrence, right: RepetitionOccurrence): number {
  return left.blockId.localeCompare(right.blockId, "ko-KR")
    || left.field.localeCompare(right.field, "ko-KR")
    || left.sentence.localeCompare(right.sentence, "ko-KR");
}
