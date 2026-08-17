import { inspectArtifact, readJsonObject, blocked, makeSlice, type AuditSlice } from "./source.js";

export interface DocxAuditInput {
  readonly docxPath: string;
  readonly buildManifestPath: string;
  readonly geometryReportPath: string;
}

export async function auditDocxArtifacts(input: DocxAuditInput): Promise<AuditSlice> {
  const findings = [];
  const artifacts = [];
  try {
    const [docx, buildManifestArtifact, geometryArtifact] = await Promise.all([
      inspectArtifact(input.docxPath),
      inspectArtifact(input.buildManifestPath),
      inspectArtifact(input.geometryReportPath),
    ]);
    artifacts.push(docx, buildManifestArtifact, geometryArtifact);
    const [manifest, geometry] = await Promise.all([
      readJsonObject(input.buildManifestPath),
      readJsonObject(input.geometryReportPath),
    ]);
    const manifestDocx = objectAt(manifest, "artifacts", "docx");
    const manifestProfile = objectAt(manifest, "profile");
    const geometryDocx = objectAt(geometry, "docx");
    const styles = objectAt(manifest, "styles");
    const body = styles === undefined ? undefined : objectAt(styles, "body");
    const figures = Array.isArray(manifest.figures) ? manifest.figures : [];
    const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
    const facts = objectAt(geometry, "facts");
    if (manifestDocx?.sha256 !== docx.sha256 || manifestDocx?.path !== input.docxPath
      || geometryDocx?.sha256 !== docx.sha256 || geometryDocx?.path !== input.docxPath) {
      findings.push(blocked("KPP_SOURCE_DOCX_LINEAGE", "DOCX bytes가 build/geometry lineage와 일치하지 않습니다.", {
        path: input.docxPath,
        expected: { build: manifestDocx, geometry: geometryDocx },
        actual: docx.sha256,
      }));
    }
    if (manifestProfile?.status !== "locked"
      || typeof manifestProfile.sha256 !== "string"
      || geometry.expectedProfileSha256 !== manifestProfile.sha256) {
      findings.push(blocked("KPP_SOURCE_PROFILE_LINEAGE", "잠금 surface profile이 DOCX geometry 검사와 연결되지 않았습니다.", {
        path: input.buildManifestPath,
      }));
    }
    if (objectAt(styles, "heading")?.font !== "Noto Sans CJK KR"
      || objectAt(styles, "navigation")?.font !== "Noto Sans CJK KR"
      || body?.font !== "Noto Serif CJK KR"
      || body.ooxmlHalfPoints !== 19
      || body.lineDxa !== 365
      || body.alignment !== "justified") {
      findings.push(blocked("KPP_DOCX_TYPOGRAPHY", "build manifest의 한글 조판 규격이 R08 잠금값과 다릅니다.", {
        path: input.buildManifestPath,
      }));
    }
    if (geometry.status !== "PASS" || !Array.isArray(geometry.findings) || geometry.findings.length > 0) {
      findings.push(blocked("KPP_SOURCE_DOCX_GEOMETRY", "직접 OOXML geometry 검사가 차단되었습니다.", {
        path: input.geometryReportPath,
        actual: geometry.findings,
      }));
    }
    const bodyParagraphs = numericFact(facts, "bodyParagraphs");
    const nativeTables = numericFact(facts, "nativeTables");
    const drawings = numericFact(facts, "drawings");
    const captions = numericFact(facts, "captions");
    if (bodyParagraphs < 1 || nativeTables < tables.length
      || drawings !== figures.length || captions < tables.length + figures.length) {
      findings.push(blocked("KPP_SOURCE_DOCX_GEOMETRY", "OOXML facts가 build manifest의 본문·표·그림·캡션 구조와 다릅니다.", {
        path: input.geometryReportPath,
        expected: { minimumBodyParagraphs: 1, nativeTables: tables.length, drawings: figures.length, minimumCaptions: tables.length + figures.length },
        actual: facts,
      }));
    }
    for (const value of figures) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        findings.push(blocked("KPP_SOURCE_FIGURE_LINEAGE", "build figure record가 올바르지 않습니다.", { path: input.buildManifestPath }));
        continue;
      }
      const figure = value as Record<string, unknown>;
      if (typeof figure.path !== "string" || typeof figure.sha256 !== "string" || figure.embedded !== true) {
        findings.push(blocked("KPP_SOURCE_FIGURE_LINEAGE", "embedded figure path/hash가 누락되었습니다.", { path: input.buildManifestPath }));
        continue;
      }
      try {
        const artifact = await inspectArtifact(figure.path);
        artifacts.push(artifact);
        if (artifact.sha256 !== figure.sha256) {
          findings.push(blocked("KPP_SOURCE_FIGURE_LINEAGE", "embedded figure source bytes가 build manifest와 다릅니다.", {
            path: figure.path,
            expected: figure.sha256,
            actual: artifact.sha256,
          }));
        }
      } catch (error) {
        findings.push(blocked("KPP_SOURCE_FIGURE_LINEAGE", "embedded figure source를 읽을 수 없습니다.", {
          path: figure.path,
          actual: error instanceof Error ? error.message : error,
        }));
      }
    }
  } catch (error) {
    findings.push(blocked("KPP_SOURCE_DOCX_READ", "DOCX/build/geometry 아티팩트를 직접 검사할 수 없습니다.", {
      path: input.docxPath,
      actual: error instanceof Error ? error.message : error,
    }));
  }
  return makeSlice(findings, artifacts);
}

function numericFact(facts: Record<string, unknown> | undefined, key: string): number {
  const value = facts?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : -1;
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
