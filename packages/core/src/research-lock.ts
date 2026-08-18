import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import {
  ReceiptSchema,
  ResearchLockSchema,
  type ProposalClass,
  type Receipt,
  type ResearchLock,
} from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";
import { readProject } from "./project-store.js";
import { verifyReceipt } from "./receipts.js";

const DEFAULT_SCHEMA_VERSION = "1.0.0";
const DEFAULT_TOOL_VERSION = "0.1.0";

const REQUIRED_RESEARCH_CLASSES = new Set<ProposalClass>([
  "academic_research",
  "research_service",
  "policy_research",
]);

const ARTIFACT_BINDINGS = [
  {
    pathKey: "researchSpecificationPath",
    hashKey: "researchSpecificationSha256",
  },
  {
    pathKey: "citationSlotMatrixPath",
    hashKey: "citationSlotMatrixSha256",
  },
  {
    pathKey: "sourceLedgerPath",
    hashKey: "sourceLedgerSha256",
  },
  {
    pathKey: "claimTransferLedgerPath",
    hashKey: "claimTransferLedgerSha256",
  },
] as const;

export interface ResearchLockImportResult {
  readonly receiptPath: string;
  readonly state: "PASS";
}

interface ResearchLockTestHooks {
  readonly afterArtifactsVerified?: () => Promise<void>;
  readonly beforeReceiptCreate?: () => Promise<void>;
  readonly afterReceiptCreate?: (receiptPath: string) => Promise<void>;
  readonly beforePostWriteCleanup?: (receiptPath: string) => Promise<void>;
}

interface VerifiedResearchArtifact {
  readonly path: string;
  readonly realPath: string;
  readonly sha256: string;
}

interface CreatedResearchReceipt {
  readonly contents: string;
}

let testHooks: ResearchLockTestHooks = {};

export function __setResearchLockTestHooks(hooks: ResearchLockTestHooks): void {
  testHooks = hooks;
}

export async function importResearchLock(
  rootInput: string,
  handoffPathInput: string,
  expectedLongtableVersion: string,
): Promise<ResearchLockImportResult> {
  const root = resolve(rootInput);
  const handoffPath = resolve(handoffPathInput);
  const project = await readProject(root);
  const handoff = await readResearchLockHandoff(handoffPath);

  validateIdentity(project.projectId, project.proposalClass, handoff, expectedLongtableVersion);
  const artifacts = await resolveArtifacts(root, handoff);
  validateDistinctArtifacts(artifacts);
  const receiptPath = join(root, "receipts", "research-lock.json");
  const files = [handoffPath, ...artifacts.map((artifact) => artifact.path)];
  const inputReceiptHashes = artifacts.map((artifact) => artifact.sha256);

  const existing = await readExistingReceiptState(receiptPath);
  if (existing.state === "valid") {
    if (!receiptMatches(existing.receipt, files, inputReceiptHashes)) {
      throw new KppError("PP_RESEARCH_LOCK_EXISTS", "이미 다른 연구 잠금 영수증이 있습니다.", {
        path: receiptPath,
        rule: "valid_research_receipt_exists",
      });
    }
    return { receiptPath, state: "PASS" };
  }
  if (existing.state === "invalid") {
    throw new KppError("PP_RESEARCH_LOCK_INVALID", "기존 연구 잠금 영수증이 유효하지 않아 자동으로 덮어쓸 수 없습니다.", {
      path: receiptPath,
      rule: existing.rule,
    });
  }

  await verifyArtifactHashes(artifacts);
  await testHooks.afterArtifactsVerified?.();
  await testHooks.beforeReceiptCreate?.();
  let createdReceipt: CreatedResearchReceipt;
  try {
    createdReceipt = await createResearchReceiptExclusive({
      files,
      inputReceiptHashes,
      output: receiptPath,
    });
  } catch (error) {
    if (error instanceof KppError && error.code === "PP_RESEARCH_LOCK_EXISTS") {
      return await resolveConcurrentReceipt(receiptPath, files, inputReceiptHashes);
    }
    throw error;
  }
  await testHooks.afterReceiptCreate?.(receiptPath);
  await verifyEmittedReceipt(receiptPath, files, inputReceiptHashes, createdReceipt.contents);
  return { receiptPath, state: "PASS" };
}

