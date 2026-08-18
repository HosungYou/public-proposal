import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { advanceProject, executeFile, initializeProject, sha256File, verifyProjectState, writeReceipt } from "@longtable/kpp-core";
import { R08_TOKEN_PROFILE_SHA256, renderFigureArtifact, type GanttFigureSpec } from "@longtable/kpp-renderers";
import { afterEach, describe, expect, it } from "vitest";
import { buildProject } from "../src/commands/build.js";
import { auditProject } from "../src/commands/audit.js";
import { approveProject } from "../src/commands/approve.js";
import { releaseProject } from "../src/commands/release.js";
import { renderProject } from "../src/commands/render.js";

const TEMPLATE = resolve("workers/docx-python/assets/Korean Public Proposal A4 v1.docx");

describe("verified proposal release flow", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => {
      await makeWritable(root);
      await rm(root, { recursive: true, force: true });
    }));
  });

  it("rejects an existing locked input as an output before the worker and preserves its bytes", async () => {
    const fixture = await createContentApprovedProject(roots);
    const lockedPath = join(fixture.root, "content", "page-plan.json");
    const before = await sha256File(lockedPath);
    const request = JSON.parse(await readFile(fixture.requestPath, "utf8")) as {
      output: { manifestPath: string };
    };
    request.output.manifestPath = lockedPath;
    await writeFile(fixture.requestPath, `${JSON.stringify(request)}\n`);

    await expect(buildProject(fixture.root, { requestPath: fixture.requestPath }))
      .rejects.toMatchObject({ code: "KPP_BUILD_OUTPUT_EXISTS" });
    expect(await sha256File(lockedPath)).toBe(before);
    expect((await verifyProjectState(fixture.root)).state).toBe("CONTENT_APPROVED");
    await expect(access(join(fixture.root, "receipts", "build.json"))).rejects.toBeDefined();
  });

  it("builds a locked request, renders it, and blocks approval after a blocked technical audit", async () => {
    const fixture = await createContentApprovedProject(roots);
    const built = await buildProject(fixture.root, { requestPath: fixture.requestPath });
    expect(built.state).toBe("BUILT");
    expect((await stat(built.docxPath)).size).toBeGreaterThan(1_000);
    const rendered = await renderProject(fixture.root, { docxPath: built.docxPath });
    const blocked = await auditProject(fixture.root, {
      docxPath: built.docxPath,
      buildManifestPath: built.manifestPath,
      renderManifestPath: rendered.manifestPath,
      figures: [],
    });
    expect(blocked).toMatchObject({ state: "RENDERED", report: { status: "BLOCKED", humanBoundary: "TECHNICAL_GATE_ONLY" } });
    await expect(approveProject(fixture.root, {
      approvedBy: "제출책임자",
      auditPath: blocked.auditPath,
    })).rejects.toMatchObject({ code: "KPP_APPROVAL_STATE" });
    await expect(access(join(fixture.root, "receipts", "approval.json"))).rejects.toBeDefined();
    const releaseOutput = join(fixture.root, "blocked-release-output");
    await expect(releaseProject(fixture.root, {
      approvalPath: join(fixture.root, "receipts", "approval.json"),
      outputParent: releaseOutput,
    })).rejects.toMatchObject({ code: "KPP_RELEASE_STATE" });
    await expect(access(releaseOutput)).rejects.toBeDefined();
  }, 60_000);

  it("runs managed build, real render, file-backed PASS audit, human approval, and immutable release", async () => {
    const fixture = await createContentApprovedProject(roots, true);
    const built = await buildProject(fixture.root, { requestPath: fixture.requestPath });
    expect((await verifyProjectState(fixture.root)).state).toBe("BUILT");
    const rendered = await renderProject(fixture.root, { docxPath: built.docxPath });
    expect((await verifyProjectState(fixture.root)).state).toBe("RENDERED");
    const audited = await auditProject(fixture.root, {
      docxPath: built.docxPath,
      buildManifestPath: built.manifestPath,
      renderManifestPath: rendered.manifestPath,
      figures: fixture.auditFigures,
    });
    expect(audited.report).toMatchObject({ status: "PASS", humanBoundary: "TECHNICAL_GATE_ONLY" });
    expect(audited.state).toBe("AUDITED");
    expect((await verifyProjectState(fixture.root)).state).toBe("AUDITED");
    const approved = await approveProject(fixture.root, { approvedBy: "제출책임자", auditPath: audited.auditPath });
    expect(approved.state).toBe("HUMAN_APPROVED");
    const output = join(fixture.root, "release-output");
    const released = await releaseProject(fixture.root, { approvalPath: approved.receiptPath, outputParent: output });
    expect(released.state).toBe("RELEASED");
    expect((await verifyProjectState(fixture.root)).state).toBe("RELEASED");
    const manifestText = await readFile(released.manifestPath, "utf8");
    expect(manifestText).not.toContain(fixture.root);
    expect(manifestText).not.toContain("sourcePath");
    expect(await listedFiles(released.releasePath)).toEqual(expect.arrayContaining([
      "submission/document.docx",
      "submission/proposal.pdf",
      "audit/audit.json",
      "release.json",
    ]));
  }, 60_000);

  it("blocks a semantic SVG paired with unrelated locked raster bytes before approval", async () => {
    const fixture = await createContentApprovedProject(roots, true, true);
    const built = await buildProject(fixture.root, { requestPath: fixture.requestPath });
    const rendered = await renderProject(fixture.root, { docxPath: built.docxPath });

    const audited = await auditProject(fixture.root, {
      docxPath: built.docxPath,
      buildManifestPath: built.manifestPath,
      renderManifestPath: rendered.manifestPath,
      figures: fixture.auditFigures,
    });

    expect(audited.state).toBe("RENDERED");
    expect(audited.report.status).toBe("BLOCKED");
    expect(audited.report.findings.map((finding) => finding.code)).toContain("KPP_DESIGN_FIGURE_MEDIA_LINEAGE");
    await expect(approveProject(fixture.root, {
      approvedBy: "제출책임자",
      auditPath: audited.auditPath,
    })).rejects.toMatchObject({ code: "KPP_APPROVAL_STATE" });
  }, 60_000);

  it("blocks duplicate semantic figure input that omits another build figure", async () => {
    const fixture = await createContentApprovedProject(roots, true, false, 2);
    const built = await buildProject(fixture.root, { requestPath: fixture.requestPath });
    const rendered = await renderProject(fixture.root, { docxPath: built.docxPath });
    const [figureA] = fixture.auditFigures;
    expect(figureA).toBeDefined();

    const audited = await auditProject(fixture.root, {
      docxPath: built.docxPath,
      buildManifestPath: built.manifestPath,
      renderManifestPath: rendered.manifestPath,
      figures: [figureA!, figureA!],
    });

    expect(audited.state).toBe("RENDERED");
    expect(audited.report.status).toBe("BLOCKED");
    expect(audited.report.findings.map((finding) => finding.code)).toContain("KPP_DESIGN_FIGURE_MEDIA_LINEAGE");
    await expect(approveProject(fixture.root, {
      approvedBy: "제출책임자",
      auditPath: audited.auditPath,
    })).rejects.toMatchObject({ code: "KPP_APPROVAL_STATE" });
    await expect(access(join(fixture.root, "receipts", "approval.json"))).rejects.toBeDefined();
    await expect(access(join(fixture.root, "release-output"))).rejects.toBeDefined();
  }, 60_000);

  it("rejects a BuildRequest body that is not the approved authoring response", async () => {
    const fixture = await createContentApprovedProject(roots);
    const request = JSON.parse(await readFile(fixture.requestPath, "utf8")) as { contentBlocks: { paragraphs: { text: string }[] }[] };
    request.contentBlocks[0]!.paragraphs[0]!.text = "승인되지 않은 문장";
    await writeFile(fixture.requestPath, `${JSON.stringify(request)}\n`);
    await expect(buildProject(fixture.root, { requestPath: fixture.requestPath }))
      .rejects.toMatchObject({ code: "KPP_BUILD_CONTENT_UNBOUND" });
    await expect(access(join(fixture.root, "receipts", "build.json"))).rejects.toBeDefined();
  });

  it("rejects unapproved headings, table captions, or figure IDs before the worker publishes", async () => {
    const fixture = await createContentApprovedProject(roots);
    const request = JSON.parse(await readFile(fixture.requestPath, "utf8")) as {
      contentBlocks: { heading: string; tables: { caption: string }[]; figureIds: string[] }[];
    };
    request.contentBlocks[0]!.heading = "2. 승인되지 않은 연구 수행방법";
    request.contentBlocks[0]!.tables[0]!.caption = "표 2. 승인되지 않은 산출물";
    request.contentBlocks[0]!.figureIds = ["FIG-UNAPPROVED"];
    await writeFile(fixture.requestPath, `${JSON.stringify(request)}\n`);
    await expect(buildProject(fixture.root, { requestPath: fixture.requestPath }))
      .rejects.toMatchObject({ code: "KPP_BUILD_STRUCTURE_UNBOUND" });
    await expect(access(join(fixture.root, "receipts", "build.json"))).rejects.toBeDefined();
  });

  it("rejects an explicit worker protocol mismatch before publishing a build receipt", async () => {
    const fixture = await createContentApprovedProject(roots);
    const worker = join(fixture.root, "worker-mismatch.mjs");
    await writeFile(
      worker,
      "#!/usr/bin/env node\nif (process.argv[2] === '--protocol-version') process.stdout.write('2.0.0\\n'); else process.stdout.write('Python 3.13.0\\n');\n",
    );
    await chmod(worker, 0o755);

    await expect(buildProject(fixture.root, { requestPath: fixture.requestPath, pythonPath: worker }))
      .rejects.toMatchObject({ code: "PP_WORKER_PROTOCOL_MISMATCH" });
    await expect(access(join(fixture.root, "receipts", "build.json"))).rejects.toBeDefined();
  });

  it("rejects a managed manifest protocol mismatch without repository worker fallback", async () => {
    const fixture = await createContentApprovedProject(roots);
    const installRoot = join(fixture.root, ".public-proposal");
    const worker = join(installRoot, "worker", "bin", "python");
    await mkdir(join(installRoot, "worker", "bin"), { recursive: true });
    await writeFile(worker, "#!/usr/bin/env node\nprocess.stdout.write('1.0.0\\n');\n", { mode: 0o755 });
    const manifestPath = join(installRoot, "installation.json");
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: "1.0.0",
      packageVersion: "0.1.0",
      kppVersion: "0.2.1",
      longtableVersion: "0.1.72",
      pluginVersion: "0.1.0",
      workerProtocol: "1.0.0",
      installRoot,
      pluginManifestSha256: "sha256:plugin",
      bundleManifestSha256: "sha256:bundle",
      worker: { executable: worker, protocolVersion: "2.0.0", sha256: await sha256File(worker) },
      ownedPaths: [
        join(installRoot, "plugin"),
        join(installRoot, "marketplace"),
        join(installRoot, "codex-skills"),
        join(installRoot, "worker"),
      ],
      createdAt: "2026-08-18T00:00:00.000Z",
    })}\n`);
    const previousManifest = process.env.PUBLIC_PROPOSAL_INSTALLATION_MANIFEST;
    const previousWorker = process.env.KPP_WORKER_PATH;
    delete process.env.KPP_WORKER_PATH;
    process.env.PUBLIC_PROPOSAL_INSTALLATION_MANIFEST = manifestPath;
    try {
      await expect(buildProject(fixture.root, { requestPath: fixture.requestPath }))
        .rejects.toMatchObject({ code: "PP_WORKER_PROTOCOL_MISMATCH" });
      await expect(access(join(fixture.root, "receipts", "build.json"))).rejects.toBeDefined();
    } finally {
      if (previousManifest === undefined) {
        delete process.env.PUBLIC_PROPOSAL_INSTALLATION_MANIFEST;
      } else {
        process.env.PUBLIC_PROPOSAL_INSTALLATION_MANIFEST = previousManifest;
      }
      if (previousWorker === undefined) {
        delete process.env.KPP_WORKER_PATH;
      } else {
        process.env.KPP_WORKER_PATH = previousWorker;
      }
    }
  });

  it("releases only approval-bound allowlisted artifacts", async () => {
    const fixture = await createAuditedProject(roots);
    const approved = await approveProject(fixture.root, { approvedBy: "제출책임자", auditPath: fixture.auditPath });
    const output = join(fixture.root, "release-output");
    const released = await releaseProject(fixture.root, { approvalPath: approved.receiptPath, outputParent: output });
    expect(released.state).toBe("RELEASED");
    const manifestText = await readFile(released.manifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as { humanBoundary: string; files: { releasePath: string }[] };
    expect(manifest.humanBoundary).toBe("HUMAN_APPROVED");
    expect(manifest.files.map((file) => file.releasePath)).toEqual(expect.arrayContaining([
      "submission/document.docx",
      "submission/proposal.pdf",
      "submission/render-manifest.json",
      "audit/audit.json",
    ]));
    const members = await listedFiles(released.releasePath);
    expect(members).toContain("release.json");
    expect(members.some((path) => path.includes("sources/") || path.includes("receipts/") || path.includes(".omo/"))).toBe(false);
    expect(manifestText).not.toContain(fixture.root);
    expect(manifestText).not.toContain("sourcePath");
    expect(manifestText).not.toContain("receipts/");
    expect(manifestText).not.toContain(".omo/");
  });

  it("rejects a changed PDF after human approval without publishing or changing project state", async () => {
    const fixture = await createAuditedProject(roots);
    const approved = await approveProject(fixture.root, { approvedBy: "제출책임자", auditPath: fixture.auditPath });
    await writeFile(fixture.pdfPath, "%PDF-CHANGED\n");
    const output = join(fixture.root, "release-output");
    await expect(releaseProject(fixture.root, { approvalPath: approved.receiptPath, outputParent: output }))
      .rejects.toMatchObject({ code: "KPP_RELEASE_APPROVAL_STALE" });
    await expect(access(output)).rejects.toBeDefined();
    const project = await readFile(join(fixture.root, "kpp.project.yaml"), "utf8");
    expect(project).toContain("state: HUMAN_APPROVED");
  });

  it("invalidating a research source ledger invalidates later approval and release", async () => {
    const approvalFixture = await createAuditedProject(roots, true);
    await mutateResearchSourceLedger(approvalFixture.root);

    await expect(approveProject(approvalFixture.root, {
      approvedBy: "제출책임자",
      auditPath: approvalFixture.auditPath,
    })).rejects.toMatchObject({ code: "KPP_INPUT_RECEIPT_INVALID" });
    await expect(access(join(approvalFixture.root, "receipts", "approval.json"))).rejects.toBeDefined();

    const releaseFixture = await createAuditedProject(roots, true);
    const approved = await approveProject(releaseFixture.root, {
      approvedBy: "제출책임자",
      auditPath: releaseFixture.auditPath,
    });
    await mutateResearchSourceLedger(releaseFixture.root);
    const output = join(releaseFixture.root, "release-output");

    await expect(releaseProject(releaseFixture.root, {
      approvalPath: approved.receiptPath,
      outputParent: output,
    })).rejects.toMatchObject({ code: "KPP_INPUT_RECEIPT_INVALID" });
    await expect(access(output)).rejects.toBeDefined();
  });

  it("rejects a release output beneath a symlinked ancestor", async () => {
    const fixture = await createAuditedProject(roots);
    const approved = await approveProject(fixture.root, { approvedBy: "제출책임자", auditPath: fixture.auditPath });
    const physical = join(fixture.root, "physical-release-output");
    const linked = join(fixture.root, "linked-release-output");
    await mkdir(physical);
    await symlink(physical, linked, "dir");

    await expect(releaseProject(fixture.root, {
      approvalPath: approved.receiptPath,
      outputParent: join(linked, "nested"),
    })).rejects.toMatchObject({ code: "KPP_RELEASE_OUTPUT_SYMLINK" });
    await expect(access(join(physical, "nested"))).rejects.toBeDefined();
  });
});

async function createContentApprovedProject(
  roots: string[],
  withFigure = false,
  unrelatedFigure = false,
  figureCount = 1,
): Promise<{
  readonly root: string;
  readonly requestPath: string;
  readonly auditFigures: readonly { readonly specPath: string; readonly svgPath: string; readonly manifestPath: string }[];
}> {
  const root = await mkdtemp(join(tmpdir(), "kpp-release-build-"));
  roots.push(root);
  await initializeProject(root, { projectId: "release-build-fixture" });
  const semanticFigures: GanttFigureSpec[] = [{
    figureId: "FIG-GANTT-01",
    family: "gantt",
    title: "100일 연구 수행계획",
    caption: "그림 1. 연구 수행계획과 검토 관문",
    evidenceIds: ["EV-01"],
    claimIds: ["CLM-01"],
    inputKind: "semantic",
    tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    data: {
      kind: "time_axis",
      periods: ["D1", "D50", "D100"],
      workPackages: [{ id: "WP1", label: "현황 진단", owner: "연구책임자", start: 0, end: 2, evidenceIds: ["EV-01"] }],
      milestones: [{ id: "M1", label: "최종 검토", period: 2, owner: "발주기관", evidenceIds: ["EV-01"], acceptance: "승인" }],
    },
  }];
  if (figureCount > 1) {
    semanticFigures.push({
      ...semanticFigures[0]!,
      figureId: "FIG-GANTT-02",
      title: "100일 검증 게이트",
      caption: "그림 2. 검증 게이트와 인수 기준",
    });
  }
  const figuresToBuild = withFigure ? semanticFigures.slice(0, figureCount) : [];
  const plannedFigures = figuresToBuild.map((semanticFigure, index) => ({
    figureId: semanticFigure.figureId,
    requirementId: "REQ-01",
    pageId: "P-01",
    title: semanticFigure.title,
    intent: "schedule",
    dataShape: "time_axis",
    decisionTask: index === 0 ? "연구 단계와 검토 관문을 확인한다." : "검증 게이트와 인수 기준을 확인한다.",
    claimIds: ["CLM-01"],
    evidenceIds: ["EV-01"],
    family: "gantt",
    renderer: "svg-gantt",
  }));
  const pagePlan = {
    schemaVersion: "1.0.0",
    pages: [{ pageId: "P-01", requirementId: "REQ-01", pageRole: "research_method", surfaceTemplateId: "r08-research-method-v1", claimIds: ["CLM-01"], figureSpecs: plannedFigures }],
  };
  const evidenceLedger = {
    schemaVersion: "1.0.0",
    claims: [{ claimId: "CLM-01", status: "verified", evidenceIds: ["EV-01"] }],
    bindings: [{ evidenceId: "EV-01", sourcePath: join(root, "evidence", "source.txt"), sourceSha256: "a".repeat(64), scope: "합성 검증 근거", claimIds: ["CLM-01"], targetRequirementId: "REQ-01", targetPageId: "P-01", targetPageRole: "research_method" }],
  };
  const profile = lockedProfile();
  await mkdir(join(root, "content"), { recursive: true });
  await mkdir(join(root, "evidence"), { recursive: true });
  await mkdir(join(root, "figures"), { recursive: true });
  await writeFile(join(root, "content", "page-plan.json"), `${JSON.stringify(pagePlan)}\n`);
  await writeFile(join(root, "evidence", "evidence-ledger.json"), `${JSON.stringify(evidenceLedger)}\n`);
  await writeFile(join(root, "evidence", "source.txt"), "synthetic source\n");
  await writeFile(join(root, "figures", "design-profile.json"), `${JSON.stringify(profile)}\n`);
  const auditFigures: { specPath: string; svgPath: string; manifestPath: string }[] = [];
  const embeddedFigures: Record<string, unknown>[] = [];
  for (const [index, semanticFigure] of figuresToBuild.entries()) {
    const imagePath = join(root, "figures", `${semanticFigure.figureId}.png`);
    const semantic = await renderFigureArtifact(semanticFigure);
    const specPath = join(root, "figures", `${semanticFigure.figureId}.spec.json`);
    const svgPath = join(root, "figures", `${semanticFigure.figureId}.svg`);
    const manifestPath = join(root, "figures", `${semanticFigure.figureId}.render.json`);
    await writeFile(specPath, `${JSON.stringify(semanticFigure)}\n`);
    await writeFile(svgPath, semantic.svg);
    await writeFile(manifestPath, `${JSON.stringify(semantic.manifest)}\n`);
    if (unrelatedFigure && index === 0) {
      await copyFile(resolve("fixtures/valid/r08-reference/ooxml/word/media/image1.png"), imagePath);
    } else {
      await rasterizeSvg(svgPath, join(root, "figures"));
    }
    embeddedFigures.push({
      figureId: semanticFigure.figureId,
      requirementId: "REQ-01",
      pageId: "P-01",
      claimIds: ["CLM-01"],
      renderer: "svg-gantt",
      path: imagePath,
      sha256: await sha256File(imagePath),
      format: "png",
      caption: semanticFigure.caption,
      evidenceIds: ["EV-01"],
      widthDxa: 7200,
    });
    auditFigures.push({ specPath, svgPath, manifestPath });
  }
  const approvedText = "공식 근거와 현장 검증을 연결하여 연구 결과의 활용 가능성을 높인다.";
  const tables = [{ tableId: "TBL-01", caption: "표 1. 연구 단계별 산출물", headers: ["단계", "산출물"], rows: [["착수", "연구설계서"]], columnWidthsDxa: [2400, 6000] }];
  const responsePath = join(root, "content", "authoring-response.json");
  const structurePath = join(root, "content", "build-structure.json");
  const figureManifestPath = join(root, "figures", "build-figure-manifest.json");
  const figureManifest = { schemaVersion: "1.0.0", figures: embeddedFigures };
  await writeFile(responsePath, `${JSON.stringify({ schemaVersion: "1.0.0", blocks: [{ pageId: "P-01", claimIds: ["CLM-01"], evidenceIds: ["EV-01"], status: "provisional", text: approvedText, evaluatorAnswer: "합성 평가자 답변", pendingBlankFieldIds: [] }] })}\n`);
  const figureIds = figuresToBuild.map((figure) => figure.figureId);
  await writeFile(structurePath, `${JSON.stringify({ schemaVersion: "1.0.0", blocks: [{ pageId: "P-01", heading: "1. 연구 수행방법", tables, figureIds }] })}\n`);
  await writeFile(figureManifestPath, `${JSON.stringify(figureManifest)}\n`);
  await advanceToContentApproved(
    root,
    [responsePath, structurePath],
    withFigure
      ? [
          figureManifestPath,
          ...embeddedFigures.map((figure) => figure.path as string),
          ...auditFigures.flatMap((figure) => [figure.specPath, figure.svgPath, figure.manifestPath]),
        ]
      : [figureManifestPath],
  );
  const request = {
    schemaVersion: "1.0.0",
    projectId: "release-build-fixture",
    template: { assetId: "korean-public-proposal-a4-v1", path: TEMPLATE, sha256: await sha256File(TEMPLATE) },
    pagePlan,
    evidenceLedger,
    contentBlocks: [{ pageId: "P-01", heading: "1. 연구 수행방법", paragraphs: [{ text: approvedText, claimIds: ["CLM-01"], evidenceIds: ["EV-01"] }], tables, figureIds }],
    figureManifest,
    surfaceProfile: profile,
    output: { docxPath: join(root, "build", "proposal.docx"), manifestPath: join(root, "build", "build-manifest.json") },
  };
  const requestPath = join(root, "build", "build-request.json");
  await mkdir(join(root, "build"), { recursive: true });
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  return { root, requestPath, auditFigures };
}

async function rasterizeSvg(svgPath: string, outputDirectory: string): Promise<void> {
  const profile = await mkdtemp(join(tmpdir(), "kpp-figure-raster-profile-"));
  try {
    await executeFile("/Applications/LibreOffice.app/Contents/MacOS/soffice", [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--convert-to",
      "png:draw_png_Export",
      "--outdir",
      outputDirectory,
      svgPath,
    ], { timeoutMs: 120_000 });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

async function createAuditedProject(
  roots: string[],
  researchRequired = false,
): Promise<{ readonly root: string; readonly auditPath: string; readonly pdfPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "kpp-release-audited-"));
  roots.push(root);
  await initializeProject(root, {
    projectId: "release-fixture",
    proposalClass: researchRequired ? "research_service" : "general_procurement",
  });
  const researchReceiptPath = researchRequired ? await createResearchLock(root) : undefined;
  await advanceToContentApproved(root, [], [], researchReceiptPath);
  const generation = join(root, ".kpp-build-0123456789abcdef", "generations", "fixture");
  await mkdir(generation, { recursive: true });
  const docxPath = join(generation, "document.docx");
  const buildManifestPath = join(generation, "manifest.json");
  await copyFile(TEMPLATE, docxPath);
  await writeFile(buildManifestPath, "{\"synthetic\":true}\n");
  await writeStage(root, "BUILT", [docxPath, buildManifestPath]);
  const rendered = join(root, "rendered", "generations", "fixture");
  await mkdir(rendered, { recursive: true });
  const pdfPath = join(rendered, "proposal.pdf");
  const pagePath = join(rendered, "page-0001.png");
  const renderManifestPath = join(rendered, "render.json");
  await writeFile(pdfPath, "%PDF-1.4\nsynthetic\n");
  await writeFile(pagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  await writeFile(renderManifestPath, "{\"synthetic\":true}\n");
  await writeStage(root, "RENDERED", [docxPath, buildManifestPath, renderManifestPath, pdfPath, pagePath]);
  const auditPath = join(root, "audit", "audit.json");
  const geometryPath = join(root, "audit", "docx-geometry.json");
  await mkdir(join(root, "audit"), { recursive: true });
  await writeFile(auditPath, "{\"schemaVersion\":\"1\",\"status\":\"PASS\",\"findings\":[],\"artifacts\":[],\"humanBoundary\":\"TECHNICAL_GATE_ONLY\"}\n");
  await writeFile(geometryPath, "{\"synthetic\":true}\n");
  await writeStage(root, "AUDITED", [auditPath, geometryPath]);
  return { root, auditPath, pdfPath };
}

async function advanceToContentApproved(
  root: string,
  contentApprovalFiles: string[] = [],
  designLockFiles: string[] = [],
  researchReceiptPath?: string,
): Promise<void> {
  for (const stage of ["SOURCE_LOCKED", "REQUIREMENTS_LOCKED", "EVIDENCE_LOCKED", "DESIGN_LOCKED", "CONTENT_APPROVED"] as const) {
    const artifact = join(root, "receipt-fixtures", `${stage}.txt`);
    await mkdir(join(root, "receipt-fixtures"), { recursive: true });
    await writeFile(artifact, `${stage}\n`);
    await writeStage(root, stage, stage === "CONTENT_APPROVED"
      ? [artifact, ...contentApprovalFiles]
      : stage === "DESIGN_LOCKED"
        ? [artifact, ...designLockFiles]
        : [artifact], stage === "CONTENT_APPROVED" && researchReceiptPath !== undefined
      ? [await sha256File(researchReceiptPath)]
      : []);
  }
}

async function writeStage(
  root: string,
  stage: "SOURCE_LOCKED" | "REQUIREMENTS_LOCKED" | "EVIDENCE_LOCKED" | "DESIGN_LOCKED" | "CONTENT_APPROVED" | "BUILT" | "RENDERED" | "AUDITED",
  files: string[],
  extraInputReceiptHashes: readonly string[] = [],
): Promise<void> {
  const filenames = { SOURCE_LOCKED: "source-lock.json", REQUIREMENTS_LOCKED: "requirements-lock.json", EVIDENCE_LOCKED: "evidence-lock.json", DESIGN_LOCKED: "design-lock.json", CONTENT_APPROVED: "content-approval.json", BUILT: "build.json", RENDERED: "render.json", AUDITED: "audit.json" } as const;
  const ordered = ["SOURCE_LOCKED", "REQUIREMENTS_LOCKED", "EVIDENCE_LOCKED", "DESIGN_LOCKED", "CONTENT_APPROVED", "BUILT", "RENDERED", "AUDITED"] as const;
  const index = ordered.indexOf(stage);
  const predecessor = index > 0 ? join(root, "receipts", filenames[ordered[index - 1]!]) : undefined;
  await writeReceipt({
    stage,
    files,
    inputReceiptHashes: [
      ...(predecessor === undefined ? [] : [await sha256File(predecessor)]),
      ...extraInputReceiptHashes,
    ],
    output: join(root, "receipts", filenames[stage]),
  });
  await advanceProject(root, stage);
}

async function createResearchLock(root: string): Promise<string> {
  const researchRoot = join(root, "evidence", "research-lock");
  await mkdir(researchRoot, { recursive: true });
  const artifacts = {
    researchSpecification: join(researchRoot, "research-specification.json"),
    citationSlotMatrix: join(researchRoot, "citation-slot-matrix.json"),
    sourceLedger: join(researchRoot, "source-ledger.json"),
    claimTransferLedger: join(researchRoot, "claim-transfer-ledger.json"),
  };
  await Promise.all([
    writeFile(artifacts.researchSpecification, '{"researchQuestions":["fixture"]}\n'),
    writeFile(artifacts.citationSlotMatrix, '{"slots":[{"slotId":"CITE-1","required":true}]}\n'),
    writeFile(artifacts.sourceLedger, '{"sources":[{"sourceId":"SRC-1"}]}\n'),
    writeFile(artifacts.claimTransferLedger, '{"transfers":[{"claimId":"CLAIM-1","decision":"bounded"}]}\n'),
  ]);
  const handoffPath = join(researchRoot, "handoff.json");
  await writeFile(handoffPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    longtableVersion: "0.1.72",
    projectId: "release-fixture",
    proposalClass: "research_service",
    researchSpecificationPath: "evidence/research-lock/research-specification.json",
    researchSpecificationSha256: await sha256File(artifacts.researchSpecification),
    citationSlotMatrixPath: "evidence/research-lock/citation-slot-matrix.json",
    citationSlotMatrixSha256: await sha256File(artifacts.citationSlotMatrix),
    sourceLedgerPath: "evidence/research-lock/source-ledger.json",
    sourceLedgerSha256: await sha256File(artifacts.sourceLedger),
    claimTransferLedgerPath: "evidence/research-lock/claim-transfer-ledger.json",
    claimTransferLedgerSha256: await sha256File(artifacts.claimTransferLedger),
    openRequiredCheckpoints: [],
    createdAt: "2026-08-18T00:00:00.000Z",
  }, null, 2)}\n`);
  const result = await import("@longtable/kpp-core");
  return (await result.importResearchLock(root, handoffPath, "0.1.72")).receiptPath;
}

