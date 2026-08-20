import { randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  KppError,
  advanceProject,
  getDocumentModePolicy,
  readProject,
  sha256File,
  verifyReceipt,
  verifyResearchRequirement,
  writeReceipt,
} from "@longtable/kpp-core";
import { validateCompositeAuditReceiptForRelease, type AuditReceiptIdentity } from "@longtable/kpp-audits";
import { success, type CliEnvelope } from "../output.js";

export interface ReleaseProjectOptions {
  readonly approvalPath: string;
  readonly outputParent: string;
}

export interface ReleaseProjectResult {
  readonly state: "RELEASED";
  readonly releasePath: string;
  readonly manifestPath: string;
  readonly receiptPath: string;
}

interface ReleaseFile {
  readonly releasePath: string;
  readonly sha256: string;
  readonly bytes: number;
}

export async function releaseCommand(
  rootInput: string,
  options: { readonly approval?: string; readonly output?: string },
): Promise<CliEnvelope> {
  if (options.approval === undefined || options.output === undefined) {
    throw new KppError("KPP_RELEASE_INPUT_REQUIRED", "approval receipt와 release 출력 상위 경로가 필요합니다.", { stage: "HUMAN_APPROVED" });
  }
  return success("검증된 제출 패키지를 immutable release로 만들었습니다.", await releaseProject(rootInput, {
    approvalPath: options.approval,
    outputParent: options.output,
  }));
}

/** Publish an allowlisted snapshot only after the named-human receipt is still byte-current. */
export async function releaseProject(rootInput: string, options: ReleaseProjectOptions): Promise<ReleaseProjectResult> {
  const root = await realpath(resolve(rootInput));
  await verifyResearchRequirement(root);
  // Do not call verifyProjectState here: a stale approval must not roll back the
  // project state as a side effect of a release attempt.
  const project = await readProject(root);
  if (project.schemaVersion !== "2.0.0") {
    throw new KppError("KPP_MIGRATION_REQUIRED", "release 전에 프로젝트를 명시적으로 2.0.0으로 마이그레이션해야 합니다.", {
      stage: project.state,
      actual: project.schemaVersion,
    });
  }
  if (project.state !== "HUMAN_APPROVED") {
    throw new KppError("KPP_RELEASE_STATE", "HUMAN_APPROVED 상태에서만 release를 만들 수 있습니다.", {
      stage: project.state,
      expected: "HUMAN_APPROVED",
      actual: project.state,
    });
  }
  const approvalPath = await regularFileWithin(root, options.approvalPath, "KPP_RELEASE_APPROVAL_INVALID");
  const expectedApprovalPath = join(root, "receipts", "approval.json");
  if (approvalPath !== expectedApprovalPath) {
    throw new KppError("KPP_RELEASE_APPROVAL_INVALID", "현재 HUMAN_APPROVED receipt만 release 입력으로 사용할 수 있습니다.", {
      expected: expectedApprovalPath,
      actual: approvalPath,
      stage: "HUMAN_APPROVED",
    });
  }
  const chain = await verifyCurrentChain(root);
  if (!chain.valid) {
    throw new KppError("KPP_RELEASE_APPROVAL_STALE", "승인 이후 제출 아티팩트가 변경되었거나 receipt chain이 stale입니다.", {
      actual: chain.reason,
      stage: "HUMAN_APPROVED",
    });
  }
  const approvalDecisionPath = join(root, "audit", "approval-decision.json");
  const decision = await readApprovalDecision(approvalDecisionPath);
  const auditPath = join(root, "audit", "audit.json");
  if (decision.humanBoundary !== "HUMAN_APPROVED" || decision.projectId !== project.projectId || decision.audit.sha256 !== await sha256File(auditPath)) {
    throw new KppError("KPP_RELEASE_APPROVAL_STALE", "approval decision이 현재 audit/project와 연결되지 않습니다.", { path: approvalDecisionPath, stage: "HUMAN_APPROVED" });
  }
  await verifyReleaseAuditReceipt(root, auditPath, {
    projectId: project.projectId,
    documentMode: project.documentMode,
    modePolicyVersion: project.modePolicyVersion,
  });
  const outputParent = await prepareOutputParent(options.outputParent);
  const releaseId = `${project.projectId}-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID().slice(0, 8)}`;
  const releasePath = join(outputParent, releaseId);
  const staging = join(outputParent, `.staging-${releaseId}`);
  const receiptPath = join(root, "receipts", "release.json");
  if (await lstat(receiptPath).catch(() => undefined) !== undefined || await lstat(releasePath).catch(() => undefined) !== undefined) {
    throw new KppError("KPP_RELEASE_EXISTS", "기존 release를 덮어쓸 수 없습니다.", { path: releasePath, stage: "HUMAN_APPROVED" });
  }
  let published = false;
  try {
    await mkdir(staging, { mode: 0o700 });
    const files = await copyAllowlistedArtifacts(root, staging, chain.files, project.documentMode);
    const manifestPath = join(staging, "release.json");
    await writeSyncedJson(manifestPath, {
      schemaVersion: "1",
      releaseId,
      projectId: project.projectId,
      humanBoundary: "HUMAN_APPROVED",
      approvalReceiptSha256: await sha256File(approvalPath),
      predecessorReceiptHashes: chain.receiptHashes,
      files,
    });
    await freezeTree(staging);
    await syncDirectory(staging);
    await rename(staging, releasePath);
    published = true;
    await syncDirectory(outputParent);
    const releaseManifest = join(releasePath, "release.json");
    await writeReceipt({
      stage: "RELEASED",
      files: [releaseManifest, ...files.map((file) => join(releasePath, file.releasePath))],
      inputReceiptHashes: [await sha256File(approvalPath)],
      output: receiptPath,
    });
    await advanceProject(root, "RELEASED");
    return { state: "RELEASED", releasePath, manifestPath: releaseManifest, receiptPath };
  } catch (error) {
    const state = await readProject(root).catch(() => undefined);
    if (state?.state !== "RELEASED") {
      await rm(staging, { force: true, recursive: true });
      if (published) {
        await makeWritableTree(releasePath);
        await rm(releasePath, { force: true, recursive: true });
      }
      await rm(receiptPath, { force: true });
    }
    throw error;
  }
}

