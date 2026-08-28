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
  validateCompositeAuditReceiptForRelease,
  type AuditReceiptIdentity,
  type ReleaseArtifactBindings,
} from "./release.js";
export {
  type AuditArtifact,
  type AuditFinding,
  type AuditSlice,
  type AuditStatus,
} from "./source.js";

import { basename, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { getDocumentModePolicy, readProject, validateReferenceManifest, verifyReceipt } from "@longtable/kpp-core";
import { describeFigureSemanticValue, type FigureSpec } from "@longtable/kpp-renderers";
import {
  AuthoringResponseSchema,
  CompositeAuditReceiptSchema,
  EvidenceLedgerSchema,
  PageArchitectureManifestSchema,
  ReferenceManifestSchema,
  type AuditArtifactBinding,
  type AuditReviewerType,
  type AuditRuleFinding,
  type AuditSliceReceipt,
  type CompositeAuditReceipt,
} from "@longtable/kpp-schemas";
import { auditDocxArtifacts, readRenderObservations, type DocxAuditInput } from "./content.js";
import { auditFigureSemanticValue, type NeighboringContentBlock } from "./figure-value.js";
import { auditRenderedPageArchitecture } from "./page-architecture.js";
import { auditFigureArtifacts, auditFigureDocumentBindings, type FigureAuditInput } from "./figure-family.js";
import { auditReleaseReadiness, type ReleaseArtifactBindings } from "./release.js";
import { blocked, combineSlices, inspectArtifact, makeSlice, readJsonObject, writeStableJson, type AuditArtifact, type AuditFinding, type AuditSlice } from "./source.js";
import { auditSurfaceRepetition, surfaceTopologySignature, type SurfaceRepetitionException } from "./repetition.js";
import { auditRenderArtifacts } from "./surface-lineage.js";
import { lintAuthoringResponse } from "./korean-prose.js";

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

export type ProposalAuditReport = CompositeAuditReceipt & {
  readonly findings: readonly AuditFinding[];
  readonly artifacts: readonly AuditArtifact[];
};

export async function auditProposal(input: ProposalAuditInput): Promise<ProposalAuditReport> {
  const receiptBindings = await proposalReceiptBindings(input);
  const identity = await auditIdentity(input);
  const policy = getDocumentModePolicy(identity.documentMode);
  const baseSlices = await Promise.all([
    namedSlice("docx_integrity", auditDocxArtifacts(input.docx)),
    namedSlice("render_integrity", auditRenderArtifacts(input.renderManifestPath, { trustedPdftotextPath: input.trustedPdftotextPath })),
    namedSlice("figure_lineage", auditFigureArtifacts(input.figures)),
    namedSlice("figure_value", auditBoundFigureSemanticValue(input)),
    namedSlice("render_repetition", auditBoundSurfaceRepetition(input)),
    namedSlice("release_readiness", auditReleaseReadiness(resolve(input.root), receiptBindings)),
    namedSlice("cross_surface_lineage", auditCrossSurfaceLineage(input.docx.docxPath, input.renderManifestPath)),
    namedSlice("page_architecture", auditBoundRenderedPageArchitecture(input)),
    namedSlice("figure_document_binding", auditFigureDocumentBindings({
      figures: input.figures,
      buildManifestPath: input.docx.buildManifestPath,
      geometryReportPath: input.docx.geometryReportPath,
    })),
    namedSlice("reference_integrity", auditBoundReferenceIntegrity(input)),
    auditBoundKoreanProse(input),
  ]);
  const named = await Promise.all(baseSlices.map(async (entry): Promise<NamedSlice> => ({
    ...entry,
    reviewedLocators: entry.reviewedLocators ?? await reviewedLocatorsForSlice(entry.id, input),
  })));
  const modeTraceability = await auditModeTraceabilitySlices(input, policy);
  const byId = new Map([...named, ...modeTraceability].map((entry) => [entry.id, entry]));
  for (const required of policy.requiredAuditSlices) {
    if (!byId.has(required)) {
      byId.set(required, { id: required, slice: makeSlice([blocked(
        "KPP_AUDIT_SLICE_IMPLEMENTATION_MISSING",
        "mode policy가 요구하는 독립 audit slice 구현이 없습니다.",
        { expected: required },
      )], []) });
    }
  }
  const anchor = await inspectArtifact(input.pageArchitecturePath ?? input.docx.buildManifestPath);
  const receiptSlices = [...byId.values()].map((entry) => toReceiptSlice(entry, identity, anchor));
  const combined = combineSlices([...byId.values()].map(({ slice }) => slice));
  const inputHashes = uniqueInputs(receiptSlices.flatMap(({ inputHashes }) => inputHashes));
  const artifactBindings = uniqueBindings(receiptSlices.flatMap(({ artifactBindings }) => artifactBindings));
  const report = CompositeAuditReceiptSchema.parse({
    schemaVersion: "1.0.0",
    ...identity,
    status: combined.status,
    inputHashes,
    slices: receiptSlices,
    artifactBindings,
    findings: combined.findings,
    artifacts: combined.artifacts,
    humanBoundary: "TECHNICAL_GATE_ONLY",
  }) as ProposalAuditReport;
  await writeStableJson(input.outputPath, report);
  return report;
}

async function auditModeTraceabilitySlices(
  input: ProposalAuditInput,
  policy: ReturnType<typeof getDocumentModePolicy>,
): Promise<readonly NamedSlice[]> {
  if (input.pageArchitecturePath === undefined) return [];
  const definitions: Readonly<Record<string, readonly string[]>> = {
    procurement_evaluation_crosswalk: ["procurement_evaluation_crosswalk"],
    research_method_traceability: ["research_method", "evidence_plan"],
    operating_model_traceability: ["party_roles", "operating_model", "next_decision"],
    decision_traceability: ["decision_request", "alternatives", "tradeoffs", "owner_approval"],
    risk_owner_traceability: ["risk_register", "owner_approval"],
    source_output_traceability: ["source_inventory", "content_ledger", "mutation_report"],
    layout_accessibility: ["layout_accessibility", "acceptance_record"],
    mutation_integrity: ["content_ledger", "mutation_report", "acceptance_record"],
  };
  try {
    const artifact = await inspectArtifact(input.pageArchitecturePath);
    const architecture = PageArchitectureManifestSchema.parse(await readJsonObject(input.pageArchitecturePath));
    const canonicalRoles = new Map<string, string>();
    for (const page of architecture.pages) {
      canonicalRoles.set(policy.pageRoleAliases[page.pageRole] ?? page.pageRole, page.pageId);
    }
    return policy.requiredAuditSlices
      .filter((sliceId) => definitions[sliceId] !== undefined)
      .map((sliceId): NamedSlice => {
        const requiredRoles = definitions[sliceId]!;
        const missingRoles = requiredRoles.filter((role) => !canonicalRoles.has(role));
        const findings = missingRoles.map((role) => blocked(
          `KPP_${sliceId.toLocaleUpperCase("en-US")}_ROLE_MISSING`,
          "mode-specific traceability slice에 필요한 canonical page role이 없습니다.",
          { path: "page-architecture/pages", expected: role, actual: [...canonicalRoles.keys()].sort() },
        ));
        return {
          id: sliceId,
          slice: makeSlice(findings, [artifact]),
          reviewedLocators: requiredRoles.flatMap((role) => {
            const pageId = canonicalRoles.get(role);
            return pageId === undefined ? [] : [`page:${pageId}/role:${role}`];
          }),
        };
      });
  } catch (error) {
    return policy.requiredAuditSlices.filter((sliceId) => definitions[sliceId] !== undefined).map((sliceId): NamedSlice => ({
      id: sliceId,
      slice: makeSlice([blocked("KPP_MODE_TRACEABILITY_UNBOUND", "mode-specific traceability audit를 architecture bytes에 결속할 수 없습니다.", {
        actual: error instanceof Error ? error.message : error,
      })], []),
    }));
  }
}

interface NamedSlice {
  readonly id: string;
  readonly slice: AuditSlice;
  readonly structuredFindings?: readonly AuditRuleFinding[];
  readonly reviewerType?: AuditReviewerType;
  readonly reviewedLocators?: readonly string[];
  readonly excludedLocators?: readonly string[];
}

async function namedSlice(id: string, value: AuditSlice | Promise<AuditSlice>): Promise<NamedSlice> {
  return { id, slice: await value };
}

async function auditIdentity(input: ProposalAuditInput) {
  if (input.pageArchitecturePath !== undefined) {
    const architecture = PageArchitectureManifestSchema.parse(await readJsonObject(input.pageArchitecturePath));
    return { projectId: architecture.projectId, documentMode: architecture.documentMode, modePolicyVersion: architecture.modePolicyVersion };
  }
  const project = await readProject(resolve(input.root));
  if (project.schemaVersion !== "2.0.0") throw new Error("explicit v2 migration is required before audit");
  return { projectId: project.projectId, documentMode: project.documentMode, modePolicyVersion: project.modePolicyVersion };
}

function toReceiptSlice(
  entry: NamedSlice,
  identity: Awaited<ReturnType<typeof auditIdentity>>,
  anchor: AuditArtifact,
): AuditSliceReceipt {
  const artifacts = entry.slice.artifacts.length === 0 ? [anchor] : entry.slice.artifacts;
  const artifactBindings = artifacts.map(toArtifactBinding);
  const immutableInputs = artifacts.filter((artifact) => basename(artifact.path) !== "kpp.project.yaml" && !artifact.path.includes("/receipts/"));
  const inputs = immutableInputs.length === 0 ? [anchor] : immutableInputs;
  const findings = entry.structuredFindings ?? entry.slice.findings.map((finding): AuditRuleFinding => ({
    ruleId: finding.code,
    severity: "BLOCKER",
    message: finding.message,
    ...(finding.path === undefined ? {} : { locator: finding.path }),
    ...(finding.expected === undefined ? {} : { expected: finding.expected }),
    ...(finding.actual === undefined ? {} : { observed: finding.actual }),
  }));
  return {
    schemaVersion: "1.0.0",
    sliceId: entry.id,
    ...identity,
    status: findings.some(({ severity }) => severity === "BLOCKER") ? "BLOCKED" : "PASS",
    inputHashes: inputs.map(({ path, sha256 }) => ({ path, sha256 })),
    findings: [...findings],
    reviewerScope: {
      reviewerType: entry.reviewerType ?? "machine",
      reviewedLocators: [...(entry.reviewedLocators ?? entry.slice.findings.map(({ path }) => path).filter((path): path is string => path !== undefined))],
      excludedLocators: [...(entry.excludedLocators ?? [])],
    },
    artifactBindings,
  };
}

function toArtifactBinding(artifact: AuditArtifact): AuditArtifactBinding {
  return { artifactClass: classifyArtifact(artifact.path), ...artifact };
}

function classifyArtifact(path: string): string {
  const name = basename(path);
  if (name === "content-approval.json" && path.includes("/receipts/")) return "content_approval_receipt";
  if (path.includes("/receipts/")) return "stage_receipt";
  if (name === "page-architecture.json") return "page_architecture";
  if (name === "reference-manifest.json") return "reference_manifest";
  if (name === "evidence-ledger.json") return "evidence_ledger";
  if (name === "source-ledger.json") return "source_ledger";
  if (name === "docx-geometry.json" || name === "page-observations.json") return "render_observation";
  if (name === "authoring-response.json") return "authoring_response";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pdf")) return "pdf";
  if (/^page-\d+\.png$/u.test(name)) return "page_image";
  if (name.endsWith(".spec.json")) return "figure_spec";
  if (name.endsWith(".svg")) return "figure_svg";
  if (name.endsWith(".render.json") && path.includes("figures")) return "figure_manifest";
  if (name === "render.json") return "render_manifest";
  if (name === "manifest.json") return "build_manifest";
  if (name === "audit.json") return "composite_audit";
  if (name === "kpp.project.yaml") return "project_state";
  return "audit_receipt";
}

function uniqueInputs(inputs: readonly { readonly path: string; readonly sha256: string }[]) {
  return [...new Map(inputs.map((input) => [`${input.path}\0${input.sha256}`, input])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
}

function uniqueBindings(bindings: readonly AuditArtifactBinding[]) {
  return [...new Map(bindings.map((binding) => [`${binding.artifactClass}\0${binding.path}\0${binding.sha256}\0${binding.bytes}`, binding])).values()]
    .sort((left, right) => `${left.artifactClass}\0${left.path}`.localeCompare(`${right.artifactClass}\0${right.path}`));
}

async function auditBoundFigureSemanticValue(input: ProposalAuditInput) {
  const artifacts: AuditArtifact[] = [];
  try {
    const authoring = input.authoringResponsePath === undefined
      ? undefined
      : await receiptBoundAuthoringResponse(input.root, input.authoringResponsePath);
    if (authoring !== undefined) artifacts.push(...authoring.artifacts);
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
      : authoring?.blocks;
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

async function auditBoundReferenceIntegrity(input: ProposalAuditInput): Promise<AuditSlice> {
  if (input.pageArchitecturePath === undefined || input.referenceManifestPath === undefined) {
    return makeSlice([blocked("KPP_REFERENCE_MANIFEST_UNBOUND", "reference integrity audit에 architecture/reference manifest가 모두 필요합니다.")], []);
  }
  const evidencePath = resolve(input.root, "evidence", "evidence-ledger.json");
  try {
    const [architectureArtifact, referenceArtifact, evidenceArtifact, architectureRaw, referencesRaw, evidenceRaw] = await Promise.all([
      inspectArtifact(input.pageArchitecturePath),
      inspectArtifact(input.referenceManifestPath),
      inspectArtifact(evidencePath),
      readJsonObject(input.pageArchitecturePath),
      readJsonObject(input.referenceManifestPath),
      readJsonObject(evidencePath),
    ]);
    const result = validateReferenceManifest(
      ReferenceManifestSchema.parse(referencesRaw),
      PageArchitectureManifestSchema.parse(architectureRaw),
      EvidenceLedgerSchema.parse(evidenceRaw),
    );
    return makeSlice(result.findings.map((finding) => blocked(finding.ruleId, finding.message, {
      path: finding.evidence.locator,
      expected: finding.evidence.expected,
      actual: finding.evidence.actual,
    })), [architectureArtifact, referenceArtifact, evidenceArtifact]);
  } catch (error) {
    return makeSlice([blocked("KPP_REFERENCE_MANIFEST_UNBOUND", "reference manifest와 현재 source bytes를 검증할 수 없습니다.", {
      actual: error instanceof Error ? error.message : error,
    })], []);
  }
}

async function auditBoundKoreanProse(input: ProposalAuditInput): Promise<NamedSlice> {
  if (input.authoringResponsePath === undefined) {
    return { id: "korean_prose_review", slice: makeSlice([blocked("KPP_KOREAN_PROSE_UNBOUND", "Korean prose review에 receipt-bound authoring response가 없습니다.")], []) };
  }
  try {
    const bound = await receiptBoundAuthoringResponse(input.root, input.authoringResponsePath);
    const response = bound.response;
    const lint = lintAuthoringResponse(response, { schemaVersion: "1.0.0", entries: [] });
    const blockers = lint.blockers.map((finding) => blocked(finding.code, finding.message, {
      path: finding.blockId === undefined ? undefined : `page:${finding.blockId}/${finding.field ?? "text"}`,
      actual: finding.actual,
    }));
    const structuredFindings: AuditRuleFinding[] = lint.findings.map((finding) => ({
      ruleId: finding.code,
      severity: finding.severity === "blocker" ? "BLOCKER" : "WARNING",
      message: finding.message,
      ...(finding.blockId === undefined ? {} : { locator: `page:${finding.blockId}/${finding.field ?? "text"}` }),
      ...(finding.actual === undefined ? {} : { observed: finding.actual }),
    }));
    return {
      id: "korean_prose_review",
      slice: makeSlice(blockers, bound.artifacts),
      structuredFindings,
      reviewerType: "machine",
      reviewedLocators: response.blocks.map(({ pageId }) => `page:${pageId}`),
      excludedLocators: [],
    };
  } catch (error) {
    return { id: "korean_prose_review", slice: makeSlice([blocked("KPP_KOREAN_PROSE_UNBOUND", "Korean prose review 입력을 검증할 수 없습니다.", {
      actual: error instanceof Error ? error.message : error,
    })], []) };
  }
}

async function receiptBoundAuthoringResponse(root: string, path: string): Promise<{
  readonly response: ReturnType<typeof AuthoringResponseSchema.parse>;
  readonly blocks: readonly NeighboringContentBlock[];
  readonly artifacts: readonly AuditArtifact[];
}> {
  const receiptPath = resolve(root, "receipts", "content-approval.json");
  const [artifact, receiptArtifact, raw, verification] = await Promise.all([
    inspectArtifact(path),
    inspectArtifact(receiptPath),
    readJsonObject(path),
    verifyReceipt(receiptPath),
  ]);
  const authoringCanonical = await realpath(path);
  const matching = (await Promise.all(verification.receipt.files.map(async (file) => ({
    ...file,
    canonical: await realpath(file.path).catch(() => undefined),
  })))).find((file) => file.canonical === authoringCanonical);
  if (!verification.valid || verification.receipt.stage !== "CONTENT_APPROVED"
    || verification.receipt.result !== "PASS" || matching?.sha256 !== artifact.sha256) {
    throw new Error("authoring response is not bound to a current PASS CONTENT_APPROVED receipt");
  }
  const response = AuthoringResponseSchema.parse(raw);
  return {
    response,
    blocks: response.blocks.map((block) => ({ blockId: block.pageId, text: block.text })),
    artifacts: [artifact, receiptArtifact],
  };
}

async function reviewedLocatorsForSlice(id: string, input: ProposalAuditInput): Promise<readonly string[]> {
  if (id === "reference_integrity" && input.referenceManifestPath !== undefined) {
    const evidencePath = resolve(input.root, "evidence", "evidence-ledger.json");
    const [references, evidence] = await Promise.all([
      readJsonObject(input.referenceManifestPath).then((value) => ReferenceManifestSchema.parse(value)),
      readJsonObject(evidencePath).then((value) => EvidenceLedgerSchema.parse(value)),
    ]);
    const evidenceIds = new Set([
      ...evidence.bindings.map(({ evidenceId }) => evidenceId),
      ...evidence.claims.flatMap(({ evidenceIds: ids }) => ids),
    ]);
    return [
      ...references.references.map(({ referenceId }) => `reference:${referenceId}`),
      ...[...evidenceIds].map((evidenceId) => `evidence:${evidenceId}`),
    ];
  }
  if (id === "figure_value") {
    const ids = await Promise.all(input.figures.map(async ({ specPath }) => {
      const value = await readJsonObject(specPath);
      return typeof value.figureId === "string" ? value.figureId : basename(specPath);
    }));
    return ids.length === 0 ? ["figure:none"] : ids.map((figureId) => `figure:${figureId}`);
  }
  if ((id === "page_architecture" || id === "render_repetition") && input.pageArchitecturePath !== undefined) {
    const architecture = PageArchitectureManifestSchema.parse(await readJsonObject(input.pageArchitecturePath));
    return architecture.pages.map(({ pageId }) => `page:${pageId}`);
  }
  return [];
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
    const [artifact, geometryArtifact] = await Promise.all([
      inspectArtifact(path),
      inspectArtifact(input.docx.geometryReportPath),
    ]);
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
    return makeSlice(slice.findings, [...slice.artifacts, artifact, geometryArtifact, ...authorityArtifacts]);
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
    architecture: input.pageArchitecturePath === undefined ? undefined : [input.pageArchitecturePath],
    references: input.referenceManifestPath === undefined ? undefined : [input.referenceManifestPath],
    observations: [input.docx.geometryReportPath],
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
