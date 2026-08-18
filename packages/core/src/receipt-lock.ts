import { mkdir, open, rmdir } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { basename, dirname, join } from "node:path";

const LOCK_ATTEMPTS = 200;
const LOCK_RETRY_MS = 5;

export async function withReceiptPathLock<T>(
  receiptPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const directory = dirname(receiptPath);
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, `.${basename(receiptPath)}.lock`);
  await acquireLock(lockPath);
  try {
    return await operation();
  } finally {
    await rmdir(lockPath);
    await syncDirectory(directory);
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath);
      await syncDirectory(dirname(lockPath));
      return;
    } catch (error) {
      if (!isFileExistsError(error) || attempt === LOCK_ATTEMPTS - 1) {
        throw error;
      }
      await setTimeout(LOCK_RETRY_MS);
    }
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "EEXIST"
  );
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
