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
