import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  advanceProject,
  executeFile,
  initializeProject,
  sha256File,
  writeReceipt,
} from "@longtable/kpp-core";
import {
  R08_TOKEN_PROFILE_SHA256,
  renderFigureArtifact,
  type FigureSpec,
  type FrameworkFigureSpec,
  type GanttFigureSpec,
  type RaciFigureSpec,
} from "@longtable/kpp-renderers";
import { buildProject, type BuildProjectResult } from "../../apps/kpp-cli/src/commands/build.js";
import { renderProject, type RenderProjectResult } from "../../apps/kpp-cli/src/commands/render.js";
import { auditProject, type AuditProjectResult } from "../../apps/kpp-cli/src/commands/audit.js";
import { resolveTool } from "../support/tool-paths.js";

export type PharmacyFixtureVariant = "valid" | "oversized_title" | "repeated_topology" | "decorative_evidence";

export interface PharmacyFixture {
  readonly root: string;
  readonly requestPath: string;
  readonly auditFigures: readonly { readonly specPath: string; readonly svgPath: string; readonly manifestPath: string }[];
  readonly preserved: boolean;
}

export interface PharmacyRunResult {
  readonly built: BuildProjectResult;
  readonly rendered: RenderProjectResult;
  readonly audit: AuditProjectResult;
}

const roots: string[] = [];
const PROJECT_ID = "anon-pharmacy-partnership-review";
const TEMPLATE = resolve("workers/docx-python/assets/Korean Public Proposal A4 v1.docx");
const WORKER_PYTHON = resolve("workers/docx-python/.venv/bin/python");
const BASE_FIXTURE = resolve("fixtures/valid/pharmacy-private-partnership");

const ROLES = ["mutual_value", "party_roles", "operating_model", "collaboration_options", "next_decision"] as const;
const SURFACES = ["partnership_narrative", "role_handoff", "operating_model", "option_comparison", "decision_record"] as const;