async function readResearchLockHandoff(path: string): Promise<ResearchLock> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new KppError("PP_RESEARCH_HANDOFF_INVALID", "LongTable 연구 handoff를 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new KppError("PP_RESEARCH_HANDOFF_INVALID", "LongTable 연구 handoff가 올바른 JSON이 아닙니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }

  const parsed = ResearchLockSchema.safeParse(parsedJson);
  if (parsed.success) {
    return parsed.data;
  }
  throw new KppError("PP_RESEARCH_HANDOFF_INVALID", "LongTable 연구 handoff 형식이 올바르지 않습니다.", {
    path,
    rule: "handoff_schema",
    actual: parsed.error.issues,
  });
}

function validateIdentity(
  projectId: string,
  proposalClass: ProposalClass,
  handoff: ResearchLock,
  expectedLongtableVersion: string,
): void {
  if (handoff.longtableVersion !== expectedLongtableVersion) {
    throw new KppError("PP_LONGTABLE_VERSION_MISMATCH", "LongTable 버전이 고정 버전과 일치하지 않습니다.", {
      expected: expectedLongtableVersion,
      actual: handoff.longtableVersion,
    });
  }
  if (!REQUIRED_RESEARCH_CLASSES.has(proposalClass)) {
    throw new KppError("PP_LONGTABLE_REQUIRED", "이 제안서 유형은 연구 잠금 대상으로 분류되지 않았습니다.", {
      expected: [...REQUIRED_RESEARCH_CLASSES],
      actual: proposalClass,
    });
  }
  if (!REQUIRED_RESEARCH_CLASSES.has(handoff.proposalClass)) {
    throw new KppError("PP_LONGTABLE_REQUIRED", "LongTable handoff 제안서 유형은 연구 잠금 대상이어야 합니다.", {
      expected: [...REQUIRED_RESEARCH_CLASSES],
      actual: handoff.proposalClass,
    });
  }
  if (handoff.projectId !== projectId || handoff.proposalClass !== proposalClass) {
    throw new KppError("PP_RESEARCH_PROJECT_MISMATCH", "LongTable handoff가 현재 KPP 프로젝트와 일치하지 않습니다.", {
      expected: { projectId, proposalClass },
      actual: { projectId: handoff.projectId, proposalClass: handoff.proposalClass },
    });
  }
  if (handoff.openRequiredCheckpoints.length > 0) {
    throw new KppError("PP_RESEARCH_CHECKPOINT_OPEN", "미해결 필수 연구 checkpoint가 있습니다.", {
      rule: "required_checkpoint_open",
      actual: handoff.openRequiredCheckpoints,
    });
  }
}

async function resolveArtifacts(
  root: string,
  handoff: ResearchLock,
): Promise<readonly VerifiedResearchArtifact[]> {
  const researchRoot = join(root, "evidence", "research-lock");
  const rootReal = await stableRealpath(root, "project_root_realpath");
  const evidenceRootReal = await stableRealpath(join(root, "evidence"), "evidence_root_realpath");
  const researchRootReal = await stableRealpath(researchRoot, "research_root_realpath");
  if (!isSubpath(rootReal, evidenceRootReal) || !isSubpath(evidenceRootReal, researchRootReal)) {
    throw new KppError("PP_RESEARCH_ARTIFACT_PATH", "연구 산출물 디렉터리가 프로젝트 evidence 경계를 벗어납니다.", {
      path: researchRoot,
      rule: "research_root_escape",
    });
  }

  const artifacts = await Promise.all(ARTIFACT_BINDINGS.map(async (binding) => {
    const projectRelativePath = handoff[binding.pathKey];
    const expectedSha256 = handoff[binding.hashKey];
    const { path, realPath } = await resolveResearchArtifact(root, researchRootReal, projectRelativePath);
    let metadata;
    try {
      metadata = await stat(path);
    } catch (error) {
      throw new KppError("PP_RESEARCH_ARTIFACT_PATH", "연구 산출물 파일을 읽을 수 없습니다.", {
        path,
        rule: "artifact_unreadable",
        actual: error instanceof Error ? error.message : error,
      });
    }
    if (!metadata.isFile()) {
      throw new KppError("PP_RESEARCH_ARTIFACT_PATH", "연구 산출물 경로는 파일이어야 합니다.", {
        path,
        rule: "artifact_not_file",
      });
    }

    return { path, realPath, sha256: expectedSha256 };
  }));

  return artifacts;
}

