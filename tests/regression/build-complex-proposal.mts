import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { sha256File } from "@longtable/kpp-core";
import { materializeComplexPrivatePartnership, runComplexBuildRenderAudit } from "./complex-proposal-fixture.js";

const execFile = promisify(execFileCallback);
const SURFACE_AUDITOR = resolve("plugins/public-proposal/skills/korean-public-proposal/scripts/audit_surface_contract.py");
const VISUAL_AUDITOR = resolve("plugins/public-proposal/skills/korean-public-proposal/scripts/audit_rendered_visual.py");

const outputRoot = resolve(process.argv[2] ?? ".superpowers/sdd/2026-08-20-kpp-vnext-document-architecture/evidence/community-care-data-pilot");
const projectRoot = join(outputRoot, "project");
const reviewRoot = join(outputRoot, "review");
const fixture = await materializeComplexPrivatePartnership(projectRoot);
const result = await runComplexBuildRenderAudit(fixture);
if (result.audit.state !== "AUDITED" || result.audit.report.status !== "PASS") {
  throw new Error(`complex proposal audit did not pass: ${JSON.stringify(result.audit.report.findings)}`);
}
await mkdir(join(reviewRoot, "managed-pages"), { recursive: true });
const docxPath = join(reviewRoot, "proposal.docx");
const managedPdfPath = join(reviewRoot, "managed-proposal.pdf");
await copyFile(result.built.docxPath, docxPath);
await copyFile(result.rendered.pdfPath, managedPdfPath);
for (const page of result.rendered.pageImages) {
  await copyFile(page.path, join(reviewRoot, "managed-pages", `page-${String(page.page).padStart(4, "0")}.png`));
}
const surfaceContractPath = join(projectRoot, "surface-contract.json");
const surfaceAuditPath = join(projectRoot, "surface-audit.json");
await writeFile(surfaceContractPath, `${JSON.stringify({
  schemaVersion: "kpp-surface-contract-1.0",
  requireRenderManifest: true,
  tables: {
    widthDxa: 8400,
    columnWidthsDxaByTable: [
      [1500, 1900, 3000, 2000],
      [2200, 2900, 1500, 1800],
      [1700, 2900, 1700, 2100],
      [1700, 2900, 1700, 2100],
      [1500, 2600, 1800, 2500],
      [1800, 1900, 2300, 2400],
      [1400, 1800, 1900, 2100, 1200],
      [2400, 1900, 2600, 1500],
    ],
    headerFill: "#E8EEF5",
    bodyFill: "#FFFFFF",
    repeatHeader: true,
    headerAlignment: "center",
    bodyAlignment: "left",
    bodyLine: { line: "365", lineRule: "auto" },
    allowZebraStriping: false,
  },
  svg: { allowOuterCanvasFill: false, bodyFill: "#FFFFFF", rowRoles: ["work-package-row", "raci-row"], allowZebraStriping: false },
  render: { requirePages: 8 },
}, null, 2)}\n`, "utf8");
await runPythonAudit(SURFACE_AUDITOR, [docxPath, "--contract", surfaceContractPath, "--svg-dir", join(projectRoot, "figures"), "--figure-manifest-dir", join(projectRoot, "figures"), "--render-manifest", result.rendered.manifestPath, "--out", surfaceAuditPath]);
const surfaceAudit = JSON.parse(await readFile(surfaceAuditPath, "utf8")) as { status: string; findings: unknown[] };
if (surfaceAudit.status !== "PASS") throw new Error(`complex proposal surface audit did not pass: ${JSON.stringify(surfaceAudit.findings)}`);

const visualContractPath = join(projectRoot, "visual-contract.json");
const visualAuditPath = join(projectRoot, "visual-audit.json");
await writeFile(visualContractPath, `${JSON.stringify({
  schemaVersion: "kpp-rendered-visual-contract-1.0",
  requireRenderManifest: true,
  visual: {
    safeMarginsPt: { left: 72, right: 72, top: 36, bottom: 36 },
    textImageOverlapArea: 4,
    minPageDensity: 0.10,
    maxPageDensity: 0.82,
      requiredText: [
        { page: 1, text: "지역돌봄 데이터 연계 실증 제안" },
        { page: 2, text: "요구사항은 현장 적용성" },
        { page: 3, text: "운영은 범위 합의" },
        { page: 4, text: "동의 목적을 분리" },
        { page: 5, text: "100일 계획은" },
        { page: 6, text: "선정 논리는" },
        { page: 7, text: "성과지표는" },
        { page: 8, text: "다음 회의에서는" },
      ],
      forbiddenText: [
        { page: 2, region: "top", text: "요구사항과 검증근거의 교차표" },
        { page: 3, region: "top", text: "운영 모델과 책임 인계" },
        { page: 4, region: "top", text: "개인정보·안전 통제 설계" },
        { page: 5, region: "top", text: "100일 실행 로드맵" },
        { page: 6, region: "top", text: "대안 비교와 선정 논리" },
        { page: 7, region: "top", text: "성과평가와 중단 관문" },
        { page: 8, region: "top", text: "다음 협의에서 결정할 항목" },
      ],
  },
  frontier: {
    maxConsecutiveSameSurface: 3,
    requiredSurfaceTypes: ["figure", "mixed", "table"],
    requiredFigureFamilies: ["svg-academic-framework", "svg-raci-matrix", "svg-gantt"],
  },
}, null, 2)}\n`, "utf8");
await runPythonAudit(VISUAL_AUDITOR, [managedPdfPath, "--pages-dir", join(projectRoot, "rendered", "current"), "--svg-dir", join(projectRoot, "figures"), "--contract", visualContractPath, "--architecture", join(projectRoot, "content", "page-architecture.json"), "--figure-manifest", join(projectRoot, "figures", "build-figure-manifest.json"), "--render-manifest", result.rendered.manifestPath, "--out", visualAuditPath]);
const visualAudit = JSON.parse(await readFile(visualAuditPath, "utf8")) as { status: string; findings: unknown[]; humanReviewRequired: boolean };
if (visualAudit.status !== "PASS") throw new Error(`complex proposal visual audit did not pass: ${JSON.stringify(visualAudit.findings)}`);

