import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { basename, dirname, join } from "node:path";
import { KppError } from "./errors.js";

const LOCK_ATTEMPTS = 200;
const LOCK_RETRY_MS = 5;
const LOCK_ORPHAN_GRACE_MS = 30_000;
const LOCK_OWNER_FILE = "owner.json";
const RECOVERY_CLAIM_FILE = ".recovery-claim.json";

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
  readonly orphanGraceMs?: number;
  readonly afterRecoverableLockObserved?: (lockPath: string) => Promise<void>;
  readonly afterStaleLockQuarantined?: (lockPath: string, quarantinePath: string) => Promise<void>;
}

type ReceiptLockState =
  | { readonly kind: "valid"; readonly owner: ReceiptLockOwner; readonly dev: number; readonly ino: number; readonly mtimeMs: number }
  | { readonly kind: "missingOwner"; readonly dev: number; readonly ino: number; readonly mtimeMs: number }
  | { readonly kind: "malformedOwner"; readonly dev: number; readonly ino: number; readonly mtimeMs: number };

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
  const state = await readLockState(lockPath);
  if (state === null || !isRecoverableLockState(state)) {
    return false;
  }
  await testHooks.afterRecoverableLockObserved?.(lockPath);
  return claimAndQuarantineRecoverableLock(lockPath, state);
}

async function ownerMatches(lockPath: string, expected: ReceiptLockOwner): Promise<boolean> {
  const actual = await readOwnerFile(ownerPath(lockPath));
  return actual?.pid === expected.pid && actual.token === expected.token;
}

async function claimAndQuarantineRecoverableLock(
  lockPath: string,
  observedState: ReceiptLockState,
): Promise<boolean> {
  const claimPath = join(lockPath, RECOVERY_CLAIM_FILE);
  const claim = createOwner();
  let quarantinePath: string | null = null;

  try {
    await writeFile(claimPath, `${JSON.stringify(claim)}\n`, { flag: "wx", mode: 0o600 });
    await syncDirectory(lockPath);
  } catch (error) {
    if (isFileExistsError(error)) {
      await recoverStaleRecoveryClaim(claimPath);
      return false;
    }
    if (isNotFoundError(error)) {
      return true;
    }
    throw new KppError("KPP_RECEIPT_LOCK_SETUP", "영수증 잠금 복구 claim을 생성할 수 없습니다.", {
      path: lockPath,
      actual: error instanceof Error ? error.message : error,
    });
  }

  try {
    const state = await readLockState(lockPath);
    if (
      state === null
      || !sameLockDirectory(observedState, state)
      || !isRecoverableLockStateAfterClaim(state)
    ) {
      return false;
    }

    quarantinePath = join(dirname(lockPath), `.${basename(lockPath)}.recovered-${process.pid}-${randomUUID()}`);
    try {
      await rename(lockPath, quarantinePath);
      await syncDirectory(dirname(lockPath));
    } catch (error) {
      if (isNotFoundError(error)) {
        return true;
      }
      throw new KppError("KPP_RECEIPT_LOCK_SETUP", "영수증 잠금 복구 quarantine을 생성할 수 없습니다.", {
        path: lockPath,
        actual: error instanceof Error ? error.message : error,
      });
    }

    await testHooks.afterStaleLockQuarantined?.(lockPath, quarantinePath);
    return true;
  } finally {
    if (quarantinePath === null) {
      await rm(claimPath, { force: true });
      await syncDirectory(lockPath).catch(() => undefined);
    } else {
      await rm(quarantinePath, { force: true, recursive: true });
      await syncDirectory(dirname(lockPath));
    }
  }
}

async function recoverStaleRecoveryClaim(claimPath: string): Promise<void> {
  const claim = await readOwnerFile(claimPath);
  if (claim !== null && !isProcessAlive(claim.pid)) {
    await rm(claimPath, { force: true });
    await syncDirectory(dirname(claimPath)).catch(() => undefined);
  }
}

async function readLockState(lockPath: string): Promise<ReceiptLockState | null> {
  let lockStat: { readonly dev: number; readonly ino: number; readonly mtimeMs: number };
  try {
    lockStat = await stat(lockPath);
  } catch {
    return null;
  }

  const raw = await readTextFile(ownerPath(lockPath));
  if (raw === null) {
    return {
      kind: "missingOwner",
      dev: lockStat.dev,
      ino: lockStat.ino,
      mtimeMs: lockStat.mtimeMs,
    };
  }

  const owner = parseOwner(raw);
  if (owner === null) {
    return {
      kind: "malformedOwner",
      dev: lockStat.dev,
      ino: lockStat.ino,
      mtimeMs: lockStat.mtimeMs,
    };
  }

  return {
    kind: "valid",
    owner,
    dev: lockStat.dev,
    ino: lockStat.ino,
    mtimeMs: lockStat.mtimeMs,
  };
}

async function readOwnerFile(path: string): Promise<ReceiptLockOwner | null> {
  const raw = await readTextFile(path);
  if (raw === null) {
    return null;
  }
  return parseOwner(raw);
}

async function readTextFile(path: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return raw;
}

function parseOwner(raw: string): ReceiptLockOwner | null {
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

function createOwner(): ReceiptLockOwner {
  return {
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

function isRecoverableLockState(state: ReceiptLockState): boolean {
  if (state.kind === "valid") {
    return !isProcessAlive(state.owner.pid);
  }
  return Date.now() - state.mtimeMs >= (testHooks.orphanGraceMs ?? LOCK_ORPHAN_GRACE_MS);
}

function isRecoverableLockStateAfterClaim(state: ReceiptLockState): boolean {
  return state.kind !== "valid" || !isProcessAlive(state.owner.pid);
}

function sameLockDirectory(left: ReceiptLockState, right: ReceiptLockState): boolean {
  return left.dev === right.dev && left.ino === right.ino;
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

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
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
