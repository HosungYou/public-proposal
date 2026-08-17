import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  ReceiptSchema,
  type ProjectState,
  type Receipt,
  type ReceiptResult,
} from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";

const DEFAULT_SCHEMA_VERSION = "1.0.0";
const DEFAULT_TOOL_VERSION = "0.1.0";

export interface ReceiptInput {
  readonly stage: ProjectState;
  readonly files: readonly string[];
  readonly output: string;
  readonly inputReceiptHashes?: readonly string[];
  readonly result?: ReceiptResult;
  readonly schemaVersion?: string;
  readonly toolVersion?: string;
}

export interface ReceiptVerificationMismatch {
  readonly path: string;
  readonly expectedSha256: string;
  readonly actualSha256?: string;
}

export interface ReceiptVerification {
  readonly valid: boolean;
  readonly receipt: Receipt;
  readonly mismatches: readonly ReceiptVerificationMismatch[];
}

export async function writeReceipt(input: ReceiptInput): Promise<Receipt> {
  const files = await Promise.all(
    input.files.map(async (path) => ({ path, sha256: await sha256File(path) })),
  );
  const receipt = parseReceipt({
    schemaVersion: input.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
    stage: input.stage,
    createdAt: new Date().toISOString(),
    toolVersion: input.toolVersion ?? DEFAULT_TOOL_VERSION,
    files: files.sort(compareFileRecords),
    inputReceiptHashes: [...(input.inputReceiptHashes ?? [])].sort(),
    result: input.result ?? "PASS",
  }, input.output);

  await writeAtomically(input.output, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function verifyReceipt(path: string): Promise<ReceiptVerification> {
  const receipt = await readReceipt(path);
  const mismatches = (
    await Promise.all(
      receipt.files.map(async (file): Promise<ReceiptVerificationMismatch | null> => {
        try {
          const actualSha256 = await sha256File(file.path);
          return actualSha256 === file.sha256
            ? null
            : { path: file.path, expectedSha256: file.sha256, actualSha256 };
        } catch {
          return { path: file.path, expectedSha256: file.sha256 };
        }
      }),
    )
  ).filter((mismatch): mismatch is ReceiptVerificationMismatch => mismatch !== null);

  return { valid: mismatches.length === 0, receipt, mismatches };
}

async function readReceipt(path: string): Promise<Receipt> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new KppError("KPP_INPUT_RECEIPT_READ", "영수증 파일을 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }

  try {
    return parseReceipt(JSON.parse(raw), path);
  } catch (error) {
    if (error instanceof KppError) {
      throw error;
    }
    throw new KppError("KPP_INPUT_RECEIPT_INVALID", "영수증 파일이 올바른 JSON이 아닙니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

function parseReceipt(value: unknown, path: string): Receipt {
  const parsed = ReceiptSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new KppError("KPP_INPUT_RECEIPT_INVALID", "영수증 형식이 올바르지 않습니다.", {
    path,
    actual: parsed.error.issues,
  });
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let created = false;
  let renamed = false;

  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(contents, "utf8");
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

function compareFileRecords(
  left: { path: string },
  right: { path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}