export async function cleanupPharmacyFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function materializePharmacyPartnership(
  variant: PharmacyFixtureVariant,
  outputRoot?: string,
): Promise<PharmacyFixture> {
  const root = outputRoot === undefined
    ? await mkdtemp(join(tmpdir(), `kpp-pharmacy-${variant}-`))
    : resolve(outputRoot);
  if (outputRoot === undefined) roots.push(root);
  else {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
  }
  await initializeProject(root, { projectId: PROJECT_ID, documentMode: "private_partnership" });
  await cp(BASE_FIXTURE, join(root, "fixture-source"), { recursive: true, force: false });
  await mkdir(join(root, "content"), { recursive: true });
  await mkdir(join(root, "evidence"), { recursive: true });
  await mkdir(join(root, "figures"), { recursive: true });
  await mkdir(join(root, "build"), { recursive: true });

  const sourcePaths = {
    official: join(root, "evidence", "official-fact.txt"),
    design: join(root, "evidence", "proposal-design.txt"),
    pending: join(root, "evidence", "pending-consultation.txt"),
  };
  await Promise.all([
    cp(join(BASE_FIXTURE, "evidence", "official-fact.txt"), sourcePaths.official),
    cp(join(BASE_FIXTURE, "evidence", "proposal-design.txt"), sourcePaths.design),
    cp(join(BASE_FIXTURE, "evidence", "pending-consultation.txt"), sourcePaths.pending),
  ]);
  const sourceHashes = {
    official: await sha256File(sourcePaths.official),
    design: await sha256File(sourcePaths.design),
    pending: await sha256File(sourcePaths.pending),
  };

  const pageClaims = ROLES.map((_, index) => `CLM-PH-${String(index + 1).padStart(2, "0")}`);
  const evidenceIds = ROLES.map((_, index) => `EV-PH-${String(index + 1).padStart(2, "0")}`);
  const sourceForPage = [sourcePaths.official, sourcePaths.design, sourcePaths.design, sourcePaths.design, sourcePaths.pending] as const;
  const hashForPage = [sourceHashes.official, sourceHashes.design, sourceHashes.design, sourceHashes.design, sourceHashes.pending] as const;
  const referenceClass = ["partner", "commercial", "commercial", "commercial", "partner"] as const;

  const figureSpecs = figuresFor(variant, evidenceIds, pageClaims);
  const figuresByPage = new Map<string, FigureSpec[]>();
  for (const figure of figureSpecs) {
    const pageId = figurePageId(figure.figureId);
    figuresByPage.set(pageId, [...(figuresByPage.get(pageId) ?? []), figure]);
  }
  const auditFigures: Array<{ specPath: string; svgPath: string; manifestPath: string }> = [];
  const embeddedFigures: Array<Record<string, unknown>> = [];
  const plannedByFigure = new Map<string, Record<string, unknown>>();
  for (const figure of figureSpecs) {
    const pageId = figurePageId(figure.figureId);
    const index = Number(pageId.slice(-2)) - 1;
    const artifact = await renderFigureArtifact(figure);
    const specPath = join(root, "figures", `${figure.figureId}.spec.json`);
    const svgPath = join(root, "figures", `${figure.figureId}.svg`);
    const manifestPath = join(root, "figures", `${figure.figureId}.render.json`);
    await writeJson(specPath, figure);
    await writeFile(svgPath, artifact.svg, "utf8");
    await writeJson(manifestPath, artifact.manifest);
    await rasterizeSvg(svgPath, join(root, "figures"));
    const pngPath = join(root, "figures", `${figure.figureId}.png`);
    const renderer = rendererFor(figure.family);
    embeddedFigures.push({
      figureId: figure.figureId,
      requirementId: `REQ-PH-${String(index + 1).padStart(2, "0")}`,
      pageId,
      claimIds: [...figure.claimIds],
      renderer,
      path: pngPath,
      sha256: await sha256File(pngPath),
      format: "png",
      caption: figure.caption,
      evidenceIds: [...figure.evidenceIds],
      widthDxa: 7200,
    });
    plannedByFigure.set(figure.figureId, plannedFigure(figure, pageId, index, renderer));
    auditFigures.push({ specPath, svgPath, manifestPath });
  }

  const repeated = variant === "repeated_topology";
  const paragraphs = contentParagraphs(repeated);
  const tables = pageTables(repeated);
  const pagePlan = {
    schemaVersion: "1.0.0",
    pages: ROLES.map((role, index) => ({
      pageId: pageId(index),
      requirementId: `REQ-PH-${String(index + 1).padStart(2, "0")}`,
      pageRole: role,
      surfaceTemplateId: SURFACES[index],
      claimIds: [pageClaims[index]],
      figureSpecs: (figuresByPage.get(pageId(index)) ?? []).map((figure) => plannedByFigure.get(figure.figureId)),
    })),
  };
  const evidenceLedger = {
    schemaVersion: "1.0.0",
    claims: ROLES.map((_, index) => ({
      claimId: pageClaims[index],
      status: index === 4 ? "bounded" : "verified",
      evidenceIds: [evidenceIds[index]],
    })),
    bindings: ROLES.map((role, index) => ({
      evidenceId: evidenceIds[index],
      sourcePath: sourceForPage[index],
      sourceSha256: hashForPage[index],
      scope: index === 0 ? "official_fact 익명성 경계" : index === 4 ? "pending_consultation 결정 대기 항목" : "proposal_design 합성 운영설계",
      claimIds: [pageClaims[index]],
      targetRequirementId: `REQ-PH-${String(index + 1).padStart(2, "0")}`,
      targetPageId: pageId(index),
      targetPageRole: role,
    })),
  };
  const architecturePages = ROLES.map((role, index) => ({
    pageId: pageId(index),
    chapterId: "CH-PH-01",
    sectionId: `SEC-PH-${String(index + 1).padStart(2, "0")}`,
    pageRole: role,
    surfaceTemplateId: SURFACES[index],
    titleScope: index === 0 ? "chapter" : "section",
    titlePointSize: variant === "oversized_title" && index === 1 ? 20.5 : index === 0 ? 20.5 : 12,
    continuation: index > 0,
    dominantSurface: dominantSurface(index, repeated, figuresByPage),
    surfaceVisibility: "reader",
    evaluationQuestion: evaluationQuestion(index),
    directAnswer: evaluatorAnswer(index),
    claimIds: [pageClaims[index]],
    proofIds: (figuresByPage.get(pageId(index)) ?? []).flatMap(({ evidenceIds: ids }) => [...ids]),
    referenceIds: [evidenceIds[index]],
    figureIds: (figuresByPage.get(pageId(index)) ?? []).map(({ figureId }) => figureId),
    ...(index > 0 ? { continuityFromPageId: pageId(index - 1) } : {}),
    ...(index < ROLES.length - 1 ? { continuityToPageId: pageId(index + 1) } : {}),
  }));
  const pageArchitecture = {
    schemaVersion: "2.0.0",
    projectId: PROJECT_ID,
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    architectureStatus: "complete",
    chapters: [{ chapterId: "CH-PH-01", title: "익명 지역 약국 협력 파일럿", order: 0 }],
    sections: ROLES.map((role, index) => ({ sectionId: `SEC-PH-${String(index + 1).padStart(2, "0")}`, chapterId: "CH-PH-01", title: role, order: index })),
    pages: architecturePages,
  };
  const references = ROLES.map((_, index) => ({
    referenceId: evidenceIds[index],
    referenceClass: referenceClass[index],
    sourcePath: sourceForPage[index],
    sourceSha256: hashForPage[index],
    locator: index === 0 ? "official_fact 합성 익명성 선언" : index === 4 ? "pending_consultation 미결정 항목" : `proposal_design ${index + 1}면 설계 근거`,
    targets: [
      { kind: "claim", id: pageClaims[index] },
      { kind: "page", id: pageId(index) },
      ...(figuresByPage.get(pageId(index)) ?? []).map((figure) => ({ kind: "figure", id: figure.figureId })),
    ],
    verificationStatus: "verified",
    availability: "available",
  }));
  const referenceManifest = {
    schemaVersion: "2.0.0",
    projectId: PROJECT_ID,
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    references,
  };
  const responseBlocks = ROLES.map((_, index) => ({
    pageId: pageId(index),
    claimIds: [pageClaims[index]],
    evidenceIds: [evidenceIds[index]],
    status: "provisional",
    text: paragraphs[index].map(({ text }) => text).join("\n"),
    evaluatorAnswer: evaluatorAnswer(index),
    pendingBlankFieldIds: index === 4 ? ["pilot_count", "pilot_period", "budget", "privacy_scope", "owners", "start_date"] : [],
  }));
  const contentBlocks = ROLES.map((role, index) => ({
    pageId: pageId(index),
    heading: heading(index),
    paragraphs: paragraphs[index],
    tables: tables[index],
    figureIds: (figuresByPage.get(pageId(index)) ?? []).map(({ figureId }) => figureId),
  }));
  const structure = {
    schemaVersion: "1.0.0",
    blocks: contentBlocks.map(({ pageId: id, heading: title, tables: pageTablesForBlock, figureIds }) => ({ pageId: id, heading: title, tables: pageTablesForBlock, figureIds })),
  };
  const profile = lockedProfile();
  const figureManifest = { schemaVersion: "1.0.0", figures: embeddedFigures };

  const paths = {
    pagePlan: join(root, "content", "page-plan.json"),
    architecture: join(root, "content", "page-architecture.json"),
    response: join(root, "content", "authoring-response.json"),
    structure: join(root, "content", "build-structure.json"),
    evidence: join(root, "evidence", "evidence-ledger.json"),
    references: join(root, "evidence", "reference-manifest.json"),
    profile: join(root, "figures", "design-profile.json"),
    figureManifest: join(root, "figures", "build-figure-manifest.json"),
  };
  await Promise.all([
    writeJson(paths.pagePlan, pagePlan),
    writeJson(paths.architecture, pageArchitecture),
    writeJson(paths.response, { schemaVersion: "1.0.0", blocks: responseBlocks }),
    writeJson(paths.structure, structure),
    writeJson(paths.evidence, evidenceLedger),
    writeJson(paths.references, referenceManifest),
    writeJson(paths.profile, profile),
    writeJson(paths.figureManifest, figureManifest),
  ]);
  await advanceToContentApproved(root, {
    source: Object.values(sourcePaths),
    requirements: [paths.pagePlan, paths.architecture],
    evidence: [paths.evidence, paths.architecture, paths.references, ...Object.values(sourcePaths)],
    design: [paths.profile, paths.figureManifest, ...embeddedFigures.map(({ path }) => String(path)), ...auditFigures.flatMap((figure) => [figure.specPath, figure.svgPath, figure.manifestPath])],
    content: [paths.response, paths.structure],
  });
  const requestPath = join(root, "build", "build-request.json");
  await writeJson(requestPath, {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    template: { assetId: "korean-public-proposal-a4-v1", path: TEMPLATE, sha256: await sha256File(TEMPLATE) },
    pagePlan,
    evidenceLedger,
    contentBlocks,
    figureManifest,
    surfaceProfile: profile,
    output: { docxPath: join(root, "build", "proposal.docx"), manifestPath: join(root, "build", "build-manifest.json") },
  });
  return { root, requestPath, auditFigures, preserved: outputRoot !== undefined };
}

