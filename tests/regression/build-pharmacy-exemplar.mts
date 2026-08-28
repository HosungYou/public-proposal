import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256File } from "@longtable/kpp-core";
import { materializePharmacyPartnership, runPharmacyBuildRenderAudit } from "./pharmacy-fixture.js";

const outputRoot = resolve(process.argv[2] ?? ".superpowers/sdd/2026-08-20-kpp-vnext-document-architecture/evidence/pharmacy-private-partnership");
const projectRoot = join(outputRoot, "project");
const reviewRoot = join(outputRoot, "review");
const fixture = await materializePharmacyPartnership("valid", projectRoot);
const result = await runPharmacyBuildRenderAudit(fixture);
if (result.audit.state !== "AUDITED" || result.audit.report.status !== "PASS") {
  throw new Error(`pharmacy exemplar audit did not pass: ${JSON.stringify(result.audit.report.findings)}`);
}
await mkdir(join(reviewRoot, "managed-pages"), { recursive: true });
const docxPath = join(reviewRoot, "proposal.docx");
const managedPdfPath = join(reviewRoot, "managed-proposal.pdf");
await copyFile(result.built.docxPath, docxPath);
await copyFile(result.rendered.pdfPath, managedPdfPath);
for (const page of result.rendered.pageImages) {
  await copyFile(page.path, join(reviewRoot, "managed-pages", `page-${String(page.page).padStart(4, "0")}.png`));
}
const architecture = JSON.parse(await readFile(join(projectRoot, "content", "page-architecture.json"), "utf8")) as { pages: unknown[] };
await writeFile(join(outputRoot, "exemplar-report.json"), `${JSON.stringify({
  schemaVersion: "1.0.0",
  artifactStatus: "review_candidate",
  publicationStatus: "BLOCKED_PENDING_NAMED_HUMAN_APPROVAL",
  projectId: "anon-pharmacy-partnership-review",
  documentMode: "private_partnership",
  pageArchitectureCount: architecture.pages.length,
  managedRenderPageCount: result.rendered.pdfPages,
  auditStatus: result.audit.report.status,
  auditFindingCount: result.audit.report.findings.length,
  artifacts: {
    docx: { path: docxPath, sha256: await sha256File(docxPath), bytes: (await stat(docxPath)).size },
    managedPdf: { path: managedPdfPath, sha256: await sha256File(managedPdfPath), bytes: (await stat(managedPdfPath)).size },
    audit: { path: result.audit.auditPath, sha256: await sha256File(result.audit.auditPath), bytes: (await stat(result.audit.auditPath)).size },
  },
  residualWarnings: [
    "기관·인물·연락처·주소·금액은 모두 익명 또는 미기재 상태다.",
    "대상 수, 기간, 비용, 개인정보 처리범위, 담당자, 착수일은 pending_consultation이다.",
    "기술감사 PASS는 사람의 문서 승인 또는 외부 공개 승인이 아니다."
  ]
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputRoot, projectRoot, reviewRoot, docxPath, managedPdfPath, auditPath: result.audit.auditPath, pages: result.rendered.pdfPages }));
