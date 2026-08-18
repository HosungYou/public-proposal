import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  KppError,
  advanceProject,
  sha256File,
  verifyProjectState,
  verifyResearchRequirement,
  verifyReceipt,
  writeReceipt,
} from "@longtable/kpp-core";
import { success, type CliEnvelope } from "../output.js";

export interface ApproveProjectOptions {
  readonly approvedBy: string;
  readonly auditPath: string;
  readonly approvedAt?: string;
}

export interface ApproveProjectResult {
  readonly state: "HUMAN_APPROVED";
  readonly approvalPath: string;
  readonly receiptPath: string;
}

interface ApprovalDecision {
  readonly schemaVersion: "1";
  readonly projectId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly humanBoundary: "HUMAN_APPROVED";
  readonly audit: FileHash;
  readonly build: readonly FileHash[];
  readonly rendered: readonly FileHash[];
}

interface FileHash { readonly path: string; readonly sha256: string; }

export async function approveCommand(
  rootInput: string,
  options: { readonly approvedBy?: string; readonly audit?: string },
): Promise<CliEnvelope> {
  if (options.approvedBy === undefined || options.audit === undefined) {
    throw new KppError("KPP_APPROVAL_INPUT_REQUIRED", "승인자와 PASS audit 경로가 필요합니다.", { stage: "AUDITED" });
  }
  return success("제출책임자의 명시적 승인을 기록했습니다.", await approveProject(rootInput, {
    approvedBy: options.approvedBy,
    auditPath: options.audit,
  }));
}

/** Record a named human decision; technical audit PASS alone cannot reach this state. */
export async function approveProject(rootInput: string, options: ApproveProjectOptions): Promise<ApproveProjectResult> {
  const root = await realpath(resolve(rootInput));
  await verifyResearchRequirement(root);
  const project = await verifyProjectState(root);
  if (project.state !== "AUDITED") {
    throw new KppError("KPP_APPROVAL_STATE", "AUDITED 상태에서만 사람이 제출을 승인할 수 있습니다.", {
      stage: project.state,
      expected: "AUDITED",
      actual: project.state,
    });
  }
  const approvedBy = options.approvedBy.trim();
  if (approvedBy.length === 0) {
    throw new KppError("KPP_APPROVAL_HUMAN_REQUIRED", "명시적인 사람 승인자 이름이 필요합니다.", { stage: "AUDITED" });
  }
  const auditPath = await regularFileWithin(root, options.auditPath, "KPP_APPROVAL_AUDIT_INVALID");
  const audit = await readJsonObject(auditPath, "KPP_APPROVAL_AUDIT_INVALID");
  if (audit.status !== "PASS" || audit.humanBoundary !== "TECHNICAL_GATE_ONLY") {
    throw new KppError("KPP_APPROVAL_AUDIT_NOT_PASS", "현재 audit PASS 결과가 없으므로 승인할 수 없습니다.", {
      path: auditPath,
      actual: { status: audit.status, humanBoundary: audit.humanBoundary },
      stage: "AUDITED",
    });
  }
  const auditReceiptPath = join(root, "receipts", "audit.json");
  const auditReceipt = await verifyReceipt(auditReceiptPath);
  const auditHash = await sha256File(auditPath);
  if (!auditReceipt.valid || auditReceipt.receipt.stage !== "AUDITED" || !await receiptBindsFile(auditReceipt.receipt.files, auditPath, auditHash)) {
    throw new KppError("KPP_APPROVAL_AUDIT_STALE", "audit 결과가 AUDITED receipt와 일치하지 않습니다.", { path: auditReceiptPath, stage: "AUDITED" });
  }
  const [buildReceipt, renderReceipt] = await Promise.all([
    verifyPassReceipt(join(root, "receipts", "build.json"), "BUILT"),
    verifyPassReceipt(join(root, "receipts", "render.json"), "RENDERED"),
  ]);
  const approvedAt = options.approvedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(approvedAt))) {
    throw new KppError("KPP_APPROVAL_TIMESTAMP", "승인 시각은 ISO-8601이어야 합니다.", { actual: approvedAt, stage: "AUDITED" });
  }
  const approvalPath = join(root, "audit", "approval-decision.json");
  const receiptPath = join(root, "receipts", "approval.json");
  if (await lstat(approvalPath).catch(() => undefined) !== undefined || await lstat(receiptPath).catch(() => undefined) !== undefined) {
    throw new KppError("KPP_APPROVAL_EXISTS", "기존 사람 승인 기록을 덮어쓸 수 없습니다.", { path: approvalPath, stage: "AUDITED" });
  }
  const decision: ApprovalDecision = {
    schemaVersion: "1",
    projectId: project.projectId,
    approvedBy,
    approvedAt: new Date(approvedAt).toISOString(),
    humanBoundary: "HUMAN_APPROVED",
    audit: { path: auditPath, sha256: auditHash },
    build: buildReceipt.receipt.files.map(toFileHash),
    rendered: renderReceipt.receipt.files.map(toFileHash),
  };
  try {
    await writeStableJson(approvalPath, decision);
    const approvalFiles = uniquePaths([
      approvalPath,
      auditPath,
      ...auditReceipt.receipt.files.map((file) => file.path),
      ...buildReceipt.receipt.files.map((file) => file.path),
      ...renderReceipt.receipt.files.map((file) => file.path),
    ]);
    await writeReceipt({
      stage: "HUMAN_APPROVED",
      files: approvalFiles,
      inputReceiptHashes: [await sha256File(auditReceiptPath)],
      output: receiptPath,
    });
    await advanceProject(root, "HUMAN_APPROVED");
    return { state: "HUMAN_APPROVED", approvalPath, receiptPath };
  } catch (error) {
    const current = await verifyProjectState(root).catch(() => undefined);
    if (current?.state !== "HUMAN_APPROVED") {
      await Promise.all([rm(approvalPath, { force: true }), rm(receiptPath, { force: true })]);
    }
    throw error;
  }
}

