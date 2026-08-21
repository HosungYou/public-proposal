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

export interface ComplexProposalFixture {
  readonly root: string;
  readonly requestPath: string;
  readonly auditFigures: readonly { readonly specPath: string; readonly svgPath: string; readonly manifestPath: string }[];
}

export interface ComplexProposalRunResult {
  readonly built: BuildProjectResult;
  readonly rendered: RenderProjectResult;
  readonly audit: AuditProjectResult;
}

const roots: string[] = [];
const PROJECT_ID = "community-care-data-pilot-review";
const TEMPLATE = resolve("workers/docx-python/assets/Korean Public Proposal A4 v1.docx");
const WORKER_PYTHON = resolve("workers/docx-python/.venv/bin/python");

const PAGES = [
  "mutual_value",
  "party_roles",
  "operating_model",
  "operating_model",
  "operating_model",
  "collaboration_options",
  "operating_model",
  "next_decision",
] as const;

const SURFACES = [
  "partnership_narrative",
  "role_handoff",
  "operating_model",
  "operating_model",
  "operating_model",
  "option_comparison",
  "operating_model",
  "decision_record",
] as const;

const HEADINGS = [
  "지역돌봄 데이터 연계 실증 제안",
  "요구사항과 검증근거의 교차표",
  "운영 모델과 책임 인계",
  "개인정보·안전 통제 설계",
  "100일 실행 로드맵",
  "대안 비교와 선정 논리",
  "성과평가와 중단 관문",
  "다음 협의에서 결정할 항목",
] as const;

const QUESTIONS = [
  "왜 지금 이 실증을 시작해야 하며 무엇을 먼저 결정해야 하는가?",
  "요구사항마다 답변과 검증근거가 연결되어 있는가?",
  "기관·현장·기술 파트너의 책임 인계가 운영 가능한가?",
  "민감정보와 민원 위험을 확장 전에 통제할 수 있는가?",
  "100일 안에 어떤 순서로 준비·운영·판단할 것인가?",
  "현장 부담과 학습가치를 기준으로 어느 대안을 선택할 것인가?",
  "성과를 과장하지 않고 계속·조정·중단을 판단할 수 있는가?",
  "다음 협의에서 확정해야 하는 범위·담당·일정은 무엇인가?",
] as const;