export async function runPharmacyBuildRenderAudit(fixture: PharmacyFixture): Promise<PharmacyRunResult> {
  const built = await buildProject(fixture.root, { requestPath: fixture.requestPath, pythonPath: WORKER_PYTHON });
  const rendered = await renderProject(fixture.root, { docxPath: built.docxPath });
  const audit = await auditProject(fixture.root, {
    docxPath: built.docxPath,
    buildManifestPath: built.manifestPath,
    renderManifestPath: rendered.manifestPath,
    figures: fixture.auditFigures,
  });
  return { built, rendered, audit };
}

function figuresFor(variant: PharmacyFixtureVariant, evidenceIds: readonly string[], claimIds: readonly string[]): FigureSpec[] {
  if (variant === "repeated_topology") return [gantt("FIG-PH-01", "P-01", evidenceIds[0]!, claimIds[0]!)];
  if (variant === "decorative_evidence") return [decorativeGantt()];
  return [
    mutualValueFramework(evidenceIds[0]!, claimIds[0]!),
    roleRaci(evidenceIds[1]!, claimIds[1]!),
    operatingGantt(evidenceIds[2]!, claimIds[2]!),
    optionsFramework(evidenceIds[3]!, claimIds[3]!),
  ];
}

function mutualValueFramework(evidenceId: string, claimId: string): FrameworkFigureSpec {
  return {
    figureId: "FIG-PH-01", family: "framework", title: "상호가치 교환 구조", caption: "그림 1. [제안 설계] 양측 가치와 검증 관문",
    evidenceIds: [evidenceId], claimIds: [claimId], inputKind: "semantic", tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: "causal_mechanism", decisionEffect: "양측이 교환할 가치와 공동 검증 관문을 선택한다.", nonDuplicateOf: ["P-01"], encodedVariables: ["value_flow", "owner", "acceptance"],
    data: { kind: "research_framework", readingOrder: ["A", "G", "B"], nodes: [
      { id: "A", label: "약사회 현장접점", owner: "지역 약사회 A", state: "제안 설계", evidenceIds: [evidenceId], acceptance: "참여 의향 확인" },
      { id: "G", label: "공동 검증관문", owner: "공동협의체", state: "협의 필요", evidenceIds: [evidenceId], acceptance: "파일럿 기준 합의" },
      { id: "B", label: "기술·운영지원", owner: "헬스테크 기업 B", state: "제안 설계", evidenceIds: [evidenceId], acceptance: "지원범위 확인" },
    ], edges: [{ from: "A", to: "G", label: "현장 요구" }, { from: "G", to: "B", label: "공동 검증" }] },
  };
}

