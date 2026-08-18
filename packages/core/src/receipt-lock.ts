import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { basename, dirname, join } from "node:path";
import { KppError } from "./errors.js";

const LOCK_ATTEMPTS = 200;
const LOCK_RETRY_MS = 5;
const LOCK_ORPHAN_GRACE_MS = 30_000;
const LEGACY_OWNER_FILE = "owner.json";
const RECOVERY_CLAIM_SUFFIX = ".recovery-claim";

interface ReceiptLockOwner { readonly pid: number; readonly token: string; readonly createdAt: string }
interface ReceiptLockTestHooks {
  readonly beforeLockPublished?: () => Promise<void>;
  readonly failAfterLockDirectoryCreated?: boolean;
  readonly failAfterOwnerMetadataWritten?: boolean;
  readonly lockAttempts?: number;
  readonly lockRetryMs?: number;
  readonly orphanGraceMs?: number;
  readonly afterRecoverableLockObserved?: (lockPath: string) => Promise<void>;
  readonly afterStaleLockQuarantined?: (lockPath: string, quarantinePath: string) => Promise<void>;
}
interface LockState {
  readonly owner: ReceiptLockOwner | null;
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs: number;
}

let testHooks: ReceiptLockTestHooks = {};
export function __setReceiptLockTestHooks(hooks: ReceiptLockTestHooks): void { testHooks = hooks; }

export async function withReceiptPathLock<T>(receiptPath: string, operation: () => Promise<T>): Promise<T> {
  const directory = dirname(receiptPath);
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, `.${basename(receiptPath)}.lock`);
  const owner = await acquireLock(lockPath);
  try { return await operation(); } finally { await releaseOwnedToken(lockPath, owner); }
}

async function acquireLock(lockPath: string): Promise<ReceiptLockOwner> {
  const attempts = testHooks.lockAttempts ?? LOCK_ATTEMPTS;
  const retryMs = testHooks.lockRetryMs ?? LOCK_RETRY_MS;
  const owner = createOwner();
  await testHooks.beforeLockPublished?.();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const claimPath = recoveryClaimPath(lockPath);
    await recoverStaleRecoveryClaim(claimPath);
    if (await pathExists(claimPath)) {
      if (attempt === attempts - 1) throw timeoutError(lockPath);
      await setTimeout(retryMs);
      continue;
    }
    try {
      // A complete ownership record becomes visible in one atomic filesystem operation.
      await publishToken(lockPath, owner);
      if (testHooks.failAfterLockDirectoryCreated === true || testHooks.failAfterOwnerMetadataWritten === true) {
        await releaseOwnedToken(lockPath, owner);
        throw new KppError("KPP_RECEIPT_LOCK_SETUP", "영수증 잠금 owner 메타데이터를 기록할 수 없습니다.", { path: lockPath });
      }
      await syncDirectory(dirname(lockPath));
      return owner;
    } catch (error) {
      if (!isCode(error, "EEXIST")) {
        if (error instanceof KppError) throw error;
        throw new KppError("KPP_RECEIPT_LOCK_SETUP", "영수증 잠금을 생성할 수 없습니다.", { path: lockPath, actual: error instanceof Error ? error.message : error });
      }
      if (await recoverStaleLock(lockPath)) continue;
      if (attempt === attempts - 1) throw timeoutError(lockPath);
      await setTimeout(retryMs);
    }
  }
  throw timeoutError(lockPath);
}

async function releaseOwnedToken(path: string, owner: ReceiptLockOwner): Promise<void> {
  try {
    if (await readFile(path, "utf8") !== serializeOwner(owner)) return;
    await rm(path, { force: true });
    await syncDirectory(dirname(path));
  } catch (error) {
    if (!isCode(error, "ENOENT") && !isCode(error, "EISDIR")) throw error;
  }
}

async function recoverStaleLock(lockPath: string): Promise<boolean> {
  const observed = await readLockState(lockPath);
  if (observed === null || !isRecoverable(observed)) return false;
  await testHooks.afterRecoverableLockObserved?.(lockPath);
  return claimAndQuarantine(lockPath, observed);
}

