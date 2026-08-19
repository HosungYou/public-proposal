import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { buildCanonicalFigureIR, canonicalFigureInputsJson, semanticFigureCompileInput } from "./figure-specs.js";
import {
  R08_RENDERER_TOKENS,
  R08_TOKEN_PROFILE,
  R08_TOKEN_PROFILE_SHA256,
  VISUAL_EVIDENCE_FONT_PROFILE,
  VISUAL_EVIDENCE_FONT_PROFILE_SHA256,
  VISUAL_EVIDENCE_RENDERER_VERSION,
  escapeXml,
  type CanonicalFigureIR,
  type CanonicalFigureMark,
  type GovernedFigureReference,
  type FigureA4Context,
  type FigureA4PageArtifact,
  type LibreOfficeFingerprint,
  type SemanticFigureSpecV1,
  type VisualEvidenceData,
  type VisualEvidenceFigureArtifact,
  type VisualEvidencePngArtifact,
} from "./types.js";

const WIDTH = 720;
const HEIGHT = 420;
const PLOT_LEFT = 72;
const PLOT_TOP = 100;
const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 210;
const execFileAsync = promisify(execFile);
const APPROVED_SOFFICE_PATHS = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/opt/homebrew/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/bin/soffice",
  "/snap/bin/libreoffice",
] as const;

export async function compileFigure(
  spec: SemanticFigureSpecV1,
  data: VisualEvidenceData,
  references: readonly GovernedFigureReference[],
): Promise<VisualEvidenceFigureArtifact> {
  return compileFigureExpected(spec, data, references);
}

/** Pure reconstruction entrypoint used by independent QA. */
export function compileFigureExpected(
  spec: SemanticFigureSpecV1,
  data: VisualEvidenceData,
  references: readonly GovernedFigureReference[],
): VisualEvidenceFigureArtifact {
  const canonical = buildCanonicalFigureIR(spec, data, references);
  const svg = renderCanonicalFigure(canonical.ir, spec);
  const sha256 = hash(svg);
  const sourceIds = sortedUnique(canonical.pointLineage.map((entry) => entry.sourceId));
  const claimIds = sortedUnique(canonical.pointLineage.flatMap((entry) => entry.claimIds));
  const evidenceIds = sortedUnique(canonical.pointLineage.flatMap((entry) => entry.evidenceIds));
  const rendererFingerprintSha256 = hash(canonicalFigureInputsJson(spec.rendererFingerprint));
  return {
    schemaVersion: "visual-evidence-artifact/v1",
    figureId: spec.figureId,
    format: "svg",
    svg,
    sha256,
    rendererVersion: VISUAL_EVIDENCE_RENDERER_VERSION,
    rendererFingerprint: spec.rendererFingerprint,
    rendererFingerprintSha256,
    approvalStatus: spec.approvalStatus,
    compilerApproval: "not_authorized",
    ir: canonical.ir,
    pointLineage: canonical.pointLineage,
    captionBindings: {
      sourceIds: [...spec.sourceCaption.sourceIds].sort(),
      claimIds,
      evidenceIds: [...spec.evidenceIds].sort(),
    },
    lineage: {
      dataIds: [...spec.dataIds].sort(),
      sourceIds,
      claimIds,
      evidenceIds,
      referenceIds: canonical.references.map((reference) => reference.referenceId),
    },
    hashes: {
      specSha256: hash(canonicalFigureInputsJson(semanticFigureCompileInput(spec))),
      dataSha256: hash(canonicalFigureInputsJson(data)),
      referencesSha256: hash(canonicalFigureInputsJson(canonical.references)),
      irSha256: hash(canonicalFigureInputsJson(canonical.ir)),
      outputSha256: sha256,
    },
  };
}