async function mutateResearchSourceLedger(root: string): Promise<void> {
  const sourceLedger = join(root, "evidence", "research-lock", "source-ledger.json");
  const bytes = await readFile(sourceLedger);
  bytes[0] = bytes[0] === 0x7b ? 0x5b : 0x7b;
  await writeFile(sourceLedger, bytes);
}

function lockedProfile() {
  return { schemaVersion: "1.0.0", profileId: "synthetic-r08-locked", status: "locked", typography: { headingFont: "Noto Sans CJK KR", navigationFont: "Noto Sans CJK KR", bodyFont: "Noto Serif CJK KR", bodyPoint: 9.3, lineHeight: 1.52, alignment: "justified", characterSpacingPt: -0.2, precisionPolicy: "acknowledged_half_point_quantization" }, table: { widthDxa: 8400, cellMarginDxa: { top: 80, start: 100, bottom: 80, end: 100 }, borderSizeEighthPt: 4 } };
}

async function listedFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? listedFiles(join(root, entry.name), join(prefix, entry.name)) : [join(prefix, entry.name)]))).flat().sort();
}

async function makeWritable(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(path);
    await chmod(path, entry.isDirectory() ? 0o700 : 0o600).catch(() => undefined);
  }
  await chmod(root, 0o700).catch(() => undefined);
}