async function claimAndQuarantine(lockPath: string, observed: LockState): Promise<boolean> {
  const claimPath = recoveryClaimPath(lockPath);
  const claim = createOwner();
  try {
    await publishToken(claimPath, claim);
    await syncDirectory(dirname(lockPath));
  } catch (error) {
    if (isCode(error, "EEXIST")) { await recoverStaleRecoveryClaim(claimPath); return false; }
    if (isCode(error, "ENOENT")) return true;
    throw new KppError("KPP_RECEIPT_LOCK_SETUP", "영수증 잠금 복구 claim을 생성할 수 없습니다.", { path: lockPath });
  }
  let quarantinePath: string | null = null;
  try {
    const current = await readLockState(lockPath);
    if (current === null || !sameObject(observed, current) || !isRecoverable(current)) return false;
    quarantinePath = join(dirname(lockPath), `.${basename(lockPath)}.recovered-${process.pid}-${randomUUID()}`);
    try { await rename(lockPath, quarantinePath); } catch (error) {
      if (isCode(error, "ENOENT")) return true;
      throw new KppError("KPP_RECEIPT_LOCK_SETUP", "영수증 잠금 복구 quarantine을 생성할 수 없습니다.", { path: lockPath });
    }
    await syncDirectory(dirname(lockPath));
    await testHooks.afterStaleLockQuarantined?.(lockPath, quarantinePath);
    return true;
  } finally {
    if (quarantinePath !== null) await rm(quarantinePath, { force: true, recursive: true });
    await releaseOwnedToken(claimPath, claim);
  }
}

async function recoverStaleRecoveryClaim(claimPath: string): Promise<void> {
  const state = await readLockState(claimPath);
  if (state === null || !isRecoverable(state)) return;
  const quarantinePath = `${claimPath}.recovered-${process.pid}-${randomUUID()}`;
  try { await rename(claimPath, quarantinePath); } catch (error) { if (isCode(error, "ENOENT")) return; throw error; }
  await rm(quarantinePath, { force: true, recursive: true });
  await syncDirectory(dirname(claimPath));
}

async function readLockState(path: string): Promise<LockState | null> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try { metadata = await lstat(path); } catch { return null; }
  let raw: string | null = null;
  if (metadata.isDirectory()) {
    try { raw = await readFile(join(path, LEGACY_OWNER_FILE), "utf8"); } catch { raw = null; }
  } else {
    try { raw = await readFile(path, "utf8"); } catch { raw = null; }
  }
  return { owner: raw === null ? null : parseOwner(raw), dev: metadata.dev, ino: metadata.ino, mtimeMs: metadata.mtimeMs };
}

function isRecoverable(state: LockState): boolean {
  if (state.owner !== null) return !isProcessAlive(state.owner.pid);
  return Date.now() - state.mtimeMs >= (testHooks.orphanGraceMs ?? LOCK_ORPHAN_GRACE_MS);
}
function sameObject(left: LockState, right: LockState): boolean { return left.dev === right.dev && left.ino === right.ino; }
function createOwner(): ReceiptLockOwner { return { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() }; }
function serializeOwner(owner: ReceiptLockOwner): string { return JSON.stringify(owner); }
function parseOwner(raw: string): ReceiptLockOwner | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ReceiptLockOwner>;
    if (!Number.isInteger(parsed.pid) || (parsed.pid ?? 0) <= 0 || typeof parsed.token !== "string" || parsed.token.length === 0 || typeof parsed.createdAt !== "string") return null;
    return { pid: parsed.pid as number, token: parsed.token, createdAt: parsed.createdAt };
  } catch { return null; }
}
function recoveryClaimPath(lockPath: string): string { return `${lockPath}${RECOVERY_CLAIM_SUFFIX}`; }
async function publishToken(path: string, owner: ReceiptLockOwner): Promise<void> {
  const temporaryPath = `${path}.publish-${process.pid}-${owner.token}`;
  try {
    await writeFile(temporaryPath, serializeOwner(owner), { flag: "wx", mode: 0o600 });
    const handle = await open(temporaryPath, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    await link(temporaryPath, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
async function pathExists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch { return false; } }
function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return !isCode(error, "ESRCH"); }
}
function timeoutError(path: string): KppError { return new KppError("KPP_RECEIPT_LOCK_TIMEOUT", "영수증 잠금을 획득하지 못했습니다.", { path, rule: "receipt_lock_timeout" }); }
function isCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code; }
async function syncDirectory(directory: string): Promise<void> { const handle = await open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); } }