const architecture = JSON.parse(await readFile(join(projectRoot, "content", "page-architecture.json"), "utf8")) as { pages: unknown[] };
const comparisonReportPath = join(outputRoot, "comparison-report.md");
await writeFile(comparisonReportPath, `# 복합 제안서 재검증 비교 보고서

## 범위

이 산출물은 기존 약국 민간협력 제안서의 재렌더링이 아니라, 동일한 스킬로 새롭게 생성한 익명 합성 **지역돌봄 데이터 연계 실증 제안**이다. 8쪽, Word-native 표 8개, 결정론적 도식 8개를 사용해 요구사항·근거·책임·운영·안전·선정·중단 관문을 함께 검증했다.

## 전후 및 결함 재현

| 항목 | 이전 약국 산출물 | 이번 복합 산출물 |
|---|---|---|
| 표 고정성 | 표가 고정되었다는 독립 geometry 증거 부족 | 전체 표 폭·그리드·셀 폭·fixed layout·반복 헤더를 surface audit로 확인 |
| 도식 텍스트 가림 | 페이지 스크린샷에서 connector label이 node fill에 가려질 수 있었음 | connector가 중간 node를 우회하고, 직접 연결 label도 node 위 clear band로 이동 |
| 시각 QA | 구조/렌더 PASS와 실제 시각 점검이 분리되지 않음 | PDF 좌표·PNG 비율·SVG text box·text/image overlap·frontier 반복을 독립 감사; 사람 검토 체크리스트 유지 |
| 범위 | 약국 제안서 단일 주제 | 다른 주제의 8쪽 복합 private-partnership fixture로 재현성 검증 |

## 기술 결과

- structural audit: PASS
- surface audit: PASS
- rendered visual audit: PASS (humanReviewRequired=true)
- publication status: BLOCKED_PENDING_NAMED_HUMAN_APPROVAL

## 사람 검토가 아직 필요한 이유

자동 게이트는 좌표·구조·재현성을 증명하지만, 제출기관의 실제 문체 적합성, 표의 업무적 충분성, 인쇄물에서의 의미 전달, 외부 공개 승인까지 대신하지 않는다. 따라서 이 패키지는 보고서 **검토 후보**이지 제출 승인본이 아니다.
`, "utf8");
await writeFile(join(outputRoot, "exemplar-report.json"), `${JSON.stringify({
  schemaVersion: "1.0.0",
  artifactStatus: "review_candidate",
  publicationStatus: "BLOCKED_PENDING_NAMED_HUMAN_APPROVAL",
  projectId: "community-care-data-pilot-review",
  documentMode: "private_partnership",
  pageArchitectureCount: architecture.pages.length,
  managedRenderPageCount: result.rendered.pdfPages,
  auditStatus: result.audit.report.status,
  auditFindingCount: result.audit.report.findings.length,
  surfaceAudit: { path: surfaceAuditPath, sha256: await sha256File(surfaceAuditPath), status: surfaceAudit.status },
  visualAudit: { path: visualAuditPath, sha256: await sha256File(visualAuditPath), status: visualAudit.status, humanReviewRequired: visualAudit.humanReviewRequired },
  comparisonReport: { path: comparisonReportPath, sha256: await sha256File(comparisonReportPath) },
  artifacts: {
    docx: { path: docxPath, sha256: await sha256File(docxPath), bytes: (await stat(docxPath)).size },
    managedPdf: { path: managedPdfPath, sha256: await sha256File(managedPdfPath), bytes: (await stat(managedPdfPath)).size },
    audit: { path: result.audit.auditPath, sha256: await sha256File(result.audit.auditPath), bytes: (await stat(result.audit.auditPath)).size },
  },
  residualWarnings: [
    "실제 기관·인물·연락처·주소·예산·운영실적을 포함하지 않은 익명 합성 검토본이다.",
    "대상 범위, 비용, 담당자, 보관기간, 착수일은 pending_consultation이다.",
    "기술감사 PASS는 사람의 문서 승인 또는 외부 공개 승인이 아니다.",
  ],
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputRoot, projectRoot, reviewRoot, docxPath, managedPdfPath, auditPath: result.audit.auditPath, surfaceAuditPath, visualAuditPath, comparisonReportPath, pages: result.rendered.pdfPages }));

async function runPythonAudit(script: string, args: string[]): Promise<void> {
  try {
    await execFile("python3", [script, ...args], { maxBuffer: 16 * 1024 * 1024 });
  } catch {
    // The audit writes its JSON before returning code 2 for BLOCKED; callers
    // read that receipt and decide whether to stop.
  }
}
