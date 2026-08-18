import { open, readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { executeFile } from "@longtable/kpp-core";
import {
  blocked,
  inspectArtifact,
  makeSlice,
  readJsonObject,
  sha256Text,
  type AuditArtifact,
  type AuditFinding,
  type AuditSlice,
} from "./source.js";

export interface RenderAuditOptions {
  readonly trustedPdftotextPath?: string;
  readonly trustedPdfinfoPath?: string;
}

const APPROVED_PDFTOTEXT_PATHS = [
  "/opt/homebrew/bin/pdftotext",
  "/usr/local/bin/pdftotext",
  "/usr/bin/pdftotext",
] as const;
const APPROVED_PDFINFO_PATHS = [
  "/opt/homebrew/bin/pdfinfo",
  "/usr/local/bin/pdfinfo",
  "/usr/bin/pdfinfo",
] as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function auditRenderArtifacts(
  manifestPath: string,
  options: RenderAuditOptions = {},
): Promise<AuditSlice> {
  const findings: AuditFinding[] = [];
  const artifacts: AuditArtifact[] = [];
  try {
    const manifestArtifact = await inspectArtifact(manifestPath);
    artifacts.push(manifestArtifact);
    const manifest = await readJsonObject(manifestPath);
    const docx = objectAt(manifest, "input", "docx");
    const pdf = objectAt(manifest, "output", "pdf");
    const pageRecords = arrayAt(manifest, "output", "pages");
    const proof = objectAt(manifest, "searchableTextProof");
    const proofExtractor = objectAt(proof, "extractor");
    const extractor = objectAt(manifest, "executables", "pdftotext");
    if (!isPathHash(docx) || !isPathHash(pdf) || pageRecords === undefined
      || typeof pdf.pages !== "number" || pdf.pages < 1
      || pageRecords.length !== pdf.pages) {
      findings.push(blocked("KPP_RENDER_MANIFEST_INVALID", "render.json 구조 또는 페이지 수가 올바르지 않습니다.", { path: manifestPath }));
      return makeSlice(findings, artifacts);
    }
    const docxArtifact = await inspectArtifact(docx.path);
    const pdfArtifact = await inspectArtifact(pdf.path);
    artifacts.push(docxArtifact, pdfArtifact);
    if (docxArtifact.sha256 !== docx.sha256 || pdfArtifact.sha256 !== pdf.sha256
      || pdfArtifact.bytes !== pdf.bytes) {
      findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "DOCX/PDF bytes가 render manifest와 일치하지 않습니다.", {
        path: manifestPath,
      }));
    }
    const actualPages = await inspectPdf(pdf.path, options, findings);
    if (actualPages !== undefined && actualPages !== pdf.pages) {
      findings.push(blocked("KPP_RENDER_PDF_INVALID", "PDF의 실제 page count가 render manifest와 다릅니다.", {
        path: pdf.path,
        expected: pdf.pages,
        actual: actualPages,
      }));
    }
    const pageNumbers = new Set<number>();
    for (const value of pageRecords) {
      if (!isPageRecord(value)) {
        findings.push(blocked("KPP_RENDER_PAGE_IMAGES", "page image record가 올바르지 않습니다.", { path: manifestPath, actual: value }));
        continue;
      }
      const page = await inspectArtifact(value.path);
      artifacts.push(page);
      pageNumbers.add(value.page);
      if (page.sha256 !== value.sha256 || page.bytes !== value.bytes) {
        findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "page image bytes가 render manifest와 일치하지 않습니다.", {
          path: value.path,
          expected: value.sha256,
          actual: page.sha256,
        }));
      }
      if (basename(value.path) !== `page-${String(value.page).padStart(4, "0")}.png`
        || !(await hasValidPngStructure(value.path))) {
        findings.push(blocked("KPP_RENDER_PAGE_IMAGES", "page image가 numbered PNG 아티팩트가 아닙니다.", {
          path: value.path,
          expected: `page-${String(value.page).padStart(4, "0")}.png with valid PNG structure`,
        }));
      }
    }
    const expectedPages = Array.from({ length: actualPages ?? pdf.pages }, (_, index) => index + 1);
    if (expectedPages.some((page) => !pageNumbers.has(page))) {
      findings.push(blocked("KPP_RENDER_PAGE_IMAGES", "PDF page count와 numbered page image 집합이 다릅니다.", {
        path: manifestPath,
        expected: expectedPages,
        actual: [...pageNumbers].sort((left, right) => left - right),
      }));
    }
    if (typeof extractor?.path !== "string" || typeof extractor.version !== "string"
      || typeof proof?.textSha256 !== "string" || typeof proofExtractor?.path !== "string"
      || typeof proofExtractor.version !== "string") {
      findings.push(blocked("KPP_RENDER_SEARCHABLE_KOREAN", "검색 가능한 한글 proof 또는 extractor가 없습니다.", { path: manifestPath }));
    } else {
      const trustedPath = await trustedExecutable(options.trustedPdftotextPath, APPROVED_PDFTOTEXT_PATHS);
      if (trustedPath === undefined || extractor.path !== trustedPath) {
        findings.push(blocked("KPP_RENDER_EXTRACTOR_UNTRUSTED", "render manifest가 지정한 extractor는 실행 권한의 근거가 될 수 없습니다.", {
          path: extractor.path,
          expected: trustedPath ?? APPROVED_PDFTOTEXT_PATHS,
        }));
      } else {
        const identity = await executeFile(trustedPath, ["-v"]);
        const version = `${identity.stdout}${identity.stderr}`.trim();
        if (extractor.version !== version || proofExtractor.path !== trustedPath
          || proofExtractor.version !== version) {
          findings.push(blocked("KPP_RENDER_EXTRACTOR_UNTRUSTED", "고정 extractor의 실제 identity가 render manifest와 다릅니다.", {
            path: trustedPath,
            expected: { path: trustedPath, version },
            actual: { manifest: extractor, proof: proofExtractor },
          }));
        } else {
          const extracted = await executeFile(trustedPath, [pdf.path, "-"]);
          const text = extracted.stdout.normalize("NFC").trim();
          const nonWhitespace = [...text].filter((character) => !/\s/u.test(character)).length;
          const hangul = [...text].filter((character) => /[\uAC00-\uD7A3]/u.test(character)).length;
          if (hangul < 1 || proof.textSha256 !== sha256Text(text)
            || proof.nonWhitespaceCodePointCount !== nonWhitespace
            || proof.hangulCodePointCount !== hangul) {
            findings.push(blocked("KPP_RENDER_SEARCHABLE_KOREAN", "PDF searchable Korean text proof가 현재 PDF 추출 결과와 다릅니다.", {
              path: pdf.path,
              expected: proof,
              actual: { textSha256: sha256Text(text), nonWhitespaceCodePointCount: nonWhitespace, hangulCodePointCount: hangul },
            }));
          }
        }
      }
    }
  } catch (error) {
    findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "render manifest/PDF/page 아티팩트를 직접 검사할 수 없습니다.", {
      path: manifestPath,
      actual: error instanceof Error ? error.message : error,
    }));
  }
  return makeSlice(findings, artifacts);
}