/** Fail closed when a release is backed only by a free-form or stale PASS assertion. */
export async function verifyReleaseAuditReceipt(
  root: string,
  auditPath: string,
  identity: AuditReceiptIdentity,
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(auditPath, "utf8"));
  } catch (error) {
    throw new KppError("KPP_RELEASE_AUDIT_INVALID", "구조화 audit receipt를 읽을 수 없습니다.", {
      path: auditPath,
      actual: error instanceof Error ? error.message : error,
      stage: "HUMAN_APPROVED",
    });
  }
  const validation = await validateCompositeAuditReceiptForRelease(root, value, identity);
  if (validation.status !== "PASS") {
    throw new KppError("KPP_RELEASE_AUDIT_INVALID", "현재 mode와 artifact bytes에 결속된 PASS audit receipt가 필요합니다.", {
      path: auditPath,
      actual: validation.findings,
      stage: "HUMAN_APPROVED",
    });
  }
}

async function verifyCurrentChain(root: string): Promise<{ readonly valid: boolean; readonly reason?: unknown; readonly files: readonly string[]; readonly receiptHashes: readonly string[] }> {
  const filenames = ["source-lock.json", "requirements-lock.json", "evidence-lock.json", "design-lock.json", "content-approval.json", "build.json", "render.json", "audit.json", "approval.json"];
  let predecessor: string | undefined;
  const files = new Set<string>();
  const hashes: string[] = [];
  for (const filename of filenames) {
    const path = join(root, "receipts", filename);
    const verification = await verifyReceipt(path).catch((error) => ({ error }));
    if ("error" in verification || !verification.valid || verification.receipt.result !== "PASS") {
      return { valid: false, reason: "error" in verification ? verification.error : verification.mismatches, files: [], receiptHashes: [] };
    }
    const hash = await sha256File(path);
    if (predecessor !== undefined && !verification.receipt.inputReceiptHashes.includes(predecessor)) {
      return { valid: false, reason: { path, expected: predecessor, actual: verification.receipt.inputReceiptHashes }, files: [], receiptHashes: [] };
    }
    predecessor = hash;
    hashes.push(hash);
    const submissionStage = filename === "build.json" || filename === "render.json" || filename === "audit.json";
    for (const file of verification.receipt.files) {
      const canonical = await realpath(file.path).catch(() => undefined);
      if (canonical === undefined) {
        return { valid: false, reason: { path: file.path, error: "missing" }, files: [], receiptHashes: [] };
      }
      if (submissionStage) files.add(canonical);
    }
  }
  return { valid: true, files: [...files].sort(), receiptHashes: hashes };
}

async function copyAllowlistedArtifacts(
  root: string,
  staging: string,
  inputs: readonly string[],
  documentMode: Parameters<typeof getDocumentModePolicy>[0],
): Promise<ReleaseFile[]> {
  const policy = getDocumentModePolicy(documentMode);
  const permittedClasses = new Set([
    "submission_docx", "build_manifest", "render_manifest", "submission_pdf", "page_image",
    "composite_audit", "render_observation", "page_architecture", "reference_manifest",
    ...policy.artifactAllowlist,
  ]);
  const permitted = inputs.filter((path) => {
    const artifactClass = releaseArtifactClass(root, path);
    return artifactClass !== undefined && permittedClasses.has(artifactClass);
  });
  if (permitted.length === 0) {
    throw new KppError("KPP_RELEASE_ALLOWLIST_EMPTY", "release 가능한 submission artifact가 없습니다.", { stage: "HUMAN_APPROVED" });
  }
  const copied: ReleaseFile[] = [];
  for (const input of permitted) {
    const source = await regularFileWithin(root, input, "KPP_RELEASE_APPROVAL_STALE");
    const releasePath = releaseRelativePath(root, source);
    const destination = join(staging, releasePath);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination, 0);
    const [sourceHash, destinationHash, metadata] = await Promise.all([sha256File(source), sha256File(destination), stat(destination)]);
    if (sourceHash !== destinationHash || metadata.size < 1) {
      throw new KppError("KPP_RELEASE_COPY_INVALID", "release artifact copy의 hash를 검증할 수 없습니다.", { path: source, stage: "HUMAN_APPROVED" });
    }
    await syncFile(destination);
    copied.push({ releasePath, sha256: destinationHash, bytes: metadata.size });
  }
  return copied.sort((left, right) => left.releasePath.localeCompare(right.releasePath));
}

