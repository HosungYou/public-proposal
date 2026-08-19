import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  advanceProject,
  initializeProject,
  sha256File,
  writeReceipt,
} from "@longtable/kpp-core";

const TEMPLATE = resolve("workers/docx-python/assets/Korean Public Proposal A4 v1.docx");

export interface VisualLayoutProbeFixture {
  readonly targetPage: number;
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  readonly figure: {
    readonly figureId: string;
    readonly figureSvgSha256: string;
    readonly box: { readonly xMm: number; readonly yMm: number; readonly widthMm: number; readonly heightMm: number };
    readonly caption: string;
    readonly sectionCallout: string;
  };
  readonly textBoxes: readonly {
    readonly text: string;
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly heightMm: number;
  }[];
  readonly peerFigureBoxes: readonly {
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly heightMm: number;
  }[];
  readonly blockedDimensions?: readonly string[];
}

export async function createDeterministicRenderedProject(
  visualLayout: VisualLayoutProbeFixture,
): Promise<{
  readonly root: string;
  readonly docxPath: string;
  readonly tools: {
    readonly soffice: string;
    readonly pdfinfo: string;
    readonly pdftotext: string;
    readonly pdftoppm: string;
    readonly visualEvidenceProbe: string;
  };
}> {
  const root = await mkdtemp(join(tmpdir(), "kpp-governed-render-fixture-"));
  await initializeProject(root, { projectId: "governed-render-fixture" });

  let predecessorReceipt: string | undefined;
  for (const stage of [
    "SOURCE_LOCKED",
    "REQUIREMENTS_LOCKED",
    "EVIDENCE_LOCKED",
    "DESIGN_LOCKED",
    "CONTENT_APPROVED",
  ] as const) {
    const artifact = join(root, stage.toLowerCase(), "artifact.txt");
    await mkdir(join(root, stage.toLowerCase()), { recursive: true });
    await writeFile(artifact, `${stage}\n`);
    const receiptPath = stageReceiptPath(root, stage);
    await writeReceipt({
      stage,
      files: [artifact],
      inputReceiptHashes: predecessorReceipt === undefined ? [] : [await sha256File(predecessorReceipt)],
      output: receiptPath,
    });
    await advanceProject(root, stage);
    predecessorReceipt = receiptPath;
  }

  const bundleRoot = join(root, ".kpp-build-0123456789abcdef");
  const generation = join(bundleRoot, "generations", "fixture-generation");
  await mkdir(generation, { recursive: true });
  const docxPath = join(generation, "document.docx");
  await copyFile(TEMPLATE, docxPath);
  const buildManifest = join(generation, "manifest.json");
  await writeFile(buildManifest, `${JSON.stringify({
    schemaVersion: "1.0.0",
    artifacts: { docx: { path: docxPath, sha256: await sha256File(docxPath) } },
  }, null, 2)}\n`);
  const buildReceipt = stageReceiptPath(root, "BUILT");
  await writeReceipt({
    stage: "BUILT",
    files: [docxPath, buildManifest],
    inputReceiptHashes: predecessorReceipt === undefined ? [] : [await sha256File(predecessorReceipt)],
    output: buildReceipt,
  });
  await advanceProject(root, "BUILT");

  const toolsRoot = join(root, "fixture-tools");
  await mkdir(toolsRoot, { recursive: true });
  const pageCount = Math.max(visualLayout.targetPage, 1);
  const tools = {
    soffice: await writeNodeTool(toolsRoot, "soffice", `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) { process.stdout.write("LibreOffice fixture 1.0\\n"); process.exit(0); }
const outdir = args[args.indexOf("--outdir") + 1];
const source = args[args.length - 1];
fs.writeFileSync(path.join(outdir, path.basename(source, path.extname(source)) + ".pdf"), "%PDF-1.7\\nfixture\\n%%EOF\\n");
`),
    pdfinfo: await writeNodeTool(toolsRoot, "pdfinfo", `
const args = process.argv.slice(2);
if (args.includes("-v")) process.stderr.write("pdfinfo fixture 1.0\\n");
else process.stdout.write("Pages: ${pageCount}\\n");
`),
    pdftotext: await writeNodeTool(toolsRoot, "pdftotext", `
const args = process.argv.slice(2);
if (args.includes("-v")) process.stderr.write("pdftotext fixture 1.0\\n");
else process.stdout.write("기관 에이엑스 중장기 로드맵\\n");
`),
    pdftoppm: await writeNodeTool(toolsRoot, "pdftoppm", `
const fs = require("node:fs");
const zlib = require("node:zlib");
const args = process.argv.slice(2);
if (args.includes("-v")) { process.stderr.write("pdftoppm fixture 1.0\\n"); process.exit(0); }
const prefix = args[args.length - 1];
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  type.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return output;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(1654, 0);
header.writeUInt32BE(2339, 4);
header[8] = 1;
header[9] = 0;
const layout = Buffer.from(${JSON.stringify(JSON.stringify(visualLayout))}, "utf8");
const marker = Buffer.alloc(8 + layout.length);
marker.write("KPP1", 0, "ascii");
marker.writeUInt32BE(layout.length, 4);
layout.copy(marker, 8);
const rowBytes = Math.ceil(1654 / 8);
const pixels = Buffer.alloc((rowBytes + 1) * 2339, 255);
for (let row = 0; row < 2339; row += 1) pixels[row * (rowBytes + 1)] = 0;
for (let index = 0; index < marker.length; index += 1) {
  const row = Math.floor(index / rowBytes);
  const column = index % rowBytes;
  pixels[row * (rowBytes + 1) + 1 + column] = marker[index];
}
const png = Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk("IHDR", header),
  chunk("IDAT", zlib.deflateSync(pixels)),
  chunk("IEND", Buffer.alloc(0)),
]);
for (let page = 1; page <= ${pageCount}; page += 1) {
  fs.writeFileSync(prefix + "-" + page + ".png", png);
}
`),
    visualEvidenceProbe: await writeNodeTool(toolsRoot, "visual-evidence-probe", `
const crypto = require("node:crypto");
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { process.stdout.write("kpp-visual-probe fixture 1.0\\n"); process.exit(0); }
const input = args[0];
const output = args[1];
const page = Number(args[2]);
const dpi = Number(args[3]);
const bytes = fs.readFileSync(input);
const configured = ${JSON.stringify(visualLayout)};
const active = page === configured.targetPage;
const payload = {
  schemaVersion: "kpp-visual-page-analysis/v1",
  page,
  pageSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  pixelWidth: bytes.readUInt32BE(16),
  pixelHeight: bytes.readUInt32BE(20),
  dpi,
  pageWidthMm: configured.pageWidthMm,
  pageHeightMm: configured.pageHeightMm,
  figures: active ? [configured.figure] : [],
  textBoxes: active ? configured.textBoxes : [],
  peerFigureBoxes: active ? configured.peerFigureBoxes : [],
  blockedDimensions: active ? (configured.blockedDimensions || []) : [],
};
fs.writeFileSync(output, JSON.stringify(payload) + "\\n");
`),
  } as const;

  return { root, docxPath, tools };
}

async function writeNodeTool(root: string, name: string, body: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, `#!/usr/bin/env node\n${body.trim()}\n`);
  await chmod(path, 0o755);
  return path;
}

function stageReceiptPath(
  root: string,
  stage: "SOURCE_LOCKED" | "REQUIREMENTS_LOCKED" | "EVIDENCE_LOCKED" |
    "DESIGN_LOCKED" | "CONTENT_APPROVED" | "BUILT",
): string {
  const filenames = {
    SOURCE_LOCKED: "source-lock.json",
    REQUIREMENTS_LOCKED: "requirements-lock.json",
    EVIDENCE_LOCKED: "evidence-lock.json",
    DESIGN_LOCKED: "design-lock.json",
    CONTENT_APPROVED: "content-approval.json",
    BUILT: "build.json",
  } as const;
  return join(root, "receipts", filenames[stage]);
}
