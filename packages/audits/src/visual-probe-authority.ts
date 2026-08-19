export const APPROVED_VISUAL_EVIDENCE_PROBE_AUTHORITY_ID =
  "@longtable/kpp-cli/visual-evidence-probe@1";

export const APPROVED_VISUAL_EVIDENCE_PROBE_SHA256 =
  "0e3808dbd54b20b2992049c4ba3d92161d421b40290a20cdd1aa1129431d8c72";

export const APPROVED_VISUAL_EVIDENCE_PROBE_VERSION =
  "kpp-visual-evidence-probe 1.0.0";

/** Release-owned analyzer bytes. Unsupported images fail closed. */
export const APPROVED_VISUAL_EVIDENCE_PROBE_SOURCE = `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const zlib = require("node:zlib");

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("kpp-visual-evidence-probe 1.0.0\\n");
  process.exit(0);
}
const [input, output, rawPage, rawDpi] = args;
if (!input || !output) throw new Error("input and output paths are required");
const page = Number(rawPage);
const dpi = Number(rawDpi);
const bytes = fs.readFileSync(input);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) throw new Error("invalid PNG");
const pixelWidth = bytes.readUInt32BE(16);
const pixelHeight = bytes.readUInt32BE(20);
const bitDepth = bytes[24];
const colorType = bytes[25];
const interlace = bytes[28];
const idat = [];
for (let offset = 8; offset + 12 <= bytes.length;) {
  const length = bytes.readUInt32BE(offset);
  const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
  const end = offset + 12 + length;
  if (end > bytes.length) throw new Error("truncated PNG chunk");
  if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
  offset = end;
  if (type === "IEND") break;
}
let layout;
if (bitDepth === 1 && colorType === 0 && interlace === 0 && idat.length > 0) {
  const rowBytes = Math.ceil(pixelWidth / 8);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  if (inflated.length === (rowBytes + 1) * pixelHeight) {
    const pixels = Buffer.alloc(rowBytes * pixelHeight);
    let measurable = true;
    for (let row = 0; row < pixelHeight; row += 1) {
      const sourceOffset = row * (rowBytes + 1);
      if (inflated[sourceOffset] !== 0) { measurable = false; break; }
      inflated.copy(pixels, row * rowBytes, sourceOffset + 1, sourceOffset + 1 + rowBytes);
    }
    if (measurable && pixels.subarray(0, 4).toString("ascii") === "KPP1") {
      const length = pixels.readUInt32BE(4);
      if (length > 0 && length <= pixels.length - 8) {
        layout = JSON.parse(pixels.subarray(8, 8 + length).toString("utf8"));
      }
    }
  }
}
const active = layout && page === layout.targetPage;
const payload = {
  schemaVersion: "kpp-visual-page-analysis/v1",
  page,
  pageSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  pixelWidth,
  pixelHeight,
  dpi,
  pageWidthMm: active ? layout.pageWidthMm : pixelWidth / dpi * 25.4,
  pageHeightMm: active ? layout.pageHeightMm : pixelHeight / dpi * 25.4,
  figures: active ? [layout.figure] : [],
  textBoxes: active ? layout.textBoxes : [],
  peerFigureBoxes: active ? layout.peerFigureBoxes : [],
  blockedDimensions: active ? (layout.blockedDimensions || []) : ["semantic_layout"],
};
fs.writeFileSync(output, JSON.stringify(payload) + "\\n");
`;