async function verifyPassReceipt(path: string, stage: string) {
  const result = await verifyReceipt(path);
  if (!result.valid || result.receipt.stage !== stage || result.receipt.result !== "PASS") {
    throw new KppError("KPP_APPROVAL_RECEIPT_STALE", "사람 승인에 필요한 선행 receipt가 유효하지 않습니다.", { path, stage: "AUDITED" });
  }
  return result;
}

function toFileHash(file: FileHash): FileHash { return { path: file.path, sha256: file.sha256 }; }

function uniquePaths(paths: readonly string[]): string[] { return [...new Set(paths)].sort(); }

async function receiptBindsFile(files: readonly FileHash[], path: string, sha256: string): Promise<boolean> {
  for (const file of files) {
    const canonical = await realpath(file.path).catch(() => undefined);
    if (canonical === path && file.sha256 === sha256) return true;
  }
  return false;
}

async function regularFileWithin(root: string, input: string, code: string): Promise<string> {
  const candidate = resolve(input);
  const metadata = await lstat(candidate).catch(() => undefined);
  const canonical = metadata?.isSymbolicLink() ? undefined : await realpath(candidate).catch(() => undefined);
  if (canonical === undefined || !isWithin(root, canonical)) {
    throw new KppError(code, "프로젝트 안의 일반 파일이 필요합니다.", { path: candidate, stage: "AUDITED" });
  }
  return canonical;
}

async function readJsonObject(path: string, code: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new KppError(code, "JSON audit 결과를 읽을 수 없습니다.", { path, actual: error instanceof Error ? error.message : error, stage: "AUDITED" });
  }
}

async function writeStableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let renamed = false;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${stableJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    renamed = true;
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (!renamed) await rm(temporary, { force: true });
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function isWithin(parent: string, child: string): boolean {
  const segment = relative(parent, child);
  return segment.length > 0 && segment !== ".." && !segment.startsWith(`..${sep}`) && !isAbsolute(segment);
}
