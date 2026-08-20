import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getDocumentModePolicy, PROJECT_STATES, readProject, verifyReceipt } from "@longtable/kpp-core";
import { CompositeAuditReceiptSchema, type DocumentMode, type ProjectState } from "@longtable/kpp-schemas";
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

export interface ReleaseArtifactBindings {
  readonly built: readonly string[];
  readonly rendered: readonly string[];
  readonly architecture?: readonly string[];
  readonly references?: readonly string[];
  readonly observations?: readonly string[];
}

export interface AuditReceiptIdentity {
  readonly projectId: string;
  readonly documentMode: DocumentMode;
  readonly modePolicyVersion: string;
}

const UNIVERSAL_AUDIT_SLICES = [
  "page_architecture",
  "reference_integrity",
  "render_repetition",
  "figure_value",
  "korean_prose_review",
] as const;

const UNIVERSAL_ARTIFACT_CLASSES = new Set([
  "page_architecture",
  "reference_manifest",
  "render_observation",
  "composite_audit",
  "authoring_response",
  "docx",
  "build_manifest",
  "render_manifest",
  "pdf",
  "page_image",
  "geometry_report",
  "figure_spec",
  "figure_svg",
  "figure_manifest",
  "project_state",
  "stage_receipt",
]);

/** Validate a machine-readable audit receipt against current bytes and one mode policy. */
export async function validateCompositeAuditReceiptForRelease(
  root: string,
  value: unknown,
  expectedIdentity?: AuditReceiptIdentity,
): Promise<AuditSlice> {
  const canonicalRoot = await realpath(root).catch(() => resolve(root));
  const parsed = CompositeAuditReceiptSchema.safeParse(value);
  if (!parsed.success) {
    return makeSlice([blocked("KPP_RELEASE_AUDIT_INVALID", "release에는 구조화된 composite audit receipt가 필요합니다.", {
      actual: parsed.error.issues,
    })], []);
  }
  const receipt = parsed.data;
  const findings: AuditFinding[] = [];
  const artifacts: AuditArtifact[] = [];
  const identity = expectedIdentity ?? receipt;
  if (receipt.projectId !== identity.projectId
    || receipt.documentMode !== identity.documentMode
    || receipt.modePolicyVersion !== identity.modePolicyVersion) {
    findings.push(blocked("KPP_RELEASE_AUDIT_MODE_MISMATCH", "composite audit identity가 현재 프로젝트 mode identity와 다릅니다.", {
      expected: identity,
      actual: { projectId: receipt.projectId, documentMode: receipt.documentMode, modePolicyVersion: receipt.modePolicyVersion },
    }));
  }
  const policy = getDocumentModePolicy(identity.documentMode);
  if (identity.modePolicyVersion !== policy.modePolicyVersion) {
    findings.push(blocked("KPP_RELEASE_AUDIT_MODE_MISMATCH", "현재 프로젝트의 mode policy version을 지원하지 않습니다.", {
      expected: policy.modePolicyVersion,
      actual: identity.modePolicyVersion,
    }));
  }
  const sliceIds = new Set(receipt.slices.map(({ sliceId }) => sliceId));
  for (const sliceId of new Set([...UNIVERSAL_AUDIT_SLICES, ...policy.requiredAuditSlices])) {
    if (!sliceIds.has(sliceId)) {
      findings.push(blocked("KPP_RELEASE_AUDIT_SLICE_MISSING", "선택한 document mode에 필요한 audit slice가 없습니다.", {
        expected: sliceId,
        actual: [...sliceIds].sort(),
      }));
    }
  }
  if (receipt.status !== "PASS") {
    findings.push(blocked("KPP_RELEASE_AUDIT_NOT_PASS", "BLOCKED composite audit는 release에 사용할 수 없습니다.", {
      expected: "PASS",
      actual: receipt.status,
    }));
  }
  const allowedClasses = new Set([...UNIVERSAL_ARTIFACT_CLASSES, ...policy.artifactAllowlist]);
  for (const binding of receipt.artifactBindings) {
    if (!allowedClasses.has(binding.artifactClass)) {
      findings.push(blocked("KPP_RELEASE_ARTIFACT_CLASS_NOT_ALLOWED", "artifact class가 선택한 document mode release allowlist에 없습니다.", {
        path: binding.path,
        expected: [...allowedClasses].sort(),
        actual: binding.artifactClass,
      }));
    }
  }
  for (const requiredClass of ["page_architecture", "reference_manifest", "render_observation"] as const) {
    if (!receipt.artifactBindings.some(({ artifactClass }) => artifactClass === requiredClass)) {
      findings.push(blocked("KPP_RELEASE_AUDIT_ARTIFACT_MISSING", "release audit receipt에 필수 architecture/reference/observation 결속이 없습니다.", {
        expected: requiredClass,
      }));
    }
  }
  for (const input of receipt.inputHashes) {
    try {
      const canonical = await realpath(input.path);
      if (!isWithin(canonicalRoot, canonical)) throw new Error("artifact is outside project root");
      const artifact = await inspectArtifact(canonical);
      artifacts.push(artifact);
      if (artifact.sha256 !== input.sha256) {
        findings.push(blocked("KPP_RELEASE_AUDIT_INPUT_STALE", "audit input hash가 현재 artifact bytes와 다릅니다.", {
          path: input.path,
          expected: input.sha256,
          actual: artifact.sha256,
        }));
      }
    } catch (error) {
      findings.push(blocked("KPP_RELEASE_AUDIT_INPUT_STALE", "audit input artifact를 현재 project bytes로 검증할 수 없습니다.", {
        path: input.path,
        actual: error instanceof Error ? error.message : error,
      }));
    }
  }
  for (const binding of receipt.artifactBindings) {
    if (binding.artifactClass === "project_state" || binding.artifactClass === "stage_receipt") continue;
    try {
      const canonical = await realpath(binding.path);
      if (!isWithin(canonicalRoot, canonical)) throw new Error("artifact is outside project root");
      const artifact = await inspectArtifact(canonical);
      if (artifact.sha256 !== binding.sha256 || artifact.bytes !== binding.bytes) {
        findings.push(blocked("KPP_RELEASE_AUDIT_ARTIFACT_STALE", "audit artifact binding이 현재 path/hash/bytes와 다릅니다.", {
          path: binding.path,
          expected: binding,
          actual: artifact,
        }));
      }
    } catch (error) {
      findings.push(blocked("KPP_RELEASE_AUDIT_ARTIFACT_STALE", "audit artifact binding을 현재 project bytes로 검증할 수 없습니다.", {
        path: binding.path,
        actual: error instanceof Error ? error.message : error,
      }));
    }
  }
  return makeSlice(findings, artifacts);
}

