import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { executeFile } from "@kpp/core";
import { verifyFigureArtifact, type FigureManifest, type FigureSpec } from "@kpp/renderers";
import {
  blocked,
  inspectArtifact,
  makeSlice,
  readJsonObject,
  type AuditArtifact,
  type AuditFinding,
  type AuditSlice,
} from "./source.js";

export interface FigureAuditInput {
  readonly specPath: string;
  readonly svgPath: string;
  readonly manifestPath: string;
}

export interface FigureDocumentBindingInput {
  readonly figures: readonly FigureAuditInput[];
  readonly buildManifestPath: string;
  readonly geometryReportPath: string;
  readonly trustedSofficePath?: string;
}

const APPROVED_SOFFICE_PATHS = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/opt/homebrew/bin/soffice",
  "/usr/local/bin/soffice",
] as const;

export async function auditFigureArtifacts(inputs: readonly FigureAuditInput[]): Promise<AuditSlice> {
  const findings: AuditFinding[] = [];
  const artifacts: AuditArtifact[] = [];
  if (inputs.length === 0) {
    findings.push(blocked("KPP_DESIGN_FIGURE_MISSING", "검사할 semantic figure가 없습니다."));
  }
  for (const input of inputs) {
    try {
      const [specArtifact, svgArtifact, manifestArtifact] = await Promise.all([
        inspectArtifact(input.specPath),
        inspectArtifact(input.svgPath),
        inspectArtifact(input.manifestPath),
      ]);
      artifacts.push(specArtifact, svgArtifact, manifestArtifact);
      const spec = await readJsonObject(input.specPath) as unknown as FigureSpec;
      const manifest = await readJsonObject(input.manifestPath) as unknown as FigureManifest;
      const svg = await readFile(input.svgPath, "utf8");
      try {
        verifyFigureArtifact({ svg, manifest }, spec);
      } catch (error) {
        findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "semantic spec/renderer token/SVG manifest lineage가 일치하지 않습니다.", {
          path: input.manifestPath,
          actual: error instanceof Error ? error.message : error,
        }));
      }
      const roles = rolesFor(spec.family);
      if (roles.some((role) => !svg.includes(`data-kpp-role="${role}"`))) {
        findings.push(blocked(
          spec.family === "gantt" ? "KPP_DESIGN_GANTT_STRUCTURE" : "KPP_DESIGN_FIGURE_STRUCTURE",
          `${spec.family} SVG에 필수 semantic role이 없습니다.`,
          { path: input.svgPath, expected: roles },
        ));
      }
      if (manifest.bindings.evidenceIds.length === 0 || manifest.bindings.claimIds.length === 0) {
        findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "figure evidence/claim binding이 비어 있습니다.", { path: input.manifestPath }));
      }
    } catch (error) {
      findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "figure spec/SVG/manifest를 직접 검사할 수 없습니다.", {
        path: input.svgPath,
        actual: error instanceof Error ? error.message : error,
      }));
    }
  }
  return makeSlice(findings, artifacts);
}