function validateDistinctArtifacts(artifacts: readonly VerifiedResearchArtifact[]): void {
  const duplicatePath = firstDuplicate(artifacts.map((artifact) => artifact.path));
  if (duplicatePath !== null) {
    throw new KppError("PP_RESEARCH_ARTIFACT_DUPLICATE", "LongTable 연구 handoff의 네 산출물 경로는 서로 달라야 합니다.", {
      path: duplicatePath,
      rule: "artifact_path_duplicate",
    });
  }
  const duplicateRealPath = firstDuplicate(artifacts.map((artifact) => artifact.realPath));
  if (duplicateRealPath !== null) {
    throw new KppError("PP_RESEARCH_ARTIFACT_DUPLICATE", "LongTable 연구 handoff의 네 산출물 실제 파일은 서로 달라야 합니다.", {
      path: duplicateRealPath,
      rule: "artifact_realpath_duplicate",
    });
  }
}

async function verifyArtifactHashes(artifacts: readonly VerifiedResearchArtifact[]): Promise<void> {
  await Promise.all(artifacts.map(async (artifact) => {
    const actualSha256 = await sha256File(artifact.path);
    if (actualSha256 !== artifact.sha256) {
      throw new KppError("PP_RESEARCH_ARTIFACT_HASH", "연구 산출물 해시가 LongTable handoff와 일치하지 않습니다.", {
        path: artifact.path,
        expected: artifact.sha256,
        actual: actualSha256,
      });
    }
  }));
}

async function resolveResearchArtifact(
  root: string,
  researchRootReal: string,
  projectRelativePath: string,
): Promise<{ path: string; realPath: string }> {
  if (isAbsolute(projectRelativePath)) {
    throw artifactPathError(projectRelativePath, "artifact_path_absolute");
  }
  const normalized = normalize(projectRelativePath);
  if (
    normalized === "."
    || normalized.startsWith("..")
    || isAbsolute(normalized)
    || !normalized.startsWith("evidence/research-lock/")
  ) {
    throw artifactPathError(projectRelativePath, "artifact_path_outside_research_root");
  }

  const resolvedPath = resolve(root, normalized);
  const artifactReal = await stableRealpath(resolvedPath, "artifact_realpath_unreadable");
  if (!isSubpath(researchRootReal, artifactReal)) {
    throw artifactPathError(projectRelativePath, "artifact_symlink_escape");
  }
  return { path: resolvedPath, realPath: artifactReal };
}