function roleRaci(evidenceId: string, claimId: string): RaciFigureSpec {
  return {
    figureId: "FIG-PH-02", family: "raci", title: "역할·승인 핸드오프", caption: "그림 2. [제안 설계] 업무별 책임과 승인 경계",
    evidenceIds: [evidenceId], claimIds: [claimId], inputKind: "semantic", tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: "operational_control", decisionEffect: "모집·지원·판단 단계의 담당과 승인권자를 확정한다.", nonDuplicateOf: ["P-02"], encodedVariables: ["owner", "timing", "acceptance"],
    data: { kind: "responsibility_matrix", actors: ["약사회 A", "기업 B", "공동협의체"], activities: [
      { id: "R1", label: "참여약국 안내", assignments: ["R", "C", "A"], owner: "약사회 A", state: "제안 설계", evidenceIds: [evidenceId], acceptance: "안내문 공동 확인" },
      { id: "R2", label: "기술지원", assignments: ["C", "R", "A"], owner: "기업 B", state: "제안 설계", evidenceIds: [evidenceId], acceptance: "지원 창구 지정" },
      { id: "R3", label: "중간판단", assignments: ["C", "R", "A"], owner: "공동협의체", state: "협의 필요", evidenceIds: [evidenceId], acceptance: "계속·조정·중단 결정" },
    ] },
  };
}