async function inspectPdf(
  path: string,
  options: RenderAuditOptions,
  findings: AuditFinding[],
): Promise<number | undefined> {
  if (!(await hasPdfSignature(path))) {
    findings.push(blocked("KPP_RENDER_PDF_INVALID", "PDF signature가 올바르지 않습니다.", { path }));
    return undefined;
  }
  const pdfinfo = await trustedExecutable(options.trustedPdfinfoPath, APPROVED_PDFINFO_PATHS);
  if (pdfinfo === undefined) {
    findings.push(blocked("KPP_RENDER_PDF_INVALID", "고정 pdfinfo 실행 파일을 확인할 수 없습니다.", {
      path,
      expected: options.trustedPdfinfoPath ?? APPROVED_PDFINFO_PATHS,
    }));
    return undefined;
  }
  try {
    const result = await executeFile(pdfinfo, [path]);
    const match = /^Pages:\s+(\d+)$/mu.exec(result.stdout);
    const pages = match === null ? Number.NaN : Number(match[1]);
    if (!Number.isInteger(pages) || pages < 1) throw new Error("pdfinfo returned no positive page count");
    return pages;
  } catch (error) {
    findings.push(blocked("KPP_RENDER_PDF_INVALID", "pdfinfo가 현재 PDF를 검증하지 못했습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    }));
    return undefined;
  }
}

async function trustedExecutable(
  configured: string | undefined,
  approved: readonly string[],
): Promise<string | undefined> {
  const candidates = configured === undefined ? approved : [configured];
  for (const candidate of candidates) {
    const metadata = await stat(candidate).catch(() => undefined);
    if (metadata?.isFile() === true) return candidate;
  }
  return undefined;
}

async function hasPdfSignature(path: string): Promise<boolean> {
  return (await readPrefix(path, 5)).equals(Buffer.from("%PDF-", "ascii"));
}

async function hasValidPngStructure(path: string): Promise<boolean> {
  const png = await readFile(path);
  if (png.length < PNG_SIGNATURE.length + 12 || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let sawHeader = false;
  let sawImageData = false;
  let closedImageData = false;
  let compressedImageDataBytes = 0;
  let sawPalette = false;
  let sawTransparency = false;
  while (offset < png.length) {
    if (png.length - offset < 12) return false;
    const length = png.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > png.length) return false;

    const type = png.subarray(typeStart, dataStart);
    if (![...type].every((byte) => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a))) {
      return false;
    }
    if (png.readUInt32BE(dataEnd) !== crc32(png.subarray(typeStart, dataEnd))) return false;

    const name = type.toString("ascii");
    if (chunkIndex === 0) {
      if (name !== "IHDR" || length !== 13 || !validPngHeader(png.subarray(dataStart, dataEnd))) return false;
      sawHeader = true;
    } else if (name === "IHDR") {
      return false;
    } else if (name === "PLTE") {
      if (sawPalette || sawImageData || length === 0 || length % 3 !== 0 || length > 3 * 256) return false;
      sawPalette = true;
    } else if (name === "tRNS") {
      if (sawTransparency || sawImageData) return false;
      sawTransparency = true;
    } else if (name === "IDAT") {
      if (closedImageData || !sawHeader) return false;
      sawImageData = true;
      compressedImageDataBytes += length;
    } else if (name === "IEND") {
      return length === 0 && sawHeader && sawImageData && compressedImageDataBytes > 0 && chunkEnd === png.length;
    } else if (sawImageData) {
      closedImageData = true;
    }

    if (name !== "IHDR" && name !== "PLTE" && name !== "tRNS" && name !== "IDAT" && name !== "IEND"
      && type[0] !== undefined && type[0] >= 0x41 && type[0] <= 0x5a) {
      return false;
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }
  return false;
}

function validPngHeader(header: Buffer): boolean {
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const validDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  return width > 0 && width <= 0x7fff_ffff
    && height > 0 && height <= 0x7fff_ffff
    && typeof colorType === "number" && typeof bitDepth === "number"
    && validDepths[colorType]?.includes(bitDepth) === true
    && header[10] === 0 && header[11] === 0
    && (header[12] === 0 || header[12] === 1);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function readPrefix(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function objectAt(value: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current !== null && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : undefined;
}

function arrayAt(value: Record<string, unknown>, ...keys: string[]): readonly unknown[] | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : undefined;
}

function isPathHash(value: Record<string, unknown> | undefined): value is Record<string, unknown> & { path: string; sha256: string; bytes?: number } {
  return typeof value?.path === "string" && typeof value.sha256 === "string";
}

function isPageRecord(value: unknown): value is { page: number; path: string; sha256: string; bytes: number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.page) && typeof record.path === "string"
    && typeof record.sha256 === "string" && typeof record.bytes === "number";
}