function releaseArtifactClass(root: string, path: string): string | undefined {
  const canonical = resolve(path);
  if (!isWithin(root, canonical)) return undefined;
  const local = relative(root, canonical);
  if (/^(?:build\/)?\.kpp-build-[a-f0-9]{16}\/generations\/[^/]+\/document\.docx$/u.test(local)) return "submission_docx";
  if (/^(?:build\/)?\.kpp-build-[a-f0-9]{16}\/generations\/[^/]+\/manifest\.json$/u.test(local)) return "build_manifest";
  if (/^rendered\/generations\/[^/]+\/render\.json$/u.test(local)) return "render_manifest";
  if (/^rendered\/generations\/[^/]+\/proposal\.pdf$/u.test(local)) return "submission_pdf";
  if (/^rendered\/generations\/[^/]+\/page-\d{4}\.png$/u.test(local)) return "page_image";
  if (local === "audit/audit.json") return "composite_audit";
  if (local === "audit/docx-geometry.json") return "render_observation";
  if (local === "content/page-architecture.json") return "page_architecture";
  if (local === "evidence/reference-manifest.json") return "reference_manifest";
  return undefined;
}

function releaseRelativePath(root: string, source: string): string {
  const local = relative(root, source);
  if (local.endsWith("/document.docx")) return "submission/document.docx";
  if (local.endsWith("/manifest.json")) return "submission/build-manifest.json";
  if (local.endsWith("/render.json")) return "submission/render-manifest.json";
  if (local.endsWith("/proposal.pdf")) return "submission/proposal.pdf";
  if (/\/page-\d{4}\.png$/u.test(local)) return `submission/pages/${basename(local)}`;
  if (local === "content/page-architecture.json") return "audit/page-architecture.json";
  if (local === "evidence/reference-manifest.json") return "audit/reference-manifest.json";
  return local;
}

async function prepareOutputParent(input: string): Promise<string> {
  const path = resolve(input);
  let ancestor = path;
  while (true) {
    const metadata = await lstat(ancestor).catch(() => undefined);
    if (metadata?.isSymbolicLink()) {
      throw new KppError("KPP_RELEASE_OUTPUT_SYMLINK", "release output parent의 미해결 경로에 symlink ancestor는 허용되지 않습니다.", {
        path: ancestor,
        actual: path,
        stage: "HUMAN_APPROVED",
      });
    }
    if (metadata !== undefined) break;
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new KppError("KPP_RELEASE_OUTPUT_INVALID", "release output parent가 디렉터리가 아닙니다.", { path, stage: "HUMAN_APPROVED" });
  return canonical;
}

async function readApprovalDecision(path: string): Promise<{ readonly projectId: string; readonly humanBoundary: string; readonly audit: { readonly sha256: string } }> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    const record = value as Record<string, unknown>;
    const audit = record.audit;
    if (typeof record.projectId !== "string" || typeof record.humanBoundary !== "string" || audit === null || typeof audit !== "object" || Array.isArray(audit) || typeof (audit as Record<string, unknown>).sha256 !== "string") throw new Error("missing approval fields");
    return { projectId: record.projectId, humanBoundary: record.humanBoundary, audit: { sha256: (audit as Record<string, string>).sha256 } };
  } catch (error) {
    throw new KppError("KPP_RELEASE_APPROVAL_STALE", "approval decision을 검증할 수 없습니다.", { path, actual: error instanceof Error ? error.message : error, stage: "HUMAN_APPROVED" });
  }
}

async function regularFileWithin(root: string, input: string, code: string): Promise<string> {
  const candidate = resolve(input);
  const metadata = await lstat(candidate).catch(() => undefined);
  const canonical = metadata?.isSymbolicLink() ? undefined : await realpath(candidate).catch(() => undefined);
  if (canonical === undefined || !isWithin(root, canonical) || !(await stat(canonical)).isFile()) {
    throw new KppError(code, "프로젝트 안의 regular artifact가 필요합니다.", { path: candidate, stage: "HUMAN_APPROVED" });
  }
  return canonical;
}

async function writeSyncedJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${stableJson(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await syncFile(path);
}

async function freezeTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) { await freezeTree(path); await chmod(path, 0o500); }
    else if (entry.isFile()) await chmod(path, 0o400);
    else throw new KppError("KPP_RELEASE_COPY_INVALID", "release staging에 허용되지 않은 항목이 있습니다.", { path, stage: "HUMAN_APPROVED" });
  }
}

async function makeWritableTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeWritableTree(path);
    await chmod(path, entry.isDirectory() ? 0o700 : 0o600).catch(() => undefined);
  }
  await chmod(root, 0o700).catch(() => undefined);
}

async function syncFile(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
async function syncDirectory(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }

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