function operatingGantt(evidenceId: string, claimId: string): GanttFigureSpec {
  return gantt("FIG-PH-03", "P-03", evidenceId, claimId);
}

function gantt(figureId: string, blockId: string, evidenceId: string, claimId: string): GanttFigureSpec {
  return {
    figureId, family: "gantt", title: "파일럿 운영·판단 일정", caption: "그림 3. [제안 설계] 단계·담당·인수 기준",
    evidenceIds: [evidenceId], claimIds: [claimId], inputKind: "semantic", tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: "operational_control", decisionEffect: "준비·운영·평가 단계의 담당과 중단 기준을 확정한다.", nonDuplicateOf: [blockId], encodedVariables: ["owner", "timing", "acceptance"],
    data: { kind: "time_axis", periods: ["협의", "준비", "운영", "판단"], workPackages: [
      { id: "W1", label: "운영기준 합의", owner: "공동협의체", start: 0, end: 1, evidenceIds: [evidenceId] },
      { id: "W2", label: "현장지원", owner: "기업 B", start: 1, end: 2, evidenceIds: [evidenceId] },
      { id: "W3", label: "결과검토", owner: "약사회 A", start: 2, end: 3, evidenceIds: [evidenceId] },
    ], milestones: [
      { id: "M1", label: "착수 승인", period: 1, owner: "공동협의체", evidenceIds: [evidenceId], acceptance: "범위·담당 확인" },
      { id: "M2", label: "다음 단계 판단", period: 3, owner: "공동협의체", evidenceIds: [evidenceId], acceptance: "계속·조정·중단" },
    ] },
  };
}

