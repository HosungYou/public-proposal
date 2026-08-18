import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  advanceProject,
  getResearchLockReceiptHash,
  sha256File,
  verifyImportedAuthoringResponse,
  writeReceipt,
} from "@longtable/kpp-core";
import { type AuthoringRequest, type AuthoringResponse } from "@longtable/kpp-schemas";
import { KppError } from "@longtable/kpp-core";
import { lintAuthoringResponse, type KoreanProseLintResult } from "./korean-prose.js";

const SCHEMA_VERSION = "1.0.0";

export interface ContentApprovalInput {
  /** The named human who explicitly approves this lint-clean content. */
  readonly approvedBy?: string;
  /** Injectable only for deterministic local verification. */
  readonly approvedAt?: string;
}

export interface ContentApprovalResult {
  readonly state: "CONTENT_APPROVED";
  readonly decisionPath: string;
  readonly receiptPath: string;
  readonly findings: KoreanProseLintResult;
}

interface ContentApprovalDecision {
  readonly schemaVersion: string;
  readonly decision: "approved";
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly projectId: string;
  readonly authoringRequest: FileProvenance;
  readonly authoringResponse: FileProvenance;
  readonly glossary: InputProvenance;
  readonly warnings: readonly string[];
}

interface FileProvenance {
  readonly path: string;
  readonly sha256: string;
}

interface InputProvenance {
  readonly status: "provided" | "not_provided";
  readonly path: string | null;
  readonly sha256: string | null;
}

export async function approveContent(
  rootInput: string,
  input: ContentApprovalInput = {},
): Promise<ContentApprovalResult> {
  const root = resolve(rootInput);
  const researchReceiptHash = await getResearchLockReceiptHash(root);
  // This core boundary re-runs the exact request provenance, response shape,
  // pending-blank, and evidence-scope/numeric checks used at import time.
  const verified = await verifyImportedAuthoringResponse(root);
  const findings = lintAuthoringResponse(verified.response, verified.request.terminology.glossary);
  if (findings.blockers.length > 0) {
    throw new KppError("KPP_INPUT_CONTENT_BLOCKED", "제출용 콘텐츠에 해소되지 않은 차단 항목이 있습니다.", {
      rule: "content_lint_blockers",
      actual: findings.blockers,
    });
  }

  const approvedBy = input.approvedBy?.trim();
  if (approvedBy === undefined || approvedBy.length === 0) {
    throw new KppError("KPP_INPUT_CONTENT_APPROVAL_REQUIRED", "콘텐츠 승인에는 제출책임자의 명시적 승인자 정보가 필요합니다.", {
      rule: "explicit_human_content_approval",
      expected: "--approved-by <name>",
    });
  }
  const approvalTime = input.approvedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(approvalTime))) {
    throw new KppError("KPP_INPUT_CONTENT_APPROVAL_REQUIRED", "콘텐츠 승인 시각은 ISO-8601 형식이어야 합니다.", {
      rule: "content_approval_timestamp",
      actual: approvalTime,
    });
  }
  const approvedAt = new Date(approvalTime).toISOString();

  const decisionPath = join(root, "content", "content-approval-decision.json");
  const receiptPath = join(root, "receipts", "content-approval.json");
  const decision = await makeDecision(verified.request, verified.response, verified.requestPath, verified.responsePath, {
    approvedBy,
    approvedAt,
  }, findings);
  await writeJsonAtomically(decisionPath, decision);
  const glossaryPath = decision.glossary.status === "provided" ? decision.glossary.path : null;
  await writeReceipt({
    stage: "CONTENT_APPROVED",
    files: [
      verified.requestPath,
      verified.responsePath,
      decisionPath,
      ...(glossaryPath === null ? [] : [glossaryPath]),
    ],
    inputReceiptHashes: [
      await sha256File(join(root, "receipts", "design-lock.json")),
      ...(researchReceiptHash === null ? [] : [researchReceiptHash]),
    ],
    output: receiptPath,
  });
  await advanceProject(root, "CONTENT_APPROVED");
  return {
    state: "CONTENT_APPROVED",
    decisionPath,
    receiptPath,
    findings,
  };
}

async function makeDecision(
  request: AuthoringRequest,
  _response: AuthoringResponse,
  requestPath: string,
  responsePath: string,
  input: Required<ContentApprovalInput>,
  findings: KoreanProseLintResult,
): Promise<ContentApprovalDecision> {
  const glossary = request.terminology.status === "provided"
    ? { status: "provided" as const, path: request.terminology.path, sha256: request.terminology.sha256 }
    : { status: "not_provided" as const, path: null, sha256: null };
  return {
    schemaVersion: SCHEMA_VERSION,
    decision: "approved",
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    projectId: request.projectId,
    authoringRequest: { path: requestPath, sha256: await sha256File(requestPath) },
    authoringResponse: { path: responsePath, sha256: await sha256File(responsePath) },
    glossary,
    warnings: findings.warnings.map(({ code }) => code),
  };
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
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
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    if (created && !renamed) {
      await rm(temporaryPath, { force: true });
    }
  }
}
