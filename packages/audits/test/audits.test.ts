import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import {
  auditDocxArtifacts,
  auditFigureArtifacts,
  auditProposal,
  auditReleaseReadiness,
  auditRenderArtifacts,
} from "../src/index.js";
import {
  advanceProject,
  initializeProject,
  sha256File,
  writeReceipt,
} from "@kpp/core";
import {
  R08_TOKEN_PROFILE_SHA256,
  renderFigureArtifact,
  type GanttFigureSpec,
} from "@kpp/renderers";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("artifact-backed proposal audits", () => {
  test("blocks a DOCX geometry report whose bytes do not match the inspected DOCX", async () => {
    const fixture = await docxFixture();
    await writeFile(fixture.docxPath, "tampered after geometry inspection", "utf8");

    const result = await auditDocxArtifacts(fixture);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_SOURCE_DOCX_LINEAGE");
  });

  test("recomputes PDF, page image, and searchable Korean text lineage from real files", async () => {
    const fixture = await renderFixture();

    const passed = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });
    expect(passed.status).toBe("PASS");
    expect(passed.artifacts.map((artifact) => artifact.sha256)).toContain(await sha256File(fixture.pdfPath));

    await writeFile(fixture.pagePath, "stale-page", "utf8");
    const blocked = await auditRenderArtifacts(fixture.manifestPath, { trustedPdftotextPath: fixture.extractorPath });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.findings.map((finding) => finding.code)).toContain("KPP_DESIGN_SURFACE_LINEAGE");
  });

  test("does not execute a pdftotext path supplied only by an untrusted render manifest", async () => {
    const fixture = await renderFixture();

    const result = await auditRenderArtifacts(fixture.manifestPath);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RENDER_EXTRACTOR_UNTRUSTED");
  });

  test("requires structural Gantt roles in the actual deterministic SVG", async () => {
    const fixture = await figureFixture();
    expect((await auditFigureArtifacts([fixture])).status).toBe("PASS");

    const svg = await readFile(fixture.svgPath, "utf8");
    await writeFile(fixture.svgPath, svg.replaceAll('data-kpp-role="duration-bar"', 'data-kpp-role="plain-box"'), "utf8");
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as Record<string, unknown>;
    const output = manifest.output as Record<string, unknown>;
    output.sha256 = await sha256File(fixture.svgPath);
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const blocked = await auditFigureArtifacts([fixture]);
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.findings.map((finding) => finding.code)).toContain("KPP_DESIGN_GANTT_STRUCTURE");
  });

  test("blocks a stale predecessor receipt even when every receipt says PASS", async () => {
    const root = await renderedProjectFixture();
    const receipt = join(root, "receipts", "render.json");
    const parsed = JSON.parse(await readFile(receipt, "utf8")) as { inputReceiptHashes: string[] };
    parsed.inputReceiptHashes = ["0".repeat(64)];
    await writeFile(receipt, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const result = await auditReleaseReadiness(root);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map((finding) => finding.code)).toContain("KPP_RELEASE_RECEIPT_CHAIN");
  });

  test("writes a stable audit/audit.json that is bound to all real artifacts", async () => {
    const docx = await docxFixture();
    const render = await renderFixture(docx.docxPath);
    const figure = await figureFixture();
    const root = await renderedProjectFixture();
    const outputPath = join(root, "audit", "audit.json");

    const first = await auditProposal({
      root,
      docx,
      renderManifestPath: render.manifestPath,
      trustedPdftotextPath: render.extractorPath,
      figures: [figure],
      outputPath,
    });
    const firstBytes = await readFile(outputPath, "utf8");
    const second = await auditProposal({
      root,
      docx,
      renderManifestPath: render.manifestPath,
      trustedPdftotextPath: render.extractorPath,
      figures: [figure],
      outputPath,
    });

    expect(first.status).toBe("PASS");
    expect(second).toEqual(first);
    expect(await readFile(outputPath, "utf8")).toBe(firstBytes);
    expect(first.artifacts.every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.sha256))).toBe(true);
  });

  test("blocks when the rendered PDF was produced from a different DOCX", async () => {
    const docx = await docxFixture();
    const render = await renderFixture();
    const figure = await figureFixture();
    const root = await renderedProjectFixture();

    const report = await auditProposal({
      root,
      docx,
      renderManifestPath: render.manifestPath,
      trustedPdftotextPath: render.extractorPath,
      figures: [figure],
      outputPath: join(root, "audit", "audit.json"),
    });

    expect(report.status).toBe("BLOCKED");
    expect(report.findings.map((finding) => finding.code)).toContain("KPP_DESIGN_SURFACE_LINEAGE");
  });
});

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function docxFixture(): Promise<{
  readonly docxPath: string;
  readonly buildManifestPath: string;
  readonly geometryReportPath: string;
}> {
  const root = await makeRoot("kpp-audit-docx-");
  const docxPath = join(root, "document.docx");
  const buildManifestPath = join(root, "manifest.json");
  const geometryReportPath = join(root, "geometry.json");
  const figurePath = join(root, "figure.png");
  await writeFile(docxPath, "synthetic-docx-bytes", "utf8");
  await writeFile(figurePath, "figure-bytes", "utf8");
  const docxSha256 = await sha256File(docxPath);
  const profileSha256 = "1".repeat(64);
  await writeFile(buildManifestPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    profile: { profileId: "R08", status: "locked", sha256: profileSha256 },
    styles: {
      heading: { font: "Noto Sans CJK KR" },
      navigation: { font: "Noto Sans CJK KR" },
      body: {
        font: "Noto Serif CJK KR",
        ooxmlHalfPoints: 19,
        lineDxa: 365,
        alignment: "justified",
        characterSpacingTwips: 0,
      },
    },
    tables: [{ tableId: "T-1", native: true }],
    figures: [{ figureId: "FIG-1", path: figurePath, sha256: await sha256File(figurePath), embedded: true }],
    artifacts: { docx: { path: docxPath, sha256: docxSha256 } },
  }, null, 2)}\n`, "utf8");
  await writeFile(geometryReportPath, `${JSON.stringify({
    schemaVersion: "1",
    status: "PASS",
    docx: { path: docxPath, sha256: docxSha256 },
    expectedProfileSha256: profileSha256,
    facts: {
      bodyParagraphs: 1,
      nativeTables: 1,
      drawings: 1,
      captions: 2,
    },
    findings: [],
  }, null, 2)}\n`, "utf8");
  return { docxPath, buildManifestPath, geometryReportPath };
}

async function renderFixture(docxInput?: string): Promise<{
  readonly manifestPath: string;
  readonly pdfPath: string;
  readonly pagePath: string;
  readonly extractorPath: string;
}> {
  const root = await makeRoot("kpp-audit-render-");
  const docxPath = docxInput ?? join(root, "document.docx");
  const pdfPath = join(root, "proposal.pdf");
  const pagePath = join(root, "page-0001.png");
  const manifestPath = join(root, "render.json");
  const extractorPath = join(root, "pdftotext-fixture");
  if (docxInput === undefined) await writeFile(docxPath, "docx", "utf8");
  await writeFile(pdfPath, "%PDF-1.7 synthetic", "utf8");
  await writeFile(pagePath, "png-bytes", "utf8");
  await writeFile(extractorPath, "#!/bin/sh\nprintf '검색 가능한 한글 본문\\n'\n", "utf8");
  await chmod(extractorPath, 0o755);
  const searchableText = "검색 가능한 한글 본문";
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    rendererVersion: "0.1.0",
    input: { docx: { path: docxPath, sha256: await sha256File(docxPath) } },
    output: {
      pdf: { path: pdfPath, sha256: await sha256File(pdfPath), bytes: 18, pages: 1 },
      pages: [{ page: 1, path: pagePath, sha256: await sha256File(pagePath), bytes: 9 }],
    },
    executables: { pdftotext: { path: extractorPath, version: "fixture 1" } },
    searchableTextProof: {
      extractor: { path: extractorPath, version: "fixture 1" },
      textSha256: sha256(searchableText),
      nonWhitespaceCodePointCount: 9,
      hangulCodePointCount: 9,
    },
  }, null, 2)}\n`, "utf8");
  return { manifestPath, pdfPath, pagePath, extractorPath };
}