export async function cleanupComplexProposalFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function materializeComplexPrivatePartnership(outputRoot?: string): Promise<ComplexProposalFixture> {
  const root = outputRoot === undefined
    ? await mkdtemp(join(tmpdir(), "kpp-community-care-"))
    : resolve(outputRoot);
  if (outputRoot === undefined) roots.push(root);
  else {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
  }
  await initializeProject(root, { projectId: PROJECT_ID, documentMode: "private_partnership" });
  for (const directory of ["content", "evidence", "figures", "build", "fixture-source"]) {
    await mkdir(join(root, directory), { recursive: true });
  }

  const sourceNames = ["official-boundary.txt", "operating-design.txt", "safety-design.txt", "pending-decisions.txt"] as const;
  const sourceText = [
    "이 산출물은 실제 기관의 의사·실적·예산을 담지 않은 익명 합성 검토본이다. 기관명, 담당자, 주소, 연락처는 식별 불가능한 표기로 제한한다.\n",
    "제안 설계: 지역돌봄 접점과 기술 파트너가 반복 가능한 소규모 실증을 수행하고, 확인된 운영기록만 다음 판단의 입력으로 사용한다.\n",
    "제안 설계: 동의 목적 분리, 최소수집, 민감정보 비노출, 민원·안전 중단 관문을 운영 전제에 둔다.\n",
    "협의 필요: 대상 범위, 기간, 비용, 기관별 담당, 데이터 보관기간, 착수일은 다음 협의에서 확정한다.\n",
  ];
  const sourcePaths = await Promise.all(sourceNames.map(async (name, index) => {
    const path = join(root, "evidence", name);
    await writeFile(path, sourceText[index], "utf8");
    return path;
  }));
  const sourceHashes = await Promise.all(sourcePaths.map((path) => sha256File(path)));

  const claims = PAGES.map((_, index) => `CLM-CD-${String(index + 1).padStart(2, "0")}`);
  const evidenceIds = PAGES.map((_, index) => `EV-CD-${String(index + 1).padStart(2, "0")}`);
  const figures = complexFigures(claims, evidenceIds);
  const figuresByPage = new Map<string, FigureSpec[]>();
  const auditFigures: Array<{ specPath: string; svgPath: string; manifestPath: string }> = [];
  const embeddedFigures: Array<Record<string, unknown>> = [];
  const plannedByFigure = new Map<string, Record<string, unknown>>();
  for (const figure of figures) {
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
    const planned = plannedFigure(figure, pageId, index, renderer);
    figuresByPage.set(pageId, [...(figuresByPage.get(pageId) ?? []), figure]);
    embeddedFigures.push({
      figureId: figure.figureId,
      requirementId: `REQ-CD-${String(index + 1).padStart(2, "0")}`,
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
    plannedByFigure.set(figure.figureId, planned);
    auditFigures.push({ specPath, svgPath, manifestPath });
  }

  const tables = complexTables();
  const paragraphs = complexParagraphs(claims, evidenceIds);
  const contentBlocks = PAGES.map((role, index) => ({
    pageId: pageId(index),
    heading: HEADINGS[index],
    paragraphs: paragraphs[index],
    tables: tables[index],
    figureIds: (figuresByPage.get(pageId(index)) ?? []).map(({ figureId }) => figureId),
  }));
  const pagePlan = {
    schemaVersion: "1.0.0",
    pages: PAGES.map((role, index) => ({
      pageId: pageId(index),
      requirementId: `REQ-CD-${String(index + 1).padStart(2, "0")}`,
      pageRole: role,
      surfaceTemplateId: SURFACES[index],
      claimIds: [claims[index]],
      figureSpecs: (figuresByPage.get(pageId(index)) ?? []).map(({ figureId }) => plannedByFigure.get(figureId)),
    })),
  };
  const architecture = {
    schemaVersion: "2.0.0",
    projectId: PROJECT_ID,
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    architectureStatus: "complete",
    chapters: [{ chapterId: "CH-CD-01", title: "지역돌봄 데이터 연계 실증", order: 0 }],
    sections: PAGES.map((role, index) => ({ sectionId: `SEC-CD-${String(index + 1).padStart(2, "0")}`, chapterId: "CH-CD-01", title: role, order: index })),
    pages: PAGES.map((role, index) => ({
      pageId: pageId(index),
      chapterId: "CH-CD-01",
      sectionId: `SEC-CD-${String(index + 1).padStart(2, "0")}`,
      pageRole: role,
      surfaceTemplateId: SURFACES[index],
      titleScope: index === 0 ? "chapter" : "section",
      titlePointSize: index === 0 ? 20.5 : 12,
      continuation: index > 0,
      dominantSurface: dominantSurface(index, tables, figuresByPage),
      surfaceVisibility: "reader",
      evaluationQuestion: QUESTIONS[index],
      directAnswer: directAnswers(index),
      claimIds: [claims[index]],
      proofIds: (figuresByPage.get(pageId(index)) ?? []).flatMap(({ evidenceIds: ids }) => [...ids]),
      referenceIds: [evidenceIds[index]],
      figureIds: (figuresByPage.get(pageId(index)) ?? []).map(({ figureId }) => figureId),
      ...(index > 0 ? { continuityFromPageId: pageId(index - 1) } : {}),
      ...(index < PAGES.length - 1 ? { continuityToPageId: pageId(index + 1) } : {}),
    })),
  };
  const evidenceLedger = {
    schemaVersion: "1.0.0",
    claims: PAGES.map((_, index) => ({ claimId: claims[index], status: index === 7 ? "bounded" : "verified", evidenceIds: [evidenceIds[index]] })),
    bindings: PAGES.map((role, index) => ({
      evidenceId: evidenceIds[index],
      sourcePath: sourcePaths[index % sourcePaths.length],
      sourceSha256: sourceHashes[index % sourceHashes.length],
      scope: index === 0 ? "익명성·공식 확인 경계" : index === 7 ? "미결정 협의 항목" : "합성 운영설계",
      claimIds: [claims[index]],
      targetRequirementId: `REQ-CD-${String(index + 1).padStart(2, "0")}`,
      targetPageId: pageId(index),
      targetPageRole: role,
    })),
  };
  const references = PAGES.map((_, index) => ({
    referenceId: evidenceIds[index],
    referenceClass: index === 0 ? "official" : index === 7 ? "partner" : index % 2 === 0 ? "commercial" : "evidence",
    sourcePath: sourcePaths[index % sourcePaths.length],
    sourceSha256: sourceHashes[index % sourceHashes.length],
    locator: `합성 근거 ${index + 1}면`,
    targets: [{ kind: "claim", id: claims[index] }, { kind: "page", id: pageId(index) }, ...((figuresByPage.get(pageId(index)) ?? []).map(({ figureId }) => ({ kind: "figure", id: figureId })))],
    verificationStatus: "verified",
    availability: "available",
  }));
  const profile = lockedProfile();
  const figureManifest = { schemaVersion: "1.0.0", figures: embeddedFigures };
  const responseBlocks = PAGES.map((_, index) => ({
    pageId: pageId(index),
    claimIds: [claims[index]],
    evidenceIds: [evidenceIds[index]],
    status: "provisional",
    text: paragraphs[index].map(({ text }) => text).join("\n"),
    evaluatorAnswer: directAnswers(index),
    pendingBlankFieldIds: index === 7 ? ["scope", "owners", "budget", "retention", "start_date"] : [],
  }));
  const structure = {
    schemaVersion: "1.0.0",
    blocks: contentBlocks.map(({ pageId: id, heading, tables: pageTables, figureIds }) => ({ pageId: id, heading, tables: pageTables, figureIds })),
  };
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
    writeJson(paths.architecture, architecture),
    writeJson(paths.response, { schemaVersion: "1.0.0", blocks: responseBlocks }),
    writeJson(paths.structure, structure),
    writeJson(paths.evidence, evidenceLedger),
    writeJson(paths.references, { schemaVersion: "2.0.0", projectId: PROJECT_ID, documentMode: "private_partnership", modePolicyVersion: "1.0.0", references }),
    writeJson(paths.profile, profile),
    writeJson(paths.figureManifest, figureManifest),
  ]);
  await advanceToContentApproved(root, {
    source: sourcePaths,
    requirements: [paths.pagePlan, paths.architecture],
    evidence: [paths.evidence, paths.architecture, paths.references, ...sourcePaths],
    design: [paths.profile, paths.figureManifest, ...embeddedFigures.map(({ path }) => String(path)), ...auditFigures.flatMap((figure) => [figure.specPath, figure.svgPath, figure.manifestPath])],
    content: [paths.response, paths.structure],
  });
  const requestPath = join(root, "build", "build-request.json");
  await writeJson(requestPath, {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    template: { assetId: "korean-public-proposal-a4-v1", path: TEMPLATE, sha256: await sha256File(TEMPLATE) },
    pagePlan,
    pageArchitecture: architecture,
    evidenceLedger,
    contentBlocks,
    figureManifest,
    surfaceProfile: profile,
    output: { docxPath: join(root, "build", "proposal.docx"), manifestPath: join(root, "build", "build-manifest.json") },
  });
  return { root, requestPath, auditFigures };
}

