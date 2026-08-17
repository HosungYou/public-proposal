import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_STATES, readProject, sha256File, verifyReceipt } from "@kpp/core";
import type { ProjectState } from "@kpp/schemas";
import {
  blocked,
  inspectArtifact,
  makeSlice,
  type AuditArtifact,
  type AuditFinding,
  type AuditSlice,
} from "./source.js";

const RECEIPTS: Partial<Record<ProjectState, string>> = {
  SOURCE_LOCKED: "source-lock.json",
  REQUIREMENTS_LOCKED: "requirements-lock.json",
  EVIDENCE_LOCKED: "evidence-lock.json",
  DESIGN_LOCKED: "design-lock.json",
  CONTENT_APPROVED: "content-approval.json",
  BUILT: "build.json",
  RENDERED: "render.json",
  AUDITED: "audit.json",
  HUMAN_APPROVED: "approval.json",
  RELEASED: "release.json",
};

export async function auditReleaseReadiness(root: string): Promise<AuditSlice> {
  const findings: AuditFinding[] = [];
  const artifacts: AuditArtifact[] = [];
  let project;
  try {
    project = await readProject(root);
    artifacts.push(await inspectArtifact(join(root, "kpp.project.yaml")));
  } catch (error) {
    return makeSlice([blocked("KPP_RELEASE_PROJECT", "프로젝트 상태 파일을 읽을 수 없습니다.", {
      path: join(root, "kpp.project.yaml"),
      actual: error instanceof Error ? error.message : error,
    })], artifacts);
  }
  const stateIndex = PROJECT_STATES.indexOf(project.state);
  const renderedIndex = PROJECT_STATES.indexOf("RENDERED");
  if (stateIndex < renderedIndex) {
    findings.push(blocked("KPP_RELEASE_STATE", "artifact audit는 RENDERED 이후에만 수행할 수 있습니다.", {
      expected: "RENDERED or later",
      actual: project.state,
    }));
  }
  let predecessorHash: string | undefined;
  for (let index = 1; index <= stateIndex; index += 1) {
    const stage = PROJECT_STATES[index];
    const filename = stage === undefined ? undefined : RECEIPTS[stage];
    if (stage === undefined || filename === undefined) continue;
    const path = join(root, "receipts", filename);
    try {
      const receiptArtifact = await inspectArtifact(path);
      artifacts.push(receiptArtifact);
      const verification = await verifyReceipt(path);
      if (!verification.valid || verification.receipt.stage !== stage || verification.receipt.result !== "PASS") {
        findings.push(blocked("KPP_RELEASE_RECEIPT_ARTIFACT", "PASS receipt가 현재 file bytes/stage와 일치하지 않습니다.", {
          path,
          actual: verification,
        }));
      }
      if (predecessorHash !== undefined && !verification.receipt.inputReceiptHashes.includes(predecessorHash)) {
        findings.push(blocked("KPP_RELEASE_RECEIPT_CHAIN", "선행 receipt hash가 누락되었거나 stale입니다.", {
          path,
          expected: predecessorHash,
          actual: verification.receipt.inputReceiptHashes,
        }));
      }
      predecessorHash = receiptArtifact.sha256;
    } catch (error) {
      findings.push(blocked("KPP_RELEASE_RECEIPT_ARTIFACT", "receipt 또는 연결된 file bytes를 검사할 수 없습니다.", {
        path,
        actual: error instanceof Error ? error.message : error,
      }));
      predecessorHash = undefined;
    }
  }
  await rejectPrematureReceipt(root, "approval.json", "HUMAN_APPROVED", stateIndex, findings, artifacts);
  await rejectPrematureReceipt(root, "release.json", "RELEASED", stateIndex, findings, artifacts);
  return makeSlice(findings, artifacts);
}

async function rejectPrematureReceipt(
  root: string,
  filename: string,
  stage: ProjectState,
  stateIndex: number,
  findings: AuditFinding[],
  artifacts: AuditArtifact[],
): Promise<void> {
  const path = join(root, "receipts", filename);
  if (await lstat(path).catch(() => undefined) === undefined) return;
  try {
    artifacts.push(await inspectArtifact(path));
    const verification = await verifyReceipt(path);
    if (stateIndex < PROJECT_STATES.indexOf(stage) || !verification.valid
      || verification.receipt.stage !== stage || verification.receipt.result !== "PASS") {
      findings.push(blocked("KPP_RELEASE_STALE_APPROVAL", "현재 상태와 일치하지 않는 approval/release receipt가 존재합니다.", {
        path,
        expected: stage,
        actual: verification.receipt.stage,
      }));
    }
  } catch (error) {
    findings.push(blocked("KPP_RELEASE_STALE_APPROVAL", "approval/release receipt가 손상되었습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    }));
  }
}