async function stableRealpath(path: string, rule: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw new KppError("PP_RESEARCH_ARTIFACT_PATH", "연구 산출물 실제 경로를 확인할 수 없습니다.", {
      path,
      rule,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

function artifactPathError(path: string, rule: string): KppError {
  return new KppError("PP_RESEARCH_ARTIFACT_PATH", "LongTable 연구 산출물 경로가 KPP evidence/research-lock 경계를 벗어납니다.", {
    path,
    rule,
  });
}

type ExistingReceiptState =
  | { readonly state: "absent" }
  | { readonly state: "invalid"; readonly rule: string }
  | { readonly state: "valid"; readonly receipt: Receipt };

async function readExistingReceiptState(path: string): Promise<ExistingReceiptState> {
  try {
    const verification = await verifyReceipt(path);
    return verification.valid
      ? { state: "valid", receipt: verification.receipt }
      : { state: "invalid", rule: "receipt_file_mismatch" };
  } catch (error) {
    if (error instanceof KppError && error.code === "KPP_INPUT_RECEIPT_READ") {
      return await fileExists(path)
        ? { state: "invalid", rule: "receipt_unreadable" }
        : { state: "absent" };
    }
    if (error instanceof KppError && error.code === "KPP_INPUT_RECEIPT_INVALID") {
      return { state: "invalid", rule: "receipt_malformed" };
    }
    throw error;
  }
}

function receiptMatches(
  receipt: Receipt,
  files: readonly string[],
  inputReceiptHashes: readonly string[],
): boolean {
  return (
    receipt.stage === "EVIDENCE_LOCKED"
    &&
    receipt.result === "PASS"
    && sorted(receipt.files.map((file) => file.path)).join("\n") === sorted(files).join("\n")
    && sorted(receipt.inputReceiptHashes).join("\n") === sorted(inputReceiptHashes).join("\n")
  );
}

async function resolveConcurrentReceipt(
  receiptPath: string,
  files: readonly string[],
  inputReceiptHashes: readonly string[],
): Promise<ResearchLockImportResult> {
  const existing = await readExistingReceiptState(receiptPath);
  if (existing.state === "valid" && receiptMatches(existing.receipt, files, inputReceiptHashes)) {
    return { receiptPath, state: "PASS" };
  }
  if (existing.state === "invalid") {
    throw new KppError("PP_RESEARCH_LOCK_INVALID", "동시에 생성된 연구 잠금 영수증이 유효하지 않아 덮어쓸 수 없습니다.", {
      path: receiptPath,
      rule: existing.rule,
    });
  }
  throw new KppError("PP_RESEARCH_LOCK_EXISTS", "동시에 다른 연구 잠금 영수증이 생성되었습니다.", {
    path: receiptPath,
    rule: "receipt_create_conflict",
  });
}

async function createResearchReceiptExclusive(input: {
  readonly files: readonly string[];
  readonly inputReceiptHashes: readonly string[];
  readonly output: string;
}): Promise<CreatedResearchReceipt> {
  const files = await Promise.all(
    input.files.map(async (path) => ({ path, sha256: await sha256File(path) })),
  );
  const parsed = ReceiptSchema.safeParse({
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    stage: "EVIDENCE_LOCKED",
    createdAt: new Date().toISOString(),
    toolVersion: DEFAULT_TOOL_VERSION,
    files: files.sort(compareFileRecords),
    inputReceiptHashes: [...input.inputReceiptHashes].sort(),
    result: "PASS",
  });
  if (!parsed.success) {
    throw new KppError("PP_RESEARCH_LOCK_WRITE_MISMATCH", "연구 잠금 영수증 형식이 올바르지 않습니다.", {
      path: input.output,
      rule: "generated_receipt_invalid",
      actual: parsed.error.issues,
    });
  }

  const contents = `${JSON.stringify(parsed.data, null, 2)}\n`;
  await writeCreateOnly(input.output, contents);
  return { contents };
}

async function writeCreateOnly(path: string, contents: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let created = false;
  let linked = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(temporaryPath, path);
      linked = true;
    } catch (error) {
      if (isFileExistsError(error)) {
        throw new KppError("PP_RESEARCH_LOCK_EXISTS", "연구 잠금 영수증 경로가 이미 존재합니다.", {
          path,
          rule: "receipt_create_exists",
        });
      }
      throw error;
    }
    await syncDirectory(directory);
  } finally {
    if (created) {
      await rm(temporaryPath, { force: true });
      if (linked) {
        await syncDirectory(directory);
      }
    }
  }
}

async function verifyEmittedReceipt(
  receiptPath: string,
  files: readonly string[],
  inputReceiptHashes: readonly string[],
  emittedContents: string,
): Promise<void> {
  let verification;
  try {
    verification = await verifyReceipt(receiptPath);
  } catch (error) {
    await cleanupOwnedReceipt(receiptPath, emittedContents);
    throw new KppError("PP_RESEARCH_LOCK_WRITE_MISMATCH", "발급된 연구 잠금 영수증을 다시 검증할 수 없습니다.", {
      path: receiptPath,
      rule: "emitted_receipt_unreadable",
      actual: error instanceof Error ? error.message : error,
    });
  }
  if (!verification.valid || !receiptMatches(verification.receipt, files, inputReceiptHashes)) {
    await cleanupOwnedReceipt(receiptPath, emittedContents);
    throw new KppError("PP_RESEARCH_LOCK_WRITE_MISMATCH", "발급된 연구 잠금 영수증이 검증된 LongTable handoff와 일치하지 않습니다.", {
      path: receiptPath,
      rule: "emitted_receipt_mismatch",
      actual: verification,
    });
  }

  const artifactShaByPath = new Map(
    files.slice(1).map((file, index) => [file, inputReceiptHashes[index]!]),
  );
  const mismatchedFiles = verification.receipt.files
    .filter((file) => artifactShaByPath.has(file.path))
    .filter((file) => artifactShaByPath.get(file.path) !== file.sha256);
  if (mismatchedFiles.length > 0) {
    await cleanupOwnedReceipt(receiptPath, emittedContents);
    throw new KppError("PP_RESEARCH_LOCK_WRITE_MISMATCH", "발급된 연구 잠금 영수증의 산출물 해시가 LongTable handoff와 일치하지 않습니다.", {
      path: receiptPath,
      rule: "emitted_artifact_sha256_mismatch",
      actual: mismatchedFiles,
    });
  }
}

async function cleanupOwnedReceipt(receiptPath: string, emittedContents: string): Promise<void> {
  await testHooks.beforePostWriteCleanup?.(receiptPath);
  let currentContents: string;
  try {
    currentContents = await readFile(receiptPath, "utf8");
  } catch {
    return;
  }
  if (currentContents === emittedContents) {
    await rm(receiptPath, { force: true });
  }
}

function isSubpath(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return childRelative === "" || (!childRelative.startsWith("..") && !isAbsolute(childRelative));
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function compareFileRecords(
  left: { path: string },
  right: { path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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