function optionsFramework(evidenceId: string, claimId: string): FrameworkFigureSpec {
  return {
    figureId: "FIG-PH-04", family: "framework", title: "협력 선택지 비교", caption: "그림 4. [제안 설계] 선택지별 부담·학습·확장성",
    evidenceIds: [evidenceId], claimIds: [claimId], inputKind: "semantic", tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: "decision_tradeoff", decisionEffect: "검증 속도와 양측 부담을 기준으로 파일럿 선택지를 고른다.", nonDuplicateOf: ["P-04"], encodedVariables: ["burden", "learning_speed", "scale_option"],
    data: { kind: "research_framework", readingOrder: ["S", "A", "B", "D"], nodes: [
      { id: "S", label: "공통 기준", owner: "공동협의체", state: "제안 설계", evidenceIds: [evidenceId], acceptance: "비교기준 확인" },
      { id: "A", label: "선택지 A 최소검증", owner: "양측 실무", state: "낮은 부담", evidenceIds: [evidenceId], acceptance: "핵심 흐름 확인" },
      { id: "B", label: "선택지 B 확대검증", owner: "양측 실무", state: "높은 학습", evidenceIds: [evidenceId], acceptance: "확장조건 확인" },
      { id: "D", label: "다음 회의 결정", owner: "양측 의사결정자", state: "협의 필요", evidenceIds: [evidenceId], acceptance: "A·B·보류 선택" },
    ], edges: [{ from: "S", to: "A", label: "부담 우선" }, { from: "S", to: "B", label: "학습 우선" }, { from: "A", to: "D", label: "결과" }, { from: "B", to: "D", label: "결과" }] },
  };
}

function decorativeGantt(): GanttFigureSpec {
  return {
    figureId: "FIG-PH-01", family: "gantt", title: "근거처럼 배치된 장식 구분선", caption: "그림 1. [장식] 근거 가치가 없는 표면",
    evidenceIds: [], claimIds: [], inputKind: "semantic", tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: "decorative", decisionEffect: "", nonDuplicateOf: [], encodedVariables: [],
    data: { kind: "time_axis", periods: ["앞", "뒤"], workPackages: [{ id: "D1", label: "구분", owner: "익명", start: 0, end: 1, evidenceIds: [] }], milestones: [{ id: "D2", label: "구분", period: 1, owner: "익명", evidenceIds: [], acceptance: "장식" }] },
  };
}

function plannedFigure(figure: FigureSpec, page: string, index: number, renderer: string): Record<string, unknown> {
  const maps = figure.family === "gantt"
    ? { intent: "schedule", dataShape: "time_axis" }
    : figure.family === "raci"
      ? { intent: "responsibility", dataShape: "responsibility_matrix" }
      : { intent: "research_framework", dataShape: "research_framework" };
  return {
    figureId: figure.figureId,
    requirementId: `REQ-PH-${String(index + 1).padStart(2, "0")}`,
    pageId: page,
    title: figure.title,
    ...maps,
    decisionTask: figure.semanticValueIntent === "decorative" ? "장식 표면을 근거 채널에서 제외한다." : figure.decisionEffect,
    semanticValueIntent: figure.semanticValueIntent,
    decisionEffect: figure.decisionEffect,
    nonDuplicateOf: [...figure.nonDuplicateOf],
    encodedVariables: [...figure.encodedVariables],
    claimIds: [...figure.claimIds],
    evidenceIds: [...figure.evidenceIds],
    family: figure.family,
    renderer,
  };
}

