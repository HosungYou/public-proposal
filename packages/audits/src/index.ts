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
import { AuthoringResponseSchema, PageArchitectureManifestSchema, ReferenceManifestSchema } from "@longtable/kpp-schemas";
import { auditDocxArtifacts, readRenderObservations, type DocxAuditInput } from "./content.js";
import { auditFigureSemanticValue, type NeighboringContentBlock } from "./figure-value.js";
import { auditRenderedPageArchitecture } from "./page-architecture.js";
import { auditFigureArtifacts, auditFigureDocumentBindings, type FigureAuditInput } from "./figure-family.js";
import { auditReleaseReadiness, type ReleaseArtifactBindings } from "./release.js";
import { blocked, combineSlices, inspectArtifact, makeSlice, readJsonObject, writeStableJson, type AuditArtifact, type AuditFinding, type AuditStatus } from "./source.js";
import { auditSurfaceRepetition, surfaceTopologySignature, type SurfaceRepetitionException } from "./repetition.js";
import { auditRenderArtifacts } from "./surface-lineage.js";

export interface ProposalAuditInput {
  readonly root: string;
  readonly docx: DocxAuditInput;
  readonly renderManifestPath: string;
  readonly pageArchitecturePath?: string;
  readonly referenceManifestPath?: string;
  readonly trustedPdftotextPath?: string;
  readonly figures: readonly FigureAuditInput[];
  /** Receipt-bound authoring response used to materialize declared nonDuplicateOf blocks. */
  readonly authoringResponsePath?: string;
  /** Compatibility-only direct caller input; production CLI must use authoringResponsePath. */
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
    if (figures.length === 0) return makeSlice([], artifacts);
    const blocks = input.authoringResponsePath === undefined
      ? input.neighboringBlocks
      : await readAuthoringBlocks(input.authoringResponsePath, artifacts);
    if (blocks === undefined) {
      return makeSlice([blocked("KPP_FIGURE_VALUE_CONTENT_UNBOUND", "semantic figure의 nonDuplicateOf 검사를 위한 receipt-bound authoring response가 없습니다.", {
        expected: "authoringResponsePath",
      })], artifacts);
    }
    const slice = auditFigureSemanticValue(figures, blocks);
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
    const authority = await resolveSurfaceRepetitionAuthority(parsed, input.referenceManifestPath);
    const slice = auditSurfaceRepetition(observations.pages.map((page, index) => ({
      pageLocator: page.pageLocator,
      topologySignature: surfaceTopologySignature({
        surfaceFamily: page.surfaceFamily,
        titleBlocks: page.titleBlocks,
        geometry: page.geometry,
        continuationFromPrevious: page.continuationMarkers.fromPrevious,
        continuationToNext: page.continuationMarkers.toNext,
      }),
      permittedException: parsed.pages[index] === undefined
        ? undefined
        : authority.exceptions.get(parsed.pages[index].pageId),
    })));
    return makeSlice([...authority.findings, ...slice.findings], [...slice.artifacts, architectureArtifact, geometryArtifact, ...authority.artifacts]);
  } catch (error) {
    return makeSlice([blocked("KPP_RENDER_SURFACE_TOPOLOGY_UNBOUND", "측정된 rendered surface observation을 repetition audit에 결속할 수 없습니다.", {
      actual: error instanceof Error ? error.message : error,
    })], []);
  }
}

async function readAuthoringBlocks(
  path: string,
  artifacts: AuditArtifact[],
): Promise<readonly NeighboringContentBlock[]> {
  const [artifact, raw] = await Promise.all([inspectArtifact(path), readJsonObject(path)]);
  artifacts.push(artifact);
  const response = AuthoringResponseSchema.parse(raw);
  return response.blocks.map((block) => ({ blockId: block.pageId, text: block.text }));
}

export async function resolveSurfaceRepetitionAuthority(
  architecture: ReturnType<typeof PageArchitectureManifestSchema.parse>,
  referenceManifestPath: string | undefined,
): Promise<{
  readonly exceptions: ReadonlyMap<string, SurfaceRepetitionException>;
  readonly findings: readonly AuditFinding[];
  readonly artifacts: readonly AuditArtifact[];
}> {
  const exceptions = new Map<string, SurfaceRepetitionException>();
  const findings: AuditFinding[] = [];
  const artifacts: AuditArtifact[] = [];
  const declared = architecture.pages.filter((page) => page.surfaceRepetitionException !== undefined);
  if (declared.length === 0) return { exceptions, findings, artifacts };
  if (referenceManifestPath === undefined) {
    for (const page of declared) {
      findings.push(blocked("KPP_RENDER_SURFACE_TOPOLOGY_EXCEPTION_UNBOUND", "surface repetition exception에 결속된 reference manifest가 없습니다.", {
        actual: page.pageId,
      }));
    }
    return { exceptions, findings, artifacts };
  }
  const [referenceArtifact, raw] = await Promise.all([
    inspectArtifact(referenceManifestPath),
    readJsonObject(referenceManifestPath),
  ]);
  artifacts.push(referenceArtifact);
  const references = ReferenceManifestSchema.parse(raw);
  const policy = getDocumentModePolicy(architecture.documentMode);
  for (const page of declared) {
    const exception = page.surfaceRepetitionException!;
    const reference = references.references.find(({ referenceId }) => referenceId === exception.sourceId);
    const sourcePath = reference?.sourcePath ?? reference?.path;
    const sourceArtifact = sourcePath === undefined ? undefined : await inspectArtifact(sourcePath).catch(() => undefined);
    if (sourceArtifact !== undefined) artifacts.push(sourceArtifact);
    const permitted = reference !== undefined
      && page.referenceIds.includes(exception.sourceId)
      && reference.referenceClass === "issuer_rule"
      && policy.issuerOverridePolicy.allowedReferenceClasses.includes(reference.referenceClass)
      && reference.verificationStatus === "verified"
      && reference.availability === "available"
      && reference.sourceSha256 === exception.sourceSha256
      && sourceArtifact?.sha256 === exception.sourceSha256;
    if (!permitted) {
      findings.push(blocked("KPP_RENDER_SURFACE_TOPOLOGY_EXCEPTION_UNBOUND", "surface repetition exception은 verified issuer_rule source와 동일한 SHA-256에 결속되어야 합니다.", {
        actual: { pageId: page.pageId, sourceId: exception.sourceId },
      }));
      continue;
    }
    exceptions.set(page.pageId, exception);
  }
  return { exceptions, findings, artifacts };
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
