export {
  lintAuthoringResponse,
  lintKoreanProse,
  type ContentFinding,
  type ContentFindingSeverity,
  type KoreanProseLintResult,
  type ProseBlock,
} from "./korean-prose.js";
export {
  findRepeatedSentences,
  sentenceFingerprint,
  type RepeatedSentence,
  type RepetitionOccurrence,
} from "./repetition.js";
export {
  approveContent,
  type ContentApprovalInput,
  type ContentApprovalResult,
} from "./content-approval.js";
export {
  auditDocxArtifacts,
  type DocxAuditInput,
} from "./content.js";
export {
  auditRenderArtifacts,
  type RenderAuditOptions,
} from "./surface-lineage.js";
export {
  auditFigureArtifacts,
  type FigureAuditInput,
} from "./figure-family.js";
export {
  auditReleaseReadiness,
} from "./release.js";
export {
  type AuditArtifact,
  type AuditFinding,
  type AuditSlice,
  type AuditStatus,
} from "./source.js";

import { resolve } from "node:path";
import { auditDocxArtifacts, type DocxAuditInput } from "./content.js";
import { auditFigureArtifacts, type FigureAuditInput } from "./figure-family.js";
import { auditReleaseReadiness } from "./release.js";
import { blocked, combineSlices, inspectArtifact, makeSlice, readJsonObject, writeStableJson, type AuditArtifact, type AuditFinding, type AuditStatus } from "./source.js";
import { auditRenderArtifacts } from "./surface-lineage.js";

export interface ProposalAuditInput {
  readonly root: string;
  readonly docx: DocxAuditInput;
  readonly renderManifestPath: string;
  readonly trustedPdftotextPath?: string;
  readonly figures: readonly FigureAuditInput[];
  readonly outputPath: string;
}

export interface ProposalAuditReport {
  readonly schemaVersion: "1";
  readonly status: AuditStatus;
  readonly findings: readonly AuditFinding[];
  readonly artifacts: readonly AuditArtifact[];
  readonly humanBoundary: "TECHNICAL_GATE_ONLY";
}

export async function auditProposal(input: ProposalAuditInput): Promise<ProposalAuditReport> {
  const combined = combineSlices(await Promise.all([
    auditDocxArtifacts(input.docx),
    auditRenderArtifacts(input.renderManifestPath, { trustedPdftotextPath: input.trustedPdftotextPath }),
    auditFigureArtifacts(input.figures),
    auditReleaseReadiness(resolve(input.root)),
    auditCrossSurfaceLineage(input.docx.docxPath, input.renderManifestPath),
  ]));
  const report: ProposalAuditReport = {
    schemaVersion: "1",
    status: combined.status,
    findings: combined.findings,
    artifacts: combined.artifacts,
    humanBoundary: "TECHNICAL_GATE_ONLY",
  };
  await writeStableJson(input.outputPath, report);
  return report;
}

async function auditCrossSurfaceLineage(docxPath: string, renderManifestPath: string) {
  try {
    const [docx, manifest] = await Promise.all([
      inspectArtifact(docxPath),
      readJsonObject(renderManifestPath),
    ]);
    const input = manifest.input;
    const renderDocx = input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).docx
      : undefined;
    const record = renderDocx !== null && typeof renderDocx === "object" && !Array.isArray(renderDocx)
      ? renderDocx as Record<string, unknown>
      : undefined;
    if (record?.path !== docxPath || record.sha256 !== docx.sha256) {
      return makeSlice([blocked("KPP_DESIGN_SURFACE_LINEAGE", "감사한 DOCX와 PDF render 입력 DOCX가 다릅니다.", {
        path: renderManifestPath,
        expected: { path: docxPath, sha256: docx.sha256 },
        actual: record,
      })], [docx]);
    }
    return makeSlice([], [docx]);
  } catch (error) {
    return makeSlice([blocked("KPP_DESIGN_SURFACE_LINEAGE", "DOCX/PDF cross-surface lineage를 확인할 수 없습니다.", {
      path: renderManifestPath,
      actual: error instanceof Error ? error.message : error,
    })], []);
  }
}
