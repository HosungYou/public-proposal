import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { basename, dirname, join } from "node:path";
import { KppError } from "./errors.js";

const LOCK_ATTEMPTS = 200;
const LOCK_RETRY_MS = 5;
const LOCK_OWNER_FILE = "owner.json";

interface ReceiptLockOwner {
  readonly pid: number;
  readonly token: string;
  readonly createdAt: string;
}

interface ReceiptLockTestHooks {
  readonly failAfterLockDirectoryCreated?: boolean;
  readonly failAfterOwnerMetadataWritten?: boolean;
  readonly lockAttempts?: number;
  readonly lockRetryMs?: number;
}

let testHooks: ReceiptLockTestHooks = {};

export function __setReceiptLockTestHooks(hooks: ReceiptLockTestHooks): void {
  testHooks = hooks;
}

export async function withReceiptPathLock<T>(
  receiptPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const directory = dirname(receiptPath);
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, `.${basename(receiptPath)}.lock`);
  const owner = await acquireLock(lockPath);
  try {
    return await operation();
  } finally {
    await releaseLock(lockPath, owner);
  }
}

async function acquireLock(lockPath: string): Promise<ReceiptLockOwner> {
  const attempts = testHooks.lockAttempts ?? LOCK_ATTEMPTS;
  const retryMs = testHooks.lockRetryMs ?? LOCK_RETRY_MS;
  const owner = {
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await mkdir(lockPath);
      try {
        if (testHooks.failAfterLockDirectoryCreated === true) {
          throw new Error("injected receipt lock owner write failure");
        }
        await writeFile(ownerPath(lockPath), `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
        if (testHooks.failAfterOwnerMetadataWritten === true) {
          throw new Error("injected receipt lock owner sync failure");
        }
        await syncDirectory(lockPath);
        await syncDirectory(dirname(lockPath));
        return owner;
      } catch (error) {
        await rm(lockPath, { force: true, recursive: true });
        await syncDirectory(dirname(lockPath));
        throw new KppError("KPP_RECEIPT_LOCK_SETUP", "영수증 잠금 owner 메타데이터를 기록할 수 없습니다.", {
          path: lockPath,
          actual: error instanceof Error ? error.message : error,
        });
      }
    } catch (error) {
      if (!isFileExistsError(error)) {
        if (error instanceof KppError) {
          throw error;
        }
        throw new KppError("KPP_RECEIPT_LOCK_SETUP", "영수증 잠금을 생성할 수 없습니다.", {
          path: lockPath,
          actual: error instanceof Error ? error.message : error,
        });
      }

      if (await recoverStaleLock(lockPath)) {
        continue;
      }

      if (attempt === attempts - 1) {
        throw new KppError("KPP_RECEIPT_LOCK_TIMEOUT", "영수증 잠금을 획득하지 못했습니다.", {
          path: lockPath,
          rule: "receipt_lock_timeout",
        });
      }
      await setTimeout(retryMs);
    }
  }

  throw new KppError("KPP_RECEIPT_LOCK_TIMEOUT", "영수증 잠금을 획득하지 못했습니다.", {
    path: lockPath,
    rule: "receipt_lock_timeout",
  });
}

async function releaseLock(lockPath: string, owner: ReceiptLockOwner): Promise<void> {
  if (await ownerMatches(lockPath, owner)) {
    await rm(lockPath, { force: true, recursive: true });
    await syncDirectory(dirname(lockPath));
  }
}

async function recoverStaleLock(lockPath: string): Promise<boolean> {
  const owner = await readOwner(lockPath);
  if (owner === null || isProcessAlive(owner.pid)) {
    return false;
  }
  await rm(lockPath, { force: true, recursive: true });
  await syncDirectory(dirname(lockPath));
  return true;
}

async function ownerMatches(lockPath: string, expected: ReceiptLockOwner): Promise<boolean> {
  const actual = await readOwner(lockPath);
  return actual?.pid === expected.pid && actual.token === expected.token;
}

async function readOwner(lockPath: string): Promise<ReceiptLockOwner | null> {
  let raw: string;
  try {
    raw = await readFile(ownerPath(lockPath), "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReceiptLockOwner>;
    if (
      typeof parsed.pid !== "number"
      || !Number.isInteger(parsed.pid)
      || parsed.pid <= 0
      || typeof parsed.token !== "string"
      || parsed.token.length === 0
      || typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      token: parsed.token,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

function ownerPath(lockPath: string): string {
  return join(lockPath, LOCK_OWNER_FILE);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "ESRCH"
    );
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