export async function auditReleaseReadiness(
  root: string,
  bindings?: ReleaseArtifactBindings,
): Promise<AuditSlice> {
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
      const expectedPaths = stage === "BUILT"
        ? bindings?.built
        : stage === "RENDERED"
          ? bindings?.rendered
          : stage === "EVIDENCE_LOCKED"
            ? [...(bindings?.references ?? []), ...(bindings?.architecture ?? [])]
              : stage === "AUDITED"
                ? bindings?.observations
          : undefined;
      if (expectedPaths !== undefined) {
        await bindExpectedArtifacts(path, expectedPaths, verification.receipt.files, findings, artifacts);
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

function isWithin(parent: string, child: string): boolean {
  const segment = relative(resolve(parent), resolve(child));
  return segment.length > 0 && segment !== ".." && !segment.startsWith(`..${sep}`) && !isAbsolute(segment);
}

async function bindExpectedArtifacts(
  receiptPath: string,
  expectedPaths: readonly string[],
  receiptFiles: readonly { readonly path: string; readonly sha256: string }[],
  findings: AuditFinding[],
  artifacts: AuditArtifact[],
): Promise<void> {
  for (const expectedPath of expectedPaths) {
    try {
      const artifact = await inspectArtifact(expectedPath);
      artifacts.push(artifact);
      const canonicalExpected = await realpath(expectedPath);
      let matchingReceiptFile: { readonly path: string; readonly sha256: string } | undefined;
      for (const receiptFile of receiptFiles) {
        const canonicalReceiptPath = await realpath(receiptFile.path).catch(() => undefined);
        if (canonicalReceiptPath === canonicalExpected) {
          matchingReceiptFile = receiptFile;
          break;
        }
      }
      if (matchingReceiptFile?.sha256 !== artifact.sha256) {
        findings.push(blocked("KPP_RELEASE_RECEIPT_BINDING", "감사 대상 아티팩트가 stage receipt의 현재 path/hash에 연결되지 않았습니다.", {
          path: receiptPath,
          expected: artifact,
          actual: matchingReceiptFile,
        }));
      }
    } catch (error) {
      findings.push(blocked("KPP_RELEASE_RECEIPT_BINDING", "감사 대상 아티팩트의 receipt 연결을 확인할 수 없습니다.", {
        path: expectedPath,
        actual: error instanceof Error ? error.message : error,
      }));
    }
  }
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