/** Render an exact A4 review surface whose bytes bind figure, locator, caption, and page geometry. */
export function renderFigureA4Page(
  artifact: VisualEvidenceFigureArtifact,
  context: FigureA4Context,
): FigureA4PageArtifact {
  const image = Buffer.from(artifact.svg, "utf8").toString("base64");
  const box = context.figureBox;
  const peers = context.peerFigureBoxes.map((peer, index) =>
    `  <rect data-kpp-role="peer-figure-box" data-peer-index="${index}" x="${peer.xMm}" y="${peer.yMm}" width="${peer.widthMm}" height="${peer.heightMm}" fill="none"/>`,
  );
  const pageSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${context.pageWidthMm}mm" height="${context.pageHeightMm}mm" viewBox="0 0 ${context.pageWidthMm} ${context.pageHeightMm}" data-page-locator="${escapeXml(context.pageLocator)}" data-figure-svg-sha256="${artifact.sha256}">`,
    `  <rect width="${context.pageWidthMm}" height="${context.pageHeightMm}" fill="${R08_RENDERER_TOKENS.paper}"/>`,
    `  <text data-kpp-role="section-callout" x="20" y="28">${escapeXml(context.sectionCallout)}</text>`,
    `  <image data-kpp-role="figure" x="${box.xMm}" y="${box.yMm}" width="${box.widthMm}" height="${box.heightMm}" href="data:image/svg+xml;base64,${image}"/>`,
    `  <text data-kpp-role="caption" x="${box.xMm}" y="${box.yMm + box.heightMm + 6}">${escapeXml(context.caption)}</text>`,
    ...peers,
    "</svg>",
    "",
  ].join("\n");
  return {
    schemaVersion: "visual-evidence-a4-page/v1",
    figureId: artifact.figureId,
    pageLocator: context.pageLocator,
    pageSvg,
    sha256: hash(pageSvg),
    figureSvgSha256: artifact.sha256,
    contextSha256: hash(canonicalFigureInputsJson(context)),
  };
}

