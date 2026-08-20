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
  auditSurfaceRepetition,
  surfaceTopologySignature,
  type RepeatedSentence,
  type RepetitionOccurrence,
  type SurfaceRepetitionException,
  type SurfaceTopologyObservation,
} from "./repetition.js";
export {
  auditFigureSemanticValue,
  type FigureSemanticValueRecord,
  type NeighboringContentBlock,
} from "./figure-value.js";
export {
  approveContent,
  type ContentApprovalInput,
  type ContentApprovalResult,
} from "./content-approval.js";
export {
  auditDocxArtifacts,
  readRenderObservations,
  type DocxAuditInput,
} from "./content.js";
export {
  auditRenderedPageArchitecture,
  type RenderedPageArchitectureAuditInput,
} from "./page-architecture.js";
export {
  renderObservationManifestFromGeometry,
  type RenderContinuationMarkers,
  type RenderObservationIdentity,
  type RenderObservationManifest,
  type RenderPageGeometry,
  type RenderPageObservation,
  type RenderTitleBlockObservation,
} from "./render-observations.js";
export {
  auditRenderArtifacts,
  type RenderAuditOptions,
} from "./surface-lineage.js";
export {
  auditFigureArtifacts,
  auditFigureDocumentBindings,
  type FigureAuditInput,
  type FigureDocumentBindingInput,
} from "./figure-family.js";
export {
  auditReleaseReadiness,
  type ReleaseArtifactBindings,
} from "./release.js";
export {
  type AuditArtifact,
  type AuditFinding,
  type AuditSlice,
  type AuditStatus,
} from "./source.js";

import { resolve } from "node:path";
import { getDocumentModePolicy } from "@longtable/kpp-core";
import { describeFigureSemanticValue, type FigureSpec } from "@longtable/kpp-renderers";
import { PageArchitectureManifestSchema, ReferenceManifestSchema } from "@longtable/kpp-schemas";
import { auditDocxArtifacts, readRenderObservations, type DocxAuditInput } from "./content.js";
import { auditFigureSemanticValue, type NeighboringContentBlock } from "./figure-value.js";
import { auditRenderedPageArchitecture } from "./page-architecture.js";
import { auditFigureArtifacts, auditFigureDocumentBindings, type FigureAuditInput } from "./figure-family.js";
import { auditReleaseReadiness, type ReleaseArtifactBindings } from "./release.js";
import { blocked, combineSlices, inspectArtifact, makeSlice, readJsonObject, writeStableJson, type AuditArtifact, type AuditFinding, type AuditStatus } from "./source.js";
import { auditSurfaceRepetition, surfaceTopologySignature } from "./repetition.js";
import { auditRenderArtifacts } from "./surface-lineage.js";

