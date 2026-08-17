import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  RfpCandidatesFileSchema,
  type RfpCandidate,
  type RfpCandidateCategory,
  type RfpCandidatesFile,
} from "@longtable/kpp-schemas";
import { sha256File } from "./hash.js";
import {
  extractTextDocument,
  type ExtractedTextDocument,
  type TextExtractionOptions,
} from "./text-extraction.js";

export { extractTextDocument, type ExtractedTextDocument, type TextExtractionOptions };

interface CandidateRule {
  readonly category: RfpCandidateCategory;
  readonly confidence: number;
  readonly matches: (line: string) => boolean;
}

const CANDIDATE_RULES: readonly CandidateRule[] = [
  {
    category: "page_limit",
    confidence: 0.82,
    matches: (line) => /(?:제안서|작성\s*분량|본문).{0,70}\d{1,3}\s*(?:쪽|페이지|p)\s*(?:이내|이하|초과\s*(?:할\s*)?수\s*없)/iu.test(line),
  },
  {
    category: "format",
    confidence: 0.76,
    matches: (line) => /(?:A\s*4|용지\s*(?:규격|크기)|세로\s*방향|가로\s*방향)/iu.test(line)
      && /(?:제안서|작성|용지|규격|방향)/iu.test(line),
  },
  {
    category: "font",
    confidence: 0.78,
    matches: (line) => /(?:글꼴|폰트|서체).{0,70}(?:\d+(?:\.\d+)?\s*(?:pt|포인트)|고딕|명조)/iu.test(line),
  },
  {
    category: "deadline",
    confidence: 0.84,
    matches: (line) => /(?:제출\s*(?:마감|기한|일시)|마감\s*(?:일시|일|시간)).{0,90}(?:20\d{2}|\d{1,2}\s*[:시]|오전|오후)/iu.test(line),
  },
  {
    category: "anonymity",
    confidence: 0.79,
    matches: (line) => /(?:익명|회사명|기관명|상호).{0,90}(?:기재.{0,20}(?:금지|불가|없)|표기.{0,20}(?:금지|불가|없)|삭제|제외)/iu.test(line),
  },
  {
    category: "required_form",
    confidence: 0.75,
    matches: (line) => /(?:별지|서식)\s*(?:제\s*)?\d+\s*(?:호\s*)?(?:서식)?/iu.test(line),
  },
];

export async function extractRequirementCandidates(
  sourcePath: string,
  options: TextExtractionOptions = {},
): Promise<readonly RfpCandidate[]> {
  const document = await extractTextDocument(sourcePath, options);
  const sourceSha256 = await sha256File(document.sourcePath);

  let candidateNumber = 0;
  const candidates = document.pages.flatMap(({ sourceLocator, text }) => (
    text.split(/\r?\n/).flatMap((sourceLine) => {
      const extractedText = sourceLine.trim();
      if (extractedText.length === 0) {
        return [];
      }
      return CANDIDATE_RULES.filter(({ matches }) => matches(extractedText)).map((rule) => {
        candidateNumber += 1;
        return {
          candidateId: `CAND-${String(candidateNumber).padStart(3, "0")}`,
          sourcePath: document.sourcePath,
          sourceSha256,
          sourceLocator,
          extractedText,
          category: rule.category,
          confidence: rule.confidence,
          status: "pending" as const,
        };
      });
    })
  ));

  return candidates;
}

export async function extractRequirementCandidatesFile(
  sourcePath: string,
  options: TextExtractionOptions = {},
): Promise<RfpCandidatesFile> {
  return RfpCandidatesFileSchema.parse({
    schemaVersion: "1.0.0",
    candidates: await extractRequirementCandidates(sourcePath, options),
  });
}

export async function writeRequirementCandidates(
  projectRoot: string,
  sourcePath: string,
  options: TextExtractionOptions = {},
): Promise<string> {
  const outputPath = join(projectRoot, "requirements", "candidates.json");
  const candidates = await extractRequirementCandidatesFile(sourcePath, options);
  await writeJsonAtomically(outputPath, candidates);
  return outputPath;
}

async function writeJsonAtomically(path: string, value: RfpCandidatesFile): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let created = false;
  let renamed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    renamed = true;
    await syncDirectory(directory);
  } finally {
    if (created && !renamed) {
      await rm(temporaryPath, { force: true });
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