/** Deterministically rasterize canonical SVG bytes with an identified locked tool. */
export async function compileFigurePng(
  artifact: VisualEvidenceFigureArtifact,
  options: { readonly sofficePath?: string } = {},
): Promise<VisualEvidencePngArtifact> {
  if (artifact.sha256 !== hash(artifact.svg) || artifact.hashes.outputSha256 !== artifact.sha256) {
    throw new Error("Cannot rasterize a visual evidence artifact with mismatched SVG lineage");
  }
  const fingerprint = await inspectLibreOfficeFingerprint(options.sofficePath);
  const sofficePath = fingerprint.executablePath;
  if (canonicalFigureInputsJson(fingerprint) !== canonicalFigureInputsJson(artifact.rendererFingerprint.rasterizer)) {
    throw new Error("LibreOffice executable identity or version does not match the semantic renderer fingerprint");
  }

  const temporary = await mkdtemp(join(tmpdir(), "kpp-visual-evidence-png-"));
  try {
    const profile = join(temporary, "profile");
    const svgPath = join(temporary, "figure.svg");
    const pngPath = join(temporary, "figure.png");
    await mkdir(profile);
    await writeFile(svgPath, artifact.svg, "utf8");
    await execFileAsync(sofficePath, [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--convert-to",
      "png:draw_png_Export",
      "--outdir",
      temporary,
      svgPath,
    ], { encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    const png = await readFile(pngPath);
    if (png.length < 8 || png.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) {
      throw new Error("Locked rasterizer did not produce a valid PNG signature");
    }
    return {
      schemaVersion: "visual-evidence-png-artifact/v1",
      figureId: artifact.figureId,
      format: "png",
      png,
      sha256: hash(png),
      sourceSvgSha256: artifact.sha256,
      rendererVersion: artifact.rendererVersion,
      rasterizer: { path: sofficePath, executableSha256: fingerprint.executableSha256, version: fingerprint.version },
      lineage: artifact.lineage,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function inspectLibreOfficeFingerprint(configured?: string): Promise<LibreOfficeFingerprint> {
  const executablePath = await resolveSoffice(configured);
  const [identity, executable] = await Promise.all([
    execFileAsync(executablePath, ["--version"], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    }),
    readFile(executablePath),
  ]);
  const version = `${identity.stdout}${identity.stderr}`.trim();
  if (!/^LibreOffice\s+\d+/u.test(version)) throw new Error(`Unsupported LibreOffice rasterizer identity: ${version}`);
  return { name: "LibreOffice", executablePath, executableSha256: hash(executable), version };
}

function renderCanonicalFigure(ir: CanonicalFigureIR, spec: SemanticFigureSpecV1): string {
  const lines = openSvg(ir, spec);
  if (ir.family === "time-trend") renderTrend(lines, ir);
  else if (ir.family === "comparison") renderComparison(lines, ir);
  else if (ir.family === "composition") renderComposition(lines, ir);
  else if (ir.family === "requirement-matrix") renderMatrix(lines, ir);
  else renderNodes(lines, ir);
  lines.push(
    `  <text class="takeaway" x="36" y="340">${escapeXml(ir.supportedTakeaway)}</text>`,
    `  <text class="caption" x="36" y="374">${escapeXml(ir.sourceCaption)}</text>`,
    `  <text class="caption" x="36" y="394">${escapeXml(ir.uncertainty.join(" · ") || "불확실성: 없음")}</text>`,
    "</svg>",
  );
  return `${lines.join("\n")}\n`;
}

function openSvg(ir: CanonicalFigureIR, spec: SemanticFigureSpecV1): string[] {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title description" data-kpp-family="${ir.family}" data-renderer-version="${VISUAL_EVIDENCE_RENDERER_VERSION}" data-spec-version="${spec.schemaVersion}" data-target-surface="${spec.targetSurface}" data-token-profile="${R08_TOKEN_PROFILE}" data-token-hash="${R08_TOKEN_PROFILE_SHA256}" data-font-profile="${VISUAL_EVIDENCE_FONT_PROFILE}" data-font-hash="${VISUAL_EVIDENCE_FONT_PROFILE_SHA256}" data-renderer-fingerprint-sha256="${hash(canonicalFigureInputsJson(spec.rendererFingerprint))}">`,
    `  <title id="title">${escapeXml(ir.analyticalQuestion)}</title>`,
    `  <desc id="description">${escapeXml(ir.readerTask)}</desc>`,
    `  <rect width="${WIDTH}" height="${HEIGHT}" fill="${R08_RENDERER_TOKENS.paper}"/>`,
    `  <style>text{font-family:"Noto Sans CJK KR","Noto Sans KR",sans-serif;fill:${R08_RENDERER_TOKENS.ink};font-size:8pt}.question{font-size:13pt;font-weight:700;fill:${R08_RENDERER_TOKENS.navy}}.axis{stroke:${R08_RENDERER_TOKENS.hairline};stroke-width:1;fill:none}.mark{fill:${R08_RENDERER_TOKENS.navySecondary};stroke:${R08_RENDERER_TOKENS.navy};stroke-width:1}.secondary{fill:${R08_RENDERER_TOKENS.surfaceStrong};stroke:${R08_RENDERER_TOKENS.navySecondary};stroke-width:1}.takeaway{font-size:9pt;font-weight:700;fill:${R08_RENDERER_TOKENS.navy}}.caption{font-size:8pt;fill:${R08_RENDERER_TOKENS.muted}}</style>`,
    `  <text class="question" x="36" y="38">${escapeXml(ir.analyticalQuestion)}</text>`,
    `  <text x="36" y="64">독해 과업: ${escapeXml(ir.readerTask)}</text>`,
  ];
}

function renderTrend(lines: string[], ir: CanonicalFigureIR): void {
  const values = ir.marks.map(requiredValue);
  const scale = numericScale(values, true);
  const points = ir.marks.map((mark, index) => {
    const x = PLOT_LEFT + (ir.marks.length === 1 ? 0 : index * PLOT_WIDTH / (ir.marks.length - 1));
    const y = PLOT_TOP + PLOT_HEIGHT - ((requiredValue(mark) - scale.min) / (scale.max - scale.min)) * PLOT_HEIGHT;
    return { mark, x, y };
  });
  lines.push(
    `  <g data-kpp-role="honest-scale" data-scale-min="${scale.min}" data-scale-max="${scale.max}" data-include-zero="true">`,
    `    <path class="axis" d="M ${PLOT_LEFT} ${PLOT_TOP} V ${PLOT_TOP + PLOT_HEIGHT} H ${PLOT_LEFT + PLOT_WIDTH}"/>`,
    `    <polyline fill="none" stroke="${R08_RENDERER_TOKENS.navy}" stroke-width="2" points="${points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ")}"/>`,
    ...points.flatMap(({ mark, x, y }) => [
      `    <circle class="mark" data-kpp-role="plotted-point" ${lineageAttributes(mark)} cx="${round(x)}" cy="${round(y)}" r="4"/>`,
      `    <text text-anchor="middle" x="${round(x)}" y="${PLOT_TOP + PLOT_HEIGHT + 18}">${escapeXml(mark.period ?? mark.label)}</text>`,
      `    <text text-anchor="middle" x="${round(x)}" y="${round(y - 9)}">${requiredValue(mark)}${escapeXml(ir.unit ?? "")}</text>`,
    ]),
    "  </g>",
  );
}

function renderComparison(lines: string[], ir: CanonicalFigureIR): void {
  const max = Math.max(...ir.marks.map(requiredValue), 0) || 1;
  const barWidth = Math.min(72, PLOT_WIDTH / Math.max(ir.marks.length, 1) - 16);
  lines.push(`  <g data-kpp-role="comparison" data-scale-min="0" data-scale-max="${max}" data-include-zero="true">`);
  ir.marks.forEach((mark, index) => {
    const height = requiredValue(mark) / max * PLOT_HEIGHT;
    const x = PLOT_LEFT + 20 + index * (PLOT_WIDTH / ir.marks.length);
    const y = PLOT_TOP + PLOT_HEIGHT - height;
    lines.push(
      `    <rect class="mark" data-kpp-role="plotted-point" ${lineageAttributes(mark)} x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" height="${round(height)}"/>`,
      `    <text text-anchor="middle" x="${round(x + barWidth / 2)}" y="${PLOT_TOP + PLOT_HEIGHT + 18}">${escapeXml(mark.category ?? mark.label)}</text>`,
      `    <text text-anchor="middle" x="${round(x + barWidth / 2)}" y="${round(y - 8)}">${requiredValue(mark)}${escapeXml(ir.unit ?? "")}</text>`,
    );
  });
  lines.push("  </g>");
}

function renderComposition(lines: string[], ir: CanonicalFigureIR): void {
  const total = ir.marks.reduce((sum, mark) => sum + requiredValue(mark), 0);
  if (total <= 0) throw new Error("Composition figures require a positive total");
  let x = PLOT_LEFT;
  lines.push(`  <g data-kpp-role="composition" data-denominator="${escapeXml(ir.denominator ?? "total")}">`);
  ir.marks.forEach((mark, index) => {
    const width = requiredValue(mark) / total * PLOT_WIDTH;
    lines.push(
      `    <rect class="${index % 2 === 0 ? "mark" : "secondary"}" data-kpp-role="plotted-point" ${lineageAttributes(mark)} x="${round(x)}" y="${PLOT_TOP + 70}" width="${round(width)}" height="72"/>`,
      `    <text text-anchor="middle" x="${round(x + width / 2)}" y="${PLOT_TOP + 102}">${escapeXml(mark.category ?? mark.label)}</text>`,
      `    <text text-anchor="middle" x="${round(x + width / 2)}" y="${PLOT_TOP + 122}">${round(requiredValue(mark) / total * 100)}%</text>`,
    );
    x += width;
  });
  lines.push("  </g>");
}

function renderMatrix(lines: string[], ir: CanonicalFigureIR): void {
  const rows = sortedUnique(ir.marks.map((mark) => mark.row ?? ""));
  const columns = sortedUnique(ir.marks.map((mark) => mark.column ?? ""));
  const cellWidth = PLOT_WIDTH / Math.max(columns.length, 1);
  const cellHeight = PLOT_HEIGHT / Math.max(rows.length, 1);
  lines.push("  <g data-kpp-role=\"requirement-matrix\">");
  ir.marks.forEach((mark) => {
    const row = rows.indexOf(mark.row ?? "");
    const column = columns.indexOf(mark.column ?? "");
    const x = PLOT_LEFT + column * cellWidth;
    const y = PLOT_TOP + row * cellHeight;
    lines.push(
      `    <rect class="${requiredValue(mark) > 0 ? "mark" : "secondary"}" data-kpp-role="matrix-cell" ${lineageAttributes(mark)} x="${round(x)}" y="${round(y)}" width="${round(cellWidth)}" height="${round(cellHeight)}"/>`,
      `    <text text-anchor="middle" x="${round(x + cellWidth / 2)}" y="${round(y + cellHeight / 2)}">${escapeXml(mark.label)}</text>`,
    );
  });
  lines.push("  </g>");
}

function renderNodes(lines: string[], ir: CanonicalFigureIR): void {
  const nodes = ir.marks.filter((mark) => mark.nodeId !== undefined);
  const edges = ir.marks.filter((mark) => mark.from !== undefined && mark.to !== undefined);
  const nodeWidth = 116;
  const nodeHeight = 62;
  const positions = new Map(nodes.map((node, index) => [node.nodeId!, {
    x: PLOT_LEFT + index * ((PLOT_WIDTH - nodeWidth) / Math.max(nodes.length - 1, 1)),
    y: PLOT_TOP + (ir.family === "research-framework" && index % 2 === 1 ? 82 : 32),
  }] as const));
  lines.push(`  <g data-kpp-role="${ir.family}">`);
  for (const edge of edges) {
    const from = positions.get(edge.from!);
    const to = positions.get(edge.to!);
    if (from === undefined || to === undefined) continue;
    const fromRight = from.x + nodeWidth;
    const fromCenterY = from.y + nodeHeight / 2;
    const toCenterY = to.y + nodeHeight / 2;
    const midpointX = (fromRight + to.x) / 2;
    lines.push(
      `    <path data-kpp-role="connector" ${lineageAttributes(edge)} data-from="${escapeXml(edge.from!)}" data-to="${escapeXml(edge.to!)}" d="M ${round(fromRight)} ${round(fromCenterY)} H ${round(midpointX)} V ${round(toCenterY)} H ${round(to.x)}" fill="none" stroke="${R08_RENDERER_TOKENS.navy}" stroke-width="1.5"/>`,
      `    <text text-anchor="middle" x="${round(midpointX)}" y="${round(Math.min(fromCenterY, toCenterY) - 9)}">${escapeXml(edge.label)}</text>`,
    );
  }
  for (const node of nodes) {
    const position = positions.get(node.nodeId!)!;
    lines.push(
      `    <g data-kpp-role="node" ${lineageAttributes(node)} data-node-id="${escapeXml(node.nodeId!)}">`,
      `      <rect class="secondary" x="${round(position.x)}" y="${round(position.y)}" width="${nodeWidth}" height="${nodeHeight}"/>`,
      `      <text text-anchor="middle" x="${round(position.x + nodeWidth / 2)}" y="${round(position.y + 28)}">${escapeXml(node.label)}</text>`,
      `      <text text-anchor="middle" x="${round(position.x + nodeWidth / 2)}" y="${round(position.y + 47)}">${escapeXml(node.layer ?? "")}</text>`,
      "    </g>",
    );
  }
  lines.push("  </g>");
}

function numericScale(values: readonly number[], includeZero: boolean): { min: number; max: number } {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const min = includeZero ? Math.min(0, minValue) : minValue;
  const max = Math.max(maxValue, min + 1);
  return { min, max };
}

function requiredValue(mark: CanonicalFigureMark): number {
  if (mark.value === undefined) throw new Error(`Figure mark ${mark.id} has no numeric value`);
  return mark.value;
}

function lineageAttributes(mark: CanonicalFigureMark): string {
  return [
    `data-observation-id="${escapeXml(mark.id)}"`,
    `data-data-id="${escapeXml(mark.dataId)}"`,
    `data-source-id="${escapeXml(mark.sourceId)}"`,
    `data-source-sha256="${escapeXml(mark.sourceSha256)}"`,
    `data-raw-locator="${escapeXml(mark.rawLocator)}"`,
    `data-claim-ids="${escapeXml(mark.claimIds.join(" "))}"`,
    `data-evidence-ids="${escapeXml(mark.evidenceIds.join(" "))}"`,
  ].join(" ");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function resolveSoffice(configured: string | undefined): Promise<string> {
  const candidates = configured === undefined ? APPROVED_SOFFICE_PATHS : [configured];
  for (const candidate of candidates) {
    const metadata = await stat(candidate).catch(() => undefined);
    if (metadata?.isFile() === true) return realpath(candidate);
  }
  throw new Error("A trusted LibreOffice soffice executable is required for PNG rasterization");
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