function contentParagraphs(repeated: boolean): Array<Array<{ text: string; claimIds: string[]; evidenceIds: string[] }>> {
  const bodies = [
    ["[공식 확인 사실] 이 문서는 실재 기관의 의사를 담지 않은 익명 합성 검토본이며, 양측 명칭과 모든 운영조건은 식별 불가능한 표기로 제한했다.", "[제안 설계] 공동 파일럿은 약국 현장의 문제를 확인하고 기술지원의 적용 가능성을 함께 판단하는 작은 검증 단위로 구성한다.", "[협의 필요] 참여 범위와 성과판단 기준은 다음 회의에서 양측 의사결정자가 선택한다."],
    ["[제안 설계] 지역 약사회 A는 참여 안내와 현장 의견 취합을 맡고, 헬스테크 기업 B는 교육·기술지원과 운영기록 정리를 맡는다.", "[제안 설계] 공동협의체는 착수, 중간조정, 종료 판단을 승인하며 각 단계의 책임 인계 기준을 기록한다."],
    ["[제안 설계] 운영은 협의, 준비, 제한 운영, 결과 판단의 네 단계로 이어지며 단계마다 담당자와 인수 기준을 확인한다.", "[협의 필요] 안전·개인정보·민원 대응 조건이 충족되지 않으면 확대하지 않고 범위를 다시 정한다.", "[제안 설계] 운영기록은 다음 판단을 위한 입력으로만 사용하고 확인되지 않은 효과를 성과로 표현하지 않는다."],
    ["선택지 비교는 [제안 설계] 상태다. 선택지 A는 부담을 낮춘 최소 검증으로 핵심 흐름을 확인하고, 선택지 B는 더 넓은 운영조건을 시험해 확장 판단자료를 확보한다.", "[제안 설계] 양측은 검증 속도, 현장 부담, 기술지원 범위, 후속 확장성의 네 기준으로 선택지를 비교한다."],
    ["[협의 필요] 다음 회의에서는 대상 약국 수, 파일럿 기간, 비용, 개인정보 처리범위, 양측 담당자, 착수일을 항목별로 결정한다.", "[제안 설계] 회의 결과는 선택, 보완 후 재검토, 보류 중 하나로 기록하고 미합의 항목은 계약 사실처럼 기재하지 않는다.", "[공식 확인 사실] 현재 문서에는 실명, 주소, 연락처, 계약금액 또는 확정된 운영실적이 없다."],
  ];
  if (repeated) {
    const repeatedBody = ["[제안 설계] 동일한 구조의 비교표를 배치해 반복 표면 감사가 차단하는지 확인하는 합성 회귀 문단이다.", "[협의 필요] 이 문단은 실제 협력조건을 주장하지 않으며 구조 반복 실패만 재현한다."];
    bodies[1] = repeatedBody;
    bodies[2] = [...repeatedBody];
    bodies[3] = [...repeatedBody];
  }
  return bodies.map((page, index) => page.map((text) => ({ text, claimIds: [`CLM-PH-${String(index + 1).padStart(2, "0")}`], evidenceIds: [`EV-PH-${String(index + 1).padStart(2, "0")}`] })));
}

function pageTables(repeated: boolean): Array<Array<Record<string, unknown>>> {
  const role = { tableId: "TBL-PH-02", caption: "표 1. [제안 설계] 양측 역할·승인 경계", headers: ["상태", "업무", "약사회 A", "기업 B", "공동협의체"], rows: [["제안 설계", "참여 안내", "주관", "지원", "승인"], ["협의 필요", "중간 판단", "협의", "협의", "결정"]], columnWidthsDxa: [1200, 1800, 1700, 1700, 2000] };
  const option = { tableId: "TBL-PH-04", caption: "표 2. [제안 설계] 파일럿 선택지 비교", headers: ["상태", "선택지", "현장 부담", "학습 범위", "다음 판단"], rows: [["제안 설계", "A 최소검증", "낮음", "핵심 흐름", "확대 여부"], ["제안 설계", "B 확대검증", "상대적으로 큼", "확장 조건", "지속 여부"]], columnWidthsDxa: [1200, 1700, 1600, 1900, 2000] };
  const next = { tableId: "TBL-PH-05", caption: "표 3. [협의 필요] 다음 회의 결정 원장", headers: ["상태", "결정 항목", "현재 경계", "결정권자"], rows: [["협의 필요", "대상·기간·비용", "미합의", "양측 의사결정자"], ["협의 필요", "개인정보·담당·착수일", "미합의", "양측 의사결정자"]], columnWidthsDxa: [1500, 2500, 1900, 2500] };
  if (repeated) {
    return [[], [role], [{ ...role, tableId: "TBL-PH-03" }], [{ ...role, tableId: "TBL-PH-04" }], [next]];
  }
  return [[], [role], [], [option], [next]];
}

function dominantSurface(index: number, repeated: boolean, figures: ReadonlyMap<string, FigureSpec[]>): "narrative" | "table" | "figure" | "mixed" {
  if (repeated && index >= 1 && index <= 3) return "table";
  const hasFigure = (figures.get(pageId(index)) ?? []).length > 0;
  const hasTable = index === 1 || index === 3 || index === 4;
  if (hasFigure && hasTable) return "mixed";
  if (hasFigure) return "figure";
  if (hasTable) return "table";
  return "narrative";
}