/** Bind audited semantic SVG bytes to both the locked raster source and actual DOCX media. */
export async function auditFigureDocumentBindings(input: FigureDocumentBindingInput): Promise<AuditSlice> {
  const findings: AuditFinding[] = [];
  const artifacts: AuditArtifact[] = [];
  try {
    const [buildManifest, geometry] = await Promise.all([
      readJsonObject(input.buildManifestPath),
      readJsonObject(input.geometryReportPath),
    ]);
    const records = Array.isArray(buildManifest.figures) ? buildManifest.figures.map(asObject) : undefined;
    const embeddedMedia = Array.isArray(geometry.embeddedMedia) ? geometry.embeddedMedia.map(asObject) : undefined;
    if (records === undefined || embeddedMedia === undefined || records.some((record) => record === undefined)
      || embeddedMedia.some((record) => record === undefined) || records.length !== input.figures.length) {
      return makeSlice([blocked("KPP_DESIGN_FIGURE_MEDIA_LINEAGE", "semantic figure, build record, DOCX media 집합이 1:1로 결속되지 않았습니다.", {
        path: input.buildManifestPath,
      })], artifacts);
    }
    const soffice = await trustedSoffice(input.trustedSofficePath);
    if (soffice === undefined) {
      return makeSlice([blocked("KPP_DESIGN_FIGURE_MEDIA_LINEAGE", "고정 LibreOffice rasterizer를 확인할 수 없습니다.", {
        expected: input.trustedSofficePath ?? APPROVED_SOFFICE_PATHS,
      })], artifacts);
    }
    const recordById = new Map(records.map((record) => [record!.figureId, record!] as const));
    if (recordById.size !== records.length || recordById.has(undefined)) {
      return makeSlice([blocked("KPP_DESIGN_FIGURE_MEDIA_LINEAGE", "build figureId가 유일하지 않습니다.", { path: input.buildManifestPath })], artifacts);
    }
    for (const figureInput of input.figures) {
      const [spec, rendererManifest, sourceArtifacts] = await Promise.all([
        readJsonObject(figureInput.specPath) as unknown as Promise<FigureSpec>,
        readJsonObject(figureInput.manifestPath) as unknown as Promise<FigureManifest>,
        Promise.all([inspectArtifact(figureInput.specPath), inspectArtifact(figureInput.svgPath), inspectArtifact(figureInput.manifestPath)]),
      ]);
      artifacts.push(...sourceArtifacts);
      const record = recordById.get(spec.figureId);
      const expectedRenderer = `svg-${spec.family}`;
      if (record === undefined || rendererManifest.figure.id !== spec.figureId
        || record.renderer !== expectedRenderer || record.format !== "png" || record.embedded !== true
        || typeof record.path !== "string" || typeof record.sha256 !== "string"
        || !sameOrderedStrings(record.claimIds, spec.claimIds)
        || !sameOrderedStrings(record.evidenceIds, spec.evidenceIds)) {
        findings.push(blocked("KPP_DESIGN_FIGURE_MEDIA_LINEAGE", "build figure record가 audited semantic figure와 일치하지 않습니다.", {
          path: input.buildManifestPath,
          expected: { figureId: spec.figureId, renderer: expectedRenderer, format: "png" },
          actual: record,
        }));
        continue;
      }
      const source = await inspectArtifact(record.path);
      artifacts.push(source);
      const rasterHash = await rasterizedSvgSha256(figureInput.svgPath, soffice);
      if (source.sha256 !== record.sha256 || rasterHash !== record.sha256) {
        findings.push(blocked("KPP_DESIGN_FIGURE_MEDIA_LINEAGE", "DOCX source raster가 audited semantic SVG의 고정 rasterization과 다릅니다.", {
          path: record.path,
          expected: rasterHash,
          actual: { source: source.sha256, build: record.sha256 },
        }));
      }
    }
    const expectedMedia = records.map((record) => record!.sha256).filter((hash): hash is string => typeof hash === "string").sort();
    const actualMedia = embeddedMedia.map((record) => record!.sha256).filter((hash): hash is string => typeof hash === "string").sort();
    if (!sameOrderedStrings(expectedMedia, actualMedia)) {
      findings.push(blocked("KPP_DESIGN_FIGURE_MEDIA_LINEAGE", "실제 DOCX OOXML media bytes가 build figure source hash 집합과 다릅니다.", {
        path: input.geometryReportPath,
        expected: expectedMedia,
        actual: actualMedia,
      }));
    }
  } catch (error) {
    findings.push(blocked("KPP_DESIGN_FIGURE_MEDIA_LINEAGE", "semantic figure와 DOCX media 결속을 직접 검증할 수 없습니다.", {
      path: input.buildManifestPath,
      actual: error instanceof Error ? error.message : error,
    }));
  }
  return makeSlice(findings, artifacts);
}

async function rasterizedSvgSha256(svgPath: string, soffice: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-figure-raster-"));
  try {
    const profile = join(root, "libreoffice-profile");
    await mkdir(profile);
    await executeFile(soffice, [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--convert-to",
      "png:draw_png_Export",
      "--outdir",
      root,
      svgPath,
    ], { timeoutMs: 120_000 });
    const pngPath = join(root, `${basename(svgPath, extname(svgPath))}.png`);
    return (await inspectArtifact(pngPath)).sha256;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function trustedSoffice(configured: string | undefined): Promise<string | undefined> {
  const candidates = configured === undefined ? APPROVED_SOFFICE_PATHS : [configured];
  for (const candidate of candidates) {
    const metadata = await stat(candidate).catch(() => undefined);
    if (metadata?.isFile() === true) return candidate;
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sameOrderedStrings(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => typeof value === "string" && value === expected[index]);
}

function rolesFor(family: FigureSpec["family"]): readonly string[] {
  if (family === "gantt") return ["time-axis", "work-package-row", "duration-bar", "milestone"];
  if (family === "raci") return ["raci-header", "raci-row"];
  return ["framework-node", "connector"];
}