export interface ProposalAuditInput {
  readonly root: string;
  readonly docx: DocxAuditInput;
  readonly renderManifestPath: string;
  readonly pageArchitecturePath?: string;
  readonly referenceManifestPath?: string;
  readonly trustedPdftotextPath?: string;
  readonly figures: readonly FigureAuditInput[];
  /** Hash-bound figure specs carry block IDs; supplied content enables direct restatement checks. */
  readonly neighboringBlocks?: readonly NeighboringContentBlock[];
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
  const receiptBindings = await proposalReceiptBindings(input);
  const slices = [
    auditDocxArtifacts(input.docx),
    auditRenderArtifacts(input.renderManifestPath, { trustedPdftotextPath: input.trustedPdftotextPath }),
    auditFigureArtifacts(input.figures),
    auditBoundFigureSemanticValue(input),
    auditBoundSurfaceRepetition(input),
    auditReleaseReadiness(resolve(input.root), receiptBindings),
    auditCrossSurfaceLineage(input.docx.docxPath, input.renderManifestPath),
    auditBoundRenderedPageArchitecture(input),
  ];
  slices.push(auditFigureDocumentBindings({
    figures: input.figures,
    buildManifestPath: input.docx.buildManifestPath,
    geometryReportPath: input.docx.geometryReportPath,
  }));
  const combined = combineSlices(await Promise.all(slices));
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

async function auditBoundFigureSemanticValue(input: ProposalAuditInput) {
  const artifacts: AuditArtifact[] = [];
  try {
    const figures = await Promise.all(input.figures.map(async (figureInput) => {
      const [specArtifact, manifestArtifact, spec] = await Promise.all([
        inspectArtifact(figureInput.specPath),
        inspectArtifact(figureInput.manifestPath),
        readJsonObject(figureInput.specPath),
      ]);
      artifacts.push(specArtifact, manifestArtifact);
      return describeFigureSemanticValue(spec as unknown as FigureSpec);
    }));
    const slice = auditFigureSemanticValue(figures, input.neighboringBlocks ?? []);
    return makeSlice(slice.findings, [...slice.artifacts, ...artifacts]);
  } catch (error) {
    return makeSlice([blocked("KPP_FIGURE_VALUE_UNBOUND", "hash-bound semantic figure spec를 value audit에 결속할 수 없습니다.", {
      actual: error instanceof Error ? error.message : error,
    })], artifacts);
  }
}

async function auditBoundSurfaceRepetition(input: ProposalAuditInput) {
  if (input.pageArchitecturePath === undefined) {
    return makeSlice([blocked("KPP_RENDER_SURFACE_TOPOLOGY_UNBOUND", "rendered surface repetition audit에 잠긴 page architecture가 없습니다.")], []);
  }
  try {
    const [architectureArtifact, geometryArtifact, architecture] = await Promise.all([
      inspectArtifact(input.pageArchitecturePath),
      inspectArtifact(input.docx.geometryReportPath),
      readJsonObject(input.pageArchitecturePath),
    ]);
    const parsed = PageArchitectureManifestSchema.parse(architecture);
    const observations = await readRenderObservations(input.docx.geometryReportPath, {
      projectId: parsed.projectId,
      documentMode: parsed.documentMode,
      modePolicyVersion: parsed.modePolicyVersion,
    });
    const slice = auditSurfaceRepetition(observations.pages.map((page) => ({
      pageLocator: page.pageLocator,
      topologySignature: surfaceTopologySignature({
        surfaceFamily: page.surfaceFamily,
        titleBlocks: page.titleBlocks,
        geometry: page.geometry,
        continuationFromPrevious: page.continuationMarkers.fromPrevious,
        continuationToNext: page.continuationMarkers.toNext,
      }),
    })));
    return makeSlice(slice.findings, [...slice.artifacts, architectureArtifact, geometryArtifact]);
  } catch (error) {
    return makeSlice([blocked("KPP_RENDER_SURFACE_TOPOLOGY_UNBOUND", "측정된 rendered surface observation을 repetition audit에 결속할 수 없습니다.", {
      actual: error instanceof Error ? error.message : error,
    })], []);
  }
}

async function auditBoundRenderedPageArchitecture(input: ProposalAuditInput) {
  const path = input.pageArchitecturePath;
  if (path === undefined) {
    return makeSlice([blocked(
      "KPP_PAGE_ARCHITECTURE_UNBOUND",
      "렌더 페이지 감사에 잠긴 page architecture 경로가 결속되지 않았습니다.",
      { expected: "receipt-bound content/page-architecture.json" },
    )], []);
  }
  try {
    const artifact = await inspectArtifact(path);
    const buildManifest = await readJsonObject(input.docx.buildManifestPath);
    const buildInputs = objectAt(buildManifest, "inputs");
    if (buildInputs?.pageArchitectureSha256 !== artifact.sha256) {
      return makeSlice([blocked(
        "KPP_PAGE_ARCHITECTURE_LINEAGE",
        "page architecture bytes가 canonical build manifest 입력 해시와 다릅니다.",
        { path, expected: buildInputs?.pageArchitectureSha256, actual: artifact.sha256 },
      )], [artifact]);
    }
    const architecture = PageArchitectureManifestSchema.parse(await readJsonObject(path));
    const observations = await readRenderObservations(input.docx.geometryReportPath, {
      projectId: architecture.projectId,
      documentMode: architecture.documentMode,
      modePolicyVersion: architecture.modePolicyVersion,
    });
    const authorityIds: string[] = [];
    const authorityArtifacts: AuditArtifact[] = [];
    if (input.referenceManifestPath !== undefined) {
      const referenceArtifact = await inspectArtifact(input.referenceManifestPath);
      const references = ReferenceManifestSchema.parse(await readJsonObject(input.referenceManifestPath));
      const policy = getDocumentModePolicy(architecture.documentMode);
      if (buildInputs?.referenceManifestSha256 !== referenceArtifact.sha256) {
        return makeSlice([blocked(
          "KPP_REFERENCE_MANIFEST_LINEAGE",
          "issuer override 권한 원장이 canonical build manifest 입력 해시와 다릅니다.",
          { path: input.referenceManifestPath, expected: buildInputs?.referenceManifestSha256, actual: referenceArtifact.sha256 },
        )], [artifact, referenceArtifact]);
      }
      authorityArtifacts.push(referenceArtifact);
      for (const page of architecture.pages) {
        const override = page.issuerOverride;
        if (override?.sourceId !== undefined) {
          const reference = references.references.find(({ referenceId }) => referenceId === override.sourceId);
          if (reference !== undefined
            && page.referenceIds.includes(override.sourceId)
            && reference.verificationStatus === "verified"
            && policy.issuerOverridePolicy.allowedReferenceClasses.includes(reference.referenceClass)) {
            authorityIds.push(`source:${override.sourceId}`);
          }
        }
        if (override?.ruleId !== undefined && policy.issuerOverridePolicy.allowedRuleIds.includes(override.ruleId)) {
          authorityIds.push(`rule:${override.ruleId}`);
        }
      }
    }
    const slice = auditRenderedPageArchitecture({
      architecture,
      observations,
      issuerOverrideAuthorityIds: authorityIds,
    });
    return makeSlice(slice.findings, [...slice.artifacts, artifact, ...authorityArtifacts]);
  } catch (error) {
    return makeSlice([blocked(
      "KPP_PAGE_ARCHITECTURE_UNBOUND",
      "잠긴 page architecture와 직접 측정 geometry를 결합할 수 없습니다.",
      { path, actual: error instanceof Error ? error.message : error },
    )], []);
  }
}

async function proposalReceiptBindings(input: ProposalAuditInput): Promise<ReleaseArtifactBindings> {
  const rendered = [input.renderManifestPath];
  try {
    const manifest = await readJsonObject(input.renderManifestPath);
    const output = objectAt(manifest, "output");
    const pdf = objectAt(output, "pdf");
    if (typeof pdf?.path === "string") rendered.push(pdf.path);
    const pages = output?.pages;
    if (Array.isArray(pages)) {
      for (const value of pages) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          const path = (value as Record<string, unknown>).path;
          if (typeof path === "string") rendered.push(path);
        }
      }
    }
  } catch {
    // The render audit reports malformed/unreadable manifests; receipt binding still requires the manifest itself.
  }
  return {
    built: [input.docx.buildManifestPath, input.docx.docxPath],
    rendered,
  };
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

function objectAt(value: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current !== null && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : undefined;
}
