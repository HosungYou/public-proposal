import { stat } from "node:fs/promises";
import { executeFile } from "@kpp/core";
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

export async function auditRenderArtifacts(manifestPath: string): Promise<AuditSlice> {
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
    }
    const expectedPages = Array.from({ length: pdf.pages }, (_, index) => index + 1);
    if (expectedPages.some((page) => !pageNumbers.has(page))) {
      findings.push(blocked("KPP_RENDER_PAGE_IMAGES", "PDF page count와 numbered page image 집합이 다릅니다.", {
        path: manifestPath,
        expected: expectedPages,
        actual: [...pageNumbers].sort((left, right) => left - right),
      }));
    }
    if (typeof extractor?.path !== "string" || typeof proof?.textSha256 !== "string") {
      findings.push(blocked("KPP_RENDER_SEARCHABLE_KOREAN", "검색 가능한 한글 proof 또는 extractor가 없습니다.", { path: manifestPath }));
    } else {
      const metadata = await stat(extractor.path);
      if (!metadata.isFile()) throw new Error("pdftotext path is not a regular file");
      const extracted = await executeFile(extractor.path, [pdf.path, "-"]);
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
  } catch (error) {
    findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "render manifest/PDF/page 아티팩트를 직접 검사할 수 없습니다.", {
      path: manifestPath,
      actual: error instanceof Error ? error.message : error,
    }));
  }
  return makeSlice(findings, artifacts);
}

function objectAt(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined {
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