export async function runComplexBuildRenderAudit(fixture: ComplexProposalFixture): Promise<ComplexProposalRunResult> {
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

function complexFigures(claims: readonly string[], evidenceIds: readonly string[]): FigureSpec[] {
  return [
    framework("FIG-CD-01", "P-01", claims[0]!, evidenceIds[0]!, ["S", "A", "B", "D"], [
      ["S", "공통 문제정의", "협력기관", "검증 설계", "범위 합의"],
      ["A", "현장 접점", "지역돌봄 기관", "요구 확인", "참여 기준"],
      ["B", "기술 파트너", "데이터 협력사", "지원 설계", "접근권 확인"],
      ["D", "공동 판단", "운영협의체", "협의 필요", "계속·조정·중단"],
    ], [["S", "A", "현장 요구"], ["S", "B", "기술 조건"], ["A", "D", "검증 결과"], ["B", "D", "운영 판단"]]),
    raci("FIG-CD-02", "P-02", claims[1]!, evidenceIds[1]!),
    framework("FIG-CD-03", "P-03", claims[2]!, evidenceIds[2]!, ["S", "P", "O", "D"], [
      ["S", "범위 합의", "공동협의체", "제안 설계", "착수 승인"],
      ["P", "현장 준비", "기술 파트너", "제안 설계", "연결·교육 완료"],
      ["O", "제한 운영", "현장 기관", "제안 설계", "운영기록 확보"],
      ["D", "결과 판단", "공동협의체", "협의 필요", "계속·조정·중단"],
    ], [["S", "P", "범위 인계"], ["P", "O", "준비 완료"], ["O", "D", "판단 자료"]]),
    framework("FIG-CD-04", "P-04", claims[3]!, evidenceIds[3]!, ["I", "C", "P", "G"], [
      ["I", "동의 목적 분리", "현장 담당", "설계", "목적별 안내"],
      ["C", "최소수집·가명화", "기술 파트너", "설계", "필드 목록 승인"],
      ["P", "민원·안전 중단", "공동협의체", "협의 필요", "중단 기준 확정"],
      ["G", "확장 승인", "양측 결정자", "협의 필요", "운영범위 승인"],
    ], [["I", "C", "보호 설계"], ["I", "P", "중단 조건"], ["C", "G", "확장 조건"], ["P", "G", "승인"]]),
    gantt("FIG-CD-05", "P-05", claims[4]!, evidenceIds[4]!),
    raci("FIG-CD-06", "P-06", claims[5]!, evidenceIds[5]!),
    gantt("FIG-CD-07", "P-07", claims[6]!, evidenceIds[6]!),
    framework("FIG-CD-08", "P-08", claims[7]!, evidenceIds[7]!, ["S", "R", "H"], [
      ["S", "선택", "양측 결정자", "협의 필요", "범위·비용 확정"],
      ["R", "보완 후 재검토", "공동협의체", "협의 필요", "추가 근거"],
      ["H", "보류", "양측 결정자", "협의 필요", "착수 보류"],
    ], [["S", "R", "조건 미충족"], ["R", "H", "미합의 유지"]]),
  ];
}

function framework(
  figureId: string,
  pageId: string,
  claimId: string,
  evidenceId: string,
  order: readonly string[],
  nodeRows: readonly (readonly [string, string, string, string, string])[],
  edgeRows: readonly (readonly [string, string, string])[],
): FrameworkFigureSpec {
  return {
    figureId,
    family: "framework",
    title: pageId === "P-04" ? "안전 통제와 확장 관문" : pageId === "P-03" ? "운영 단계와 책임 인계" : pageId === "P-08" ? "다음 회의 결정 경로" : "실증 의사결정 구조",
    caption: `그림 ${figureId.slice(-2)}. [제안 설계] ${pageId === "P-04" ? "안전 통제와 확장 관문" : pageId === "P-03" ? "운영 단계와 책임 인계" : pageId === "P-08" ? "다음 회의 결정 경로" : "실증 의사결정 구조"}`,
    evidenceIds: [evidenceId],
    claimIds: [claimId],
    inputKind: "semantic",
    tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: pageId === "P-04" || pageId === "P-03" ? "operational_control" : pageId === "P-08" ? "decision_tradeoff" : "causal_mechanism",
    decisionEffect: pageId === "P-04" ? "보호조치와 확장 승인 조건을 확정한다." : pageId === "P-03" ? "단계별 인수 기준과 책임 인계를 확정한다." : pageId === "P-08" ? "선택·보완·보류 중 다음 협의의 결정을 남긴다." : "현장 요구·기술 조건·운영 판단의 연결을 확정한다.",
    nonDuplicateOf: [pageId],
    encodedVariables: ["owner", "state", "timing", "acceptance", "decision_gate"],
    data: {
      kind: "research_framework",
      readingOrder: [...order],
      nodes: nodeRows.map(([id, label, owner, state, acceptance]) => ({ id, label, owner, state, acceptance, evidenceIds: [evidenceId] })),
      edges: edgeRows.map(([from, to, label]) => ({ from, to, label })),
    },
  };
}

function raci(figureId: string, pageId: string, claimId: string, evidenceId: string): RaciFigureSpec {
  const actors = pageId === "P-06" ? ["기관 담당", "기술 파트너", "공동협의체"] : ["발주 담당", "현장 기관", "기술 파트너", "공동협의체"];
  const assignments = actors.length === 3
    ? [["A", "R", "C"], ["C", "R", "A"], ["C", "R", "A"]]
    : [["A", "R", "C", "C"], ["C", "R", "C", "A"], ["C", "R", "A", "C"]];
  return {
    figureId,
    family: "raci",
    title: pageId === "P-06" ? "대안별 책임과 의사결정" : "요구사항 검증 책임표",
    caption: `그림 ${figureId.slice(-2)}. [제안 설계] ${pageId === "P-06" ? "대안별 책임과 의사결정" : "요구사항 검증 책임표"}`,
    evidenceIds: [evidenceId],
    claimIds: [claimId],
    inputKind: "semantic",
    tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: "operational_control",
    decisionEffect: "업무별 책임·협의·승인 경계를 확정한다.",
    nonDuplicateOf: [pageId],
    encodedVariables: ["actor", "assignment", "owner", "timing", "acceptance"],
    data: {
      kind: "responsibility_matrix",
      actors,
      activities: [
        { id: "R1", label: "범위·요구사항 확인", assignments: assignments[0] as any, owner: actors[0]!, state: "제안 설계", evidenceIds: [evidenceId], acceptance: "목표와 범위 승인" },
        { id: "R2", label: "현장 운영·지원", assignments: assignments[1] as any, owner: actors[1]!, state: "제안 설계", evidenceIds: [evidenceId], acceptance: "인수 기준 확인" },
        { id: "R3", label: "위험·성과 판단", assignments: assignments[2] as any, owner: actors[actors.length - 1]!, state: "협의 필요", evidenceIds: [evidenceId], acceptance: "계속·조정·중단" },
      ],
    },
  };
}

function gantt(figureId: string, pageId: string, claimId: string, evidenceId: string): GanttFigureSpec {
  return {
    figureId,
    family: "gantt",
    title: pageId === "P-07" ? "평가·중단 관문 일정" : "100일 실행 로드맵",
    caption: `그림 ${figureId.slice(-2)}. [제안 설계] ${pageId === "P-07" ? "평가·중단 관문 일정" : "100일 실행 로드맵"}`,
    evidenceIds: [evidenceId],
    claimIds: [claimId],
    inputKind: "semantic",
    tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    semanticValueIntent: "operational_control",
    decisionEffect: "준비·운영·평가 순서와 중단 기준을 확정한다.",
    nonDuplicateOf: [pageId],
    encodedVariables: ["timing", "owner", "acceptance", "gate"],
    data: {
      kind: "time_axis",
      periods: pageId === "P-07" ? ["기준선", "1차", "중간", "종료"] : ["0–20일", "21–45일", "46–70일", "71–100일"],
      workPackages: [
        { id: "W1", label: "범위·동의 기준 합의", owner: "공동협의체", start: 0, end: 1, evidenceIds: [evidenceId] },
        { id: "W2", label: "현장 준비·기술연결", owner: "기술 파트너", start: 1, end: 2, evidenceIds: [evidenceId] },
        { id: "W3", label: "제한 운영·기록", owner: "현장 기관", start: 2, end: 3, evidenceIds: [evidenceId] },
        { id: "W4", label: "결과검토·다음 판단", owner: "공동협의체", start: 3, end: 3, evidenceIds: [evidenceId] },
      ],
      milestones: [
        { id: "M1", label: "착수 승인", period: 1, owner: "공동협의체", evidenceIds: [evidenceId], acceptance: "범위·담당 확인" },
        { id: "M2", label: "중단·확대 판단", period: 3, owner: "양측 결정자", evidenceIds: [evidenceId], acceptance: "계속·조정·중단" },
      ],
    },
  };
}

function complexTables(): Array<Array<Record<string, unknown>>> {
  return [
    [table("TBL-CD-01", "표 1. [제안 설계] 의사결정 요약", ["판단축", "현재 경계", "제안 답변", "다음 확인"], [["목표", "합성 실증", "작은 검증 단위", "범위 승인"], ["안전", "확정 전", "최소수집·중단 관문", "통제기준 합의"]], [1500, 1900, 3000, 2000])],
    [table("TBL-CD-02", "표 2. [제안 설계] 요구사항·답변·근거 교차표", ["요구사항", "제안 답변", "검증근거", "상태"], [["현장 적용성", "제한 운영으로 확인", "EV-CD-02", "검증 설계"], ["책임 경계", "RACI와 인계 기준", "EV-CD-02", "검증 설계"], ["안전 통제", "목적분리·중단 관문", "EV-CD-02", "협의 필요"]], [2200, 2900, 1500, 1800])],
    [table("TBL-CD-03", "표 3. [제안 설계] 운영 인수기준과 책임 경계", ["단계", "인수 산출물", "책임 주체", "다음 승인"], [["범위 합의", "대상·목적·접근권 원장", "공동협의체", "착수 승인"], ["현장 준비", "연결·교육·지원 기록", "기술 파트너", "제한 운영"], ["결과 판단", "성과·민원·중단 원장", "공동협의체", "계속·조정·중단"]], [1700, 2900, 1700, 2100])],
    [table("TBL-CD-04", "표 3. [제안 설계] 데이터·안전 통제 원장", ["통제영역", "최소 규칙", "승인 주체", "차단 조건"], [["동의", "목적별 분리", "현장 기관", "목적 불명확"], ["접근", "역할별 최소권한", "기술 파트너", "권한 초과"], ["민원", "기록·중단·재검토", "공동협의체", "안전 조건 미충족"]], [1700, 2900, 1700, 2100])],
    [table("TBL-CD-05", "표 4. [제안 설계] 100일 산출물과 인수기준", ["구간", "산출물", "책임", "인수기준"], [["0–20일", "범위·동의 기준", "공동협의체", "서면 승인"], ["21–45일", "현장연결 설계", "기술 파트너", "접근검증"], ["46–70일", "제한 운영 기록", "현장 기관", "민원·안전 확인"], ["71–100일", "평가·판단 원장", "공동협의체", "계속·조정·중단"]], [1500, 2600, 1800, 2500])],
    [table("TBL-CD-06", "표 5. [제안 설계] 대안 비교", ["대안", "현장 부담", "학습가치", "확장 조건"], [["A 최소검증", "낮음", "핵심 흐름", "안전 기준 확인"], ["B 단계확대", "상대적으로 큼", "운영조건", "반복사용 확인"], ["C 보류", "최소", "정보 부족", "추가 협의"]], [1800, 1900, 2300, 2400])],
    [table("TBL-CD-07", "표 6. [제안 설계] 성과지표와 해석 경계", ["지표", "관찰방법", "해석 가능", "말할 수 없는 것", "판단"], [["사용완료율", "운영기록", "과정 이행", "효과 인과", "계속 검토"], ["민원·중단 건수", "사건 원장", "안전 신호", "위험 부재", "조정 필요"], ["재사용 의향", "확인 문항", "수용 신호", "시장수요 확정", "추가 검증"]], [1400, 1800, 1900, 2100, 1200])],
    [table("TBL-CD-08", "표 7. [협의 필요] 다음 회의 결정 원장", ["결정항목", "현재 경계", "결정권자", "기한"], [["대상·범위", "미합의", "양측 결정자", "다음 협의"], ["비용·담당", "미기재", "양측 결정자", "다음 협의"], ["보관기간·착수일", "미기재", "공동협의체", "다음 협의"]], [2400, 1900, 2600, 1500])],
  ];
}

function table(tableId: string, caption: string, headers: string[], rows: string[][], columnWidthsDxa: number[]): Record<string, unknown> {
  return { tableId, caption, headers, rows, columnWidthsDxa };
}

function complexParagraphs(claims: readonly string[], evidenceIds: readonly string[]): Array<Array<{ text: string; claimIds: string[]; evidenceIds: string[] }>> {
  const textByPage = [
    ["[공식 확인 사실] 이 문서는 실제 기관의 의사·실적·예산을 담지 않은 익명 합성 검토본이며, 기관명·담당자·주소·연락처는 식별 불가능한 표기로 제한했다.", "[제안 설계] 지역돌봄 접점과 기술 파트너가 작은 실증 단위에서 현장 문제, 데이터 연결, 안전 조건을 함께 확인하는 구조를 제안한다.", "[협의 필요] 첫 판단은 범위를 확정하는 것이며, 확정되지 않은 대상 수·기간·비용은 계약 사실처럼 기재하지 않는다."],
    ["[제안 설계] 요구사항은 현장 적용성, 책임 경계, 안전 통제의 세 축으로 분해하고, 각 축에 답변·근거·상태를 연결한다.", "[제안 설계] 교차표의 검증근거는 합성 설계 기록에 한정되며, 실제 운영성과나 기관의 확약을 의미하지 않는다."],
    ["[제안 설계] 운영은 범위 합의, 현장 준비, 제한 운영, 결과 판단의 네 단계로 이어지고 단계 사이 인수기준을 문서화한다.", "[협의 필요] 공동협의체는 착수·중간조정·종료 판단을 승인하며, 담당이 바뀌어도 결정 원장과 책임 경계가 남도록 한다.", "[제안 설계] 각 인수기준은 다음 단계의 시작 조건이며, 미충족 시 책임을 되돌려 조정한다."],
    ["[제안 설계] 동의 목적을 분리하고 필요한 필드만 수집하며, 민감정보는 잠금화면·공유문서에 노출하지 않는다.", "[협의 필요] 안전·민원 조건이 충족되지 않으면 자동 확대하지 않고 범위와 접근권을 다시 정한다.", "[제안 설계] 통제 원장은 법적 적합성의 확정 판정이 아니라 검토해야 할 운영 경계와 승인 질문을 제공한다.", "[협의 필요] 실제 법무·보안 검토 결과가 나오기 전에는 통제 원장을 적합성 확인으로 해석하지 않는다."],
    ["[제안 설계] 100일 계획은 0–20일 기준합의, 21–45일 연결설계, 46–70일 제한운영, 71–100일 평가판단으로 구성한다.", "[제안 설계] 각 구간은 산출물·책임자·인수기준을 함께 가지며, 일정이 늦어지면 다음 단계로 자동 진행하지 않는다."],
    ["선정 논리는 [제안 설계] 상태다. A는 현장 부담을 낮춰 핵심 흐름을 확인하고, B는 단계적으로 운영조건을 넓히며, C는 정보 부족 상태에서 보류한다.", "[협의 필요] 대안은 선호가 아니라 안전·학습·반복사용 신호가 확보되는 순서로 비교한다.", "[제안 설계] 선택지는 우선순위가 아니라 확인 가능한 조건을 기준으로 다음 회의에서 재평가한다."],
    ["[제안 설계] 성과지표는 과정 이행과 안전 신호를 구분하고, 확인된 관찰치를 인과효과나 시장수요로 과장하지 않는다.", "[협의 필요] 민원·중단 신호가 기준을 넘으면 조정 또는 중단하고, 다음 판단에 필요한 추가 근거를 기록한다."],
    ["[협의 필요] 다음 회의에서는 대상·범위, 비용·담당, 보관기간·착수일을 항목별로 결정한다.", "[제안 설계] 회의 결과는 선택·보완 후 재검토·보류 중 하나로 남기며, 미합의 값은 공란 또는 상태값으로 유지한다.", "[공식 확인 사실] 현재 문서에는 실명, 주소, 연락처, 확정 예산, 운영실적이 없다."],
  ];
  return textByPage.map((paragraphs, index) => paragraphs.map((text) => ({ text, claimIds: [claims[index]!], evidenceIds: [evidenceIds[index]!] })));
}

function dominantSurface(index: number, tables: Array<Array<Record<string, unknown>>>, figures: ReadonlyMap<string, FigureSpec[]>): "narrative" | "table" | "figure" | "mixed" {
  const hasTable = tables[index]!.length > 0;
  const hasFigure = (figures.get(pageId(index)) ?? []).length > 0;
  const preferred = ["mixed", "table", "mixed", "figure", "mixed", "table", "figure", "table"][index];
  if (preferred === "table" && hasTable) return "table";
  if (preferred === "figure" && hasFigure) return "figure";
  if (preferred === "mixed" && hasTable && hasFigure) return "mixed";
  if (hasTable && hasFigure) return "mixed";
  if (hasTable) return "table";
  if (hasFigure) return "figure";
  return "narrative";
}

function directAnswers(index: number): string {
  return [
    "익명 합성 전제 아래 범위·안전·판단 관문을 먼저 확정한다.",
    "요구사항별 답변·검증근거·상태를 교차표로 연결한다.",
    "네 단계 운영과 책임 인계 원장으로 실행 경계를 고정한다.",
    "목적분리·최소수집·중단 관문으로 확장 전 위험을 제한한다.",
    "100일 산출물과 인수기준을 순서대로 통과한다.",
    "현장 부담·학습가치·확장조건으로 대안을 비교한다.",
    "과정지표와 안전신호를 구분해 계속·조정·중단을 판단한다.",
    "다음 협의에서 범위·담당·일정·보관기간을 결정한다.",
  ][index]!;
}

function plannedFigure(figure: FigureSpec, page: string, index: number, renderer: string): Record<string, unknown> {
  const maps = figure.family === "gantt"
    ? { intent: "schedule", dataShape: "time_axis", family: "gantt" }
    : figure.family === "raci"
      ? { intent: "responsibility", dataShape: "responsibility_matrix", family: "raci" }
      : { intent: "research_framework", dataShape: "research_framework", family: "framework" };
  return {
    figureId: figure.figureId,
    requirementId: `REQ-CD-${String(index + 1).padStart(2, "0")}`,
    pageId: page,
    title: figure.title,
    ...maps,
    decisionTask: figure.decisionEffect,
    semanticValueIntent: figure.semanticValueIntent,
    decisionEffect: figure.decisionEffect,
    nonDuplicateOf: [...figure.nonDuplicateOf],
    encodedVariables: [...figure.encodedVariables],
    claimIds: [...figure.claimIds],
    evidenceIds: [...figure.evidenceIds],
    renderer,
  };
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
  return {
    schemaVersion: "1.0.0",
    profileId: "complex-private-partnership-a4-frontier",
    status: "locked",
    typography: {
      headingFont: "Noto Sans CJK KR",
      navigationFont: "Noto Sans CJK KR",
      bodyFont: "Noto Serif CJK KR",
      bodyPoint: 9.3,
      lineHeight: 1.52,
      alignment: "justified",
      characterSpacingPt: -0.2,
      precisionPolicy: "acknowledged_half_point_quantization",
    },
    table: { widthDxa: 8400, cellMarginDxa: { top: 80, start: 100, bottom: 80, end: 100 }, borderSizeEighthPt: 4 },
  };
}

async function rasterizeSvg(svgPath: string, outputDirectory: string): Promise<void> {
  const profile = await mkdtemp(join(tmpdir(), "kpp-community-care-raster-"));
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