function heading(index: number): string {
  return ["익명 지역 약국 협력 파일럿", "역할과 승인 경계", "운영 흐름과 중단 기준", "협력 선택지와 판단 기준", "다음 회의에서 결정할 항목"][index]!;
}

function evaluationQuestion(index: number): string {
  return ["양측에 검증 가능한 상호가치가 있는가?", "업무별 담당과 승인권이 분명한가?", "파일럿을 안전하게 통제할 수 있는가?", "어떤 선택지가 부담과 학습의 균형에 맞는가?", "다음 회의에서 무엇을 결정해야 하는가?"][index]!;
}

function evaluatorAnswer(index: number): string {
  return ["익명 합성 전제 아래 상호가치와 공동 검증 관문을 제안한다.", "모집·지원·판단의 책임과 승인 경계를 구분한다.", "네 단계 운영과 계속·조정·중단 관문을 둔다.", "최소검증과 확대검증을 네 기준으로 비교한다.", "여섯 미결정 항목과 선택·보완·보류 결정을 요청한다."][index]!;
}

function figurePageId(figureId: string): string {
  return `P-${figureId.slice(-2)}`;
}

function pageId(index: number): string {
  return `P-${String(index + 1).padStart(2, "0")}`;
}

function rendererFor(family: FigureSpec["family"]): string {
  if (family === "raci") return "word-native-raci-table";
  if (family === "framework") return "svg-academic-framework";
  return "svg-gantt";
}

function lockedProfile() {
  return { schemaVersion: "1.0.0", profileId: "r08-a4-narrative-proposal-override", status: "locked", typography: { headingFont: "Noto Sans CJK KR", navigationFont: "Noto Sans CJK KR", bodyFont: "Noto Serif CJK KR", bodyPoint: 9.3, lineHeight: 1.52, alignment: "justified", characterSpacingPt: -0.2, precisionPolicy: "acknowledged_half_point_quantization" }, table: { widthDxa: 8400, cellMarginDxa: { top: 80, start: 100, bottom: 80, end: 100 }, borderSizeEighthPt: 4 } };
}

async function rasterizeSvg(svgPath: string, outputDirectory: string): Promise<void> {
  const profile = await mkdtemp(join(tmpdir(), "kpp-pharmacy-raster-"));
  const soffice = await resolveTool("soffice");
  try {
    await executeFile(soffice, [`-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--convert-to", "png:draw_png_Export", "--outdir", outputDirectory, svgPath], { timeoutMs: 120_000 });
    const output = join(outputDirectory, `${basename(svgPath, ".svg")}.png`);
    if ((await stat(output)).size < 1) throw new Error(`empty raster: ${output}`);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

async function advanceToContentApproved(root: string, files: { source: string[]; requirements: string[]; evidence: string[]; design: string[]; content: string[] }): Promise<void> {
  const stages = [
    ["SOURCE_LOCKED", "source-lock.json", files.source],
    ["REQUIREMENTS_LOCKED", "requirements-lock.json", files.requirements],
    ["EVIDENCE_LOCKED", "evidence-lock.json", files.evidence],
    ["DESIGN_LOCKED", "design-lock.json", files.design],
    ["CONTENT_APPROVED", "content-approval.json", files.content],
  ] as const;
  let predecessor: string | undefined;
  for (const [stage, filename, bound] of stages) {
    const marker = join(root, "receipt-fixtures", `${stage}.txt`);
    await mkdir(join(root, "receipt-fixtures"), { recursive: true });
    await writeFile(marker, `${stage}\n`, "utf8");
    const receipt = join(root, "receipts", filename);
    await writeReceipt({ stage, files: [marker, ...bound], inputReceiptHashes: predecessor === undefined ? [] : [predecessor], output: receipt });
    await advanceProject(root, stage);
    predecessor = await sha256File(receipt);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