async function figureFixture(): Promise<{
  readonly specPath: string;
  readonly svgPath: string;
  readonly manifestPath: string;
}> {
  const root = await makeRoot("kpp-audit-figure-");
  const specPath = join(root, "figure-spec.json");
  const svgPath = join(root, "figure.svg");
  const manifestPath = join(root, "figure-manifest.json");
  const figure: GanttFigureSpec = {
    figureId: "FIG-GANTT-AUDIT",
    title: "100일 수행계획",
    caption: "그림 1. 수행계획과 마일스톤",
    evidenceIds: ["EV-1"],
    claimIds: ["CL-1"],
    inputKind: "semantic",
    tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
    family: "gantt",
    data: {
      kind: "time_axis",
      periods: ["D1", "D50", "D100"],
      workPackages: [{ id: "WP1", label: "착수", owner: "연구책임자", start: 0, end: 1, evidenceIds: ["EV-1"] }],
      milestones: [{ id: "M1", label: "착수보고", period: 1, owner: "연구책임자", evidenceIds: ["EV-1"], acceptance: "승인" }],
    },
  };
  const artifact = await renderFigureArtifact(figure);
  await writeFile(specPath, `${JSON.stringify(figure, null, 2)}\n`, "utf8");
  await writeFile(svgPath, artifact.svg, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(artifact.manifest, null, 2)}\n`, "utf8");
  return { specPath, svgPath, manifestPath };
}

async function renderedProjectFixture(): Promise<string> {
  const root = await makeRoot("kpp-audit-project-");
  await initializeProject(root, { projectId: "audit-project" });
  const stages = [
    ["SOURCE_LOCKED", "source-lock.json"],
    ["REQUIREMENTS_LOCKED", "requirements-lock.json"],
    ["EVIDENCE_LOCKED", "evidence-lock.json"],
    ["DESIGN_LOCKED", "design-lock.json"],
    ["CONTENT_APPROVED", "content-approval.json"],
    ["BUILT", "build.json"],
    ["RENDERED", "render.json"],
  ] as const;
  let predecessor: string | undefined;
  for (const [stage, filename] of stages) {
    const artifact = join(root, stage.toLowerCase(), "artifact.txt");
    await mkdir(join(root, stage.toLowerCase()), { recursive: true });
    await writeFile(artifact, stage, "utf8");
    const receipt = join(root, "receipts", filename);
    await writeReceipt({
      stage,
      files: [artifact],
      inputReceiptHashes: predecessor === undefined ? [] : [predecessor],
      output: receipt,
    });
    await advanceProject(root, stage);
    predecessor = await sha256File(receipt);
  }
  return root;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
