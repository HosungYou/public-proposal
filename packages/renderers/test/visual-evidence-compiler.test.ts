import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  R08_TOKEN_PROFILE,
  R08_TOKEN_PROFILE_SHA256,
  VISUAL_EVIDENCE_FONT_PROFILE,
  VISUAL_EVIDENCE_FONT_PROFILE_SHA256,
  VISUAL_EVIDENCE_RENDERER_VERSION,
  compileFigure,
  compileFigurePng,
  adaptLegacySemanticFigureSpec,
  inspectSemanticRendererFingerprint,
  type GovernedFigureReference,
  type RendererEnvironmentInput,
  type SemanticFigureSpecV1_1,
  type VisualEvidenceData,
} from "../src/index.js";
import {
  GovernedFigureReferenceSchema,
  SemanticFigureSpecSchema,
  SemanticFigureSpecV1Schema,
  SemanticFigureSpecV1_1Schema,
} from "../../schemas/src/figure-spec.js";

const SOURCE_SHA = "1".repeat(64);
const REFERENCE_SHA = "2".repeat(64);
const TEST_EXECUTABLE_SHA = "3".repeat(64);

const validSpec: SemanticFigureSpecV1_1 = {
  schemaVersion: "semantic-figure-spec/v1.1",
  figureId: "FIG-TREND-001",
  requirementIds: ["REQ-001"],
  analyticalQuestion: "최근 8개 분기의 처리량은 어떻게 변했는가?",
  readerTask: "분기별 변화와 전환점을 확인한다.",
  supportedTakeaway: "최근 8개 분기의 처리량이 점진적으로 증가했다.",
  dataIds: ["DATA-TREND-001"],
  evidenceIds: ["EV-001"],
  relationship: "trend",
  minimumDataConditions: { minimumTemporalObservations: 8 },
  uncertainty: ["분기 집계치는 월별 변동을 표시하지 않는다."],
  sourceCaption: { text: "출처: 공공데이터 포털 공개 통계", sourceIds: ["SRC-001"] },
  targetSurface: "A4_DOCX",
  referenceFamily: "line",
  rendererVersion: VISUAL_EVIDENCE_RENDERER_VERSION,
  rendererFingerprint: {
    renderer: { name: "@longtable/kpp-renderers", version: VISUAL_EVIDENCE_RENDERER_VERSION },
    tokenProfile: { id: R08_TOKEN_PROFILE, sha256: R08_TOKEN_PROFILE_SHA256 },
    fontProfile: { id: VISUAL_EVIDENCE_FONT_PROFILE, sha256: VISUAL_EVIDENCE_FONT_PROFILE_SHA256, files: [{ path: "/test/font.otf", sha256: "5".repeat(64) }] },
    rasterizer: {
      name: "LibreOffice",
      executablePath: "/test/soffice",
      executableSha256: TEST_EXECUTABLE_SHA,
      version: "LibreOffice 26.2.4.2 20(Build:2)",
      bundlePath: "/test/libreoffice",
      bundleResources: [{ path: "/test/program/resource.dat", sha256: "4".repeat(64) }],
    },
    environment: { locale: "ko-KR", operatingSystem: "test-os", architecture: "test-arch", runtime: { name: "node", version: "26.5.0" } },
  },
  approvalStatus: "reviewed",
};

const validData: VisualEvidenceData = {
  datasets: [{
    dataId: "DATA-TREND-001",
    sourceIds: ["SRC-001"],
    unit: "건",
    denominator: "분기",
    observations: Array.from({ length: 8 }, (_, index) => ({
      observationId: `OBS-${index + 1}`,
      period: `202${4 + Math.floor(index / 4)}-Q${(index % 4) + 1}`,
      label: `${index + 1}분기`,
      value: 100 + index * 5,
      sourceId: "SRC-001",
      sourceSha256: SOURCE_SHA,
      rawLocator: `table:1,row:${index + 1}`,
      claimIds: ["CLAIM-001"],
    })),
  }],
};

const validReferences: readonly GovernedFigureReference[] = [{
  referenceId: "REF-LINE-001",
  referenceFamily: "line",
  storageClass: "extracted_visual_pattern",
  rightsStatus: "approved",
  sourceSha256: REFERENCE_SHA,
  pageLocator: "pattern:line-v1",
  transferBoundary: "정보 위계와 선형 추세 문법만 전이",
  synthetic: false,
  publiclyReleasable: false,
  sourceLineageClass: "project_private",
  humanPromoted: true,
  approved: true,
}];

describe("visual evidence compiler", () => {
  it("accepts the additive vNext schema while retaining legacy Gantt mappings", () => {
    expect(SemanticFigureSpecV1_1Schema.safeParse(validSpec).success).toBe(true);
    expect(SemanticFigureSpecSchema.safeParse({
      figureId: "FIG-GANTT-LEGACY",
      requirementId: "REQ-001",
      pageId: "PAGE-001",
      title: "수행 일정",
      intent: "schedule",
      dataShape: "time_axis",
      decisionTask: "일정의 타당성을 검토한다.",
      claimIds: ["CLAIM-001"],
      evidenceIds: ["EV-001"],
      family: "gantt",
      renderer: "svg-gantt",
    }).success).toBe(true);
  });

  it("rejects vNext relationship/reference-family and renderer-version mismatches", () => {
    expect(SemanticFigureSpecV1_1Schema.safeParse({ ...validSpec, referenceFamily: "matrix" }).success).toBe(false);
    expect(SemanticFigureSpecV1_1Schema.safeParse({ ...validSpec, rendererVersion: "0.0.0" }).success).toBe(false);
    const { rendererFingerprint: _fingerprint, ...missingFingerprint } = validSpec;
    expect(SemanticFigureSpecV1_1Schema.safeParse(missingFingerprint).success).toBe(false);
    expect(SemanticFigureSpecV1_1Schema.safeParse({
      ...validSpec,
      rendererFingerprint: {
        ...validSpec.rendererFingerprint,
        fontProfile: { ...validSpec.rendererFingerprint.fontProfile, files: [] },
      },
    }).success).toBe(false);
    expect(SemanticFigureSpecV1_1Schema.safeParse({
      ...validSpec,
      rendererFingerprint: {
        ...validSpec.rendererFingerprint,
        rasterizer: { ...validSpec.rendererFingerprint.rasterizer, version: "LibreOffice 25.0.0" },
      },
    }).success).toBe(true);
  });

  it("keeps legacy v1 parsing unchanged and requires an explicit v1.1 compatibility adapter", async () => {
    const { evidenceIds: _evidence, rendererFingerprint: _renderer, ...legacyFields } = validSpec;
    const legacy = { ...legacyFields, schemaVersion: "semantic-figure-spec/v1" as const };
    expect(SemanticFigureSpecV1Schema.safeParse(legacy).success).toBe(true);
    const adapted = adaptLegacySemanticFigureSpec(legacy, { evidenceIds: validSpec.evidenceIds, rendererFingerprint: validSpec.rendererFingerprint });
    expect((await compileFigure(adapted, validData, validReferences)).figureId).toBe(legacy.figureId);
  });

  it("renders the same spec and data to the same SVG hash", async () => {
    const first = await compileFigure(validSpec, validData, validReferences);
    const second = await compileFigure(validSpec, validData, validReferences);

    expect(first.sha256).toBe(second.sha256);
    expect(first.svg).toBe(second.svg);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rasterizes the same canonical SVG to the same locked PNG hash", async () => {
    const fixture = await fakeRendererEnvironment();
    try {
      const fingerprint = await inspectSemanticRendererFingerprint(fixture.environment);
      const svg = await compileFigure({ ...validSpec, rendererFingerprint: fingerprint }, validData, validReferences);
      const first = await compileFigurePng(svg, { environment: fixture.environment });
      const second = await compileFigurePng(svg, { environment: fixture.environment });
      expect(first.sha256).toBe(second.sha256);
      expect(Buffer.compare(first.png, second.png)).toBe(0);
      expect(first.sourceSvgSha256).toBe(svg.sha256);
      const stalePin = await compileFigure({
        ...validSpec,
        rendererFingerprint: { ...fingerprint, environment: { ...fingerprint.environment, locale: `${fingerprint.environment.locale}-stale` } },
      }, validData, validReferences);
      await expect(compileFigurePng(stalePin, { environment: fixture.environment })).rejects.toThrow(/locale|fingerprint|environment/i);
      await writeFile(join(fixture.root, "resource.dat"), "tampered-resource-bytes", "utf8");
      await expect(compileFigurePng(svg, { environment: fixture.environment })).rejects.toThrow(/resource|fingerprint|environment/i);
      await writeFile(join(fixture.root, "resource.dat"), "locked-libreoffice-resource", "utf8");
      await writeFile(fixture.environment.fontFilePaths[0]!, "tampered-font-bytes", "utf8");
      await expect(compileFigurePng(svg, { environment: fixture.environment })).rejects.toThrow(/font|fingerprint|environment/i);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 60_000);

  it.each([
    ["trend", "line", "time-trend"],
    ["comparison", "comparison_chart", "comparison"],
    ["composition", "composition", "composition"],
    ["matrix", "matrix", "requirement-matrix"],
    ["process", "flow", "process"],
    ["framework", "framework", "research-framework"],
  ] as const)("renders the %s relationship through the %s canonical IR family", async (
    relationship,
    referenceFamily,
    expectedFamily,
  ) => {
    const spec = { ...validSpec, relationship, referenceFamily };
    const references = [{ ...validReferences[0]!, referenceFamily }];
    const artifact = await compileFigure(spec, dataFor(relationship), references);

    expect(artifact.ir.family).toBe(expectedFamily);
    expect(artifact.svg).toContain(`data-kpp-family="${expectedFamily}"`);
    expect(artifact.svg).toContain(spec.analyticalQuestion);
    expect(artifact.svg).toContain(spec.sourceCaption.text);
  });

  it("binds source, data, claim, reference, IR, renderer, and output hashes", async () => {
    const artifact = await compileFigure(validSpec, validData, validReferences);

    expect(artifact.lineage).toMatchObject({
      dataIds: ["DATA-TREND-001"],
      sourceIds: ["SRC-001"],
      claimIds: ["CLAIM-001"],
      evidenceIds: ["EV-001"],
      referenceIds: ["REF-LINE-001"],
    });
    expect(artifact.hashes).toEqual(expect.objectContaining({
      specSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      dataSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      referencesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      irSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      outputSha256: artifact.sha256,
    }));
    expect(artifact.rendererVersion).toBe(VISUAL_EVIDENCE_RENDERER_VERSION);
    expect(artifact.compilerApproval).toBe("not_authorized");
    expect(artifact.svg).toContain(`data-source-sha256="${SOURCE_SHA}"`);
    expect(artifact.svg).toContain('data-claim-ids="CLAIM-001"');
    expect(artifact.svg).toContain('data-evidence-ids="EV-001"');
    expect(artifact.svg).toContain("data-renderer-fingerprint-sha256=");
  });

  it("rejects data, reference-family, renderer-version, and rights mismatches", async () => {
    await expect(compileFigure(
      { ...validSpec, dataIds: ["DATA-MISSING"] },
      validData,
      validReferences,
    )).rejects.toThrow(/data.*id|dataset/i);
    await expect(compileFigure(
      { ...validSpec, referenceFamily: "bar" },
      validData,
      validReferences,
    )).rejects.toThrow(/reference.*family|family.*reference/i);
    await expect(compileFigure(
      { ...validSpec, rendererVersion: "0.0.0" },
      validData,
      validReferences,
    )).rejects.toThrow(/renderer.*version|version.*renderer/i);
    await expect(compileFigure(
      validSpec,
      validData,
      [{ ...validReferences[0]!, approved: false }],
    )).rejects.toThrow(/approved.*reference|reference.*approved/i);
    await expect(compileFigure(
      validSpec,
      validData,
      [{ ...validReferences[0]!, rightsStatus: "unknown" } as unknown as GovernedFigureReference],
    )).rejects.toThrow(/rights|reference/i);
    await expect(compileFigure(
      validSpec,
      validData,
      [{
        ...validReferences[0]!,
        storageClass: "public_canonical_fixture",
        rightsStatus: "project_private",
        synthetic: false,
        publiclyReleasable: true,
        sourceLineageClass: "project_private",
      }],
    )).rejects.toThrow(/public|synthetic|private|rights/i);
    await expect(compileFigure(
      {
        ...validSpec,
        rendererFingerprint: {
          ...validSpec.rendererFingerprint,
          tokenProfile: { ...validSpec.rendererFingerprint.tokenProfile, sha256: "0".repeat(64) },
        },
      },
      validData,
      validReferences,
    )).rejects.toThrow(/fingerprint|token/i);
  });

  it.each([
    ["public fixture with generic approval rights", { ...validReferences[0]!, storageClass: "public_canonical_fixture", rightsStatus: "approved", synthetic: true, publiclyReleasable: true, sourceLineageClass: "public" }],
    ["public fixture with private lineage", { ...validReferences[0]!, storageClass: "public_canonical_fixture", rightsStatus: "licensed", synthetic: true, publiclyReleasable: true, sourceLineageClass: "project_private" }],
    ["private source claimed releasable", { ...validReferences[0]!, storageClass: "private_source_reference", rightsStatus: "project_private", publiclyReleasable: true, sourceLineageClass: "project_private" }],
    ["unpromoted private extracted pattern", { ...validReferences[0]!, storageClass: "extracted_visual_pattern", rightsStatus: "approved", publiclyReleasable: true, sourceLineageClass: "project_private", humanPromoted: false }],
  ] as const)("rejects the invalid rights matrix row: %s", async (_name, reference) => {
    expect(GovernedFigureReferenceSchema.safeParse(reference).success).toBe(false);
    await expect(compileFigure(validSpec, validData, [reference])).rejects.toThrow(/public|private|rights|promot|reference/i);
  });

  it("allows only a bounded human-promoted extracted pattern to release private lineage", async () => {
    const promoted = { ...validReferences[0]!, publiclyReleasable: true, humanPromoted: true };
    expect(GovernedFigureReferenceSchema.safeParse(promoted).success).toBe(true);
    await expect(compileFigure(validSpec, validData, [promoted])).resolves.toEqual(expect.objectContaining({ figureId: validSpec.figureId }));
  });

  it("never promotes reviewed input to human approval", async () => {
    const artifact = await compileFigure(validSpec, validData, validReferences);

    expect(artifact.approvalStatus).toBe("reviewed");
    expect(artifact).not.toHaveProperty("humanApprovedBy");
  });
});

function dataFor(relationship: SemanticFigureSpecV1_1["relationship"]): VisualEvidenceData {
  if (relationship === "trend") return validData;
  const common = {
    sourceId: "SRC-001",
    sourceSha256: SOURCE_SHA,
    rawLocator: "table:1,row:1",
    claimIds: ["CLAIM-001"],
  } as const;
  const observations = relationship === "comparison"
    ? [
        { observationId: "OBS-A", label: "기관 A", category: "기관 A", value: 70, ...common },
        { observationId: "OBS-B", label: "기관 B", category: "기관 B", value: 55, ...common },
      ]
    : relationship === "composition"
      ? [
          { observationId: "OBS-A", label: "인건비", category: "인건비", value: 60, ...common },
          { observationId: "OBS-B", label: "운영비", category: "운영비", value: 40, ...common },
        ]
      : relationship === "matrix"
        ? [
            { observationId: "OBS-A", label: "충족", row: "REQ-001", column: "방법론", value: 1, ...common },
            { observationId: "OBS-B", label: "보완", row: "REQ-002", column: "산출물", value: 0, ...common },
          ]
        : [
            { observationId: "NODE-A", label: "현황 진단", nodeId: "A", layer: "입력", ...common },
            { observationId: "NODE-B", label: "실행 설계", nodeId: "B", layer: "산출", ...common },
            { observationId: "EDGE-A-B", label: "분석", from: "A", to: "B", ...common },
          ];
  return {
    datasets: [{
      dataId: "DATA-TREND-001",
      sourceIds: ["SRC-001"],
      unit: relationship === "composition" ? "%" : "점",
      denominator: relationship === "composition" ? "전체 예산" : "동일 지표",
      observations,
    }],
  };
}

async function fakeRendererEnvironment(): Promise<{ root: string; environment: RendererEnvironmentInput }> {
  const root = await mkdtemp(join(tmpdir(), "kpp-renderer-env-"));
  const sofficePath = join(root, "soffice");
  const resourcePath = join(root, "resource.dat");
  const fontPath = join(root, "NotoSansCJKkr-Regular.otf");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--version")) { console.log("LibreOffice 26.2.4.2 20(Build:2)"); process.exit(0); }
const outdir = process.argv[process.argv.indexOf("--outdir") + 1];
fs.writeFileSync(path.join(outdir, "figure.png"), Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]));
`;
  await Promise.all([
    writeFile(sofficePath, script, "utf8"),
    writeFile(resourcePath, "locked-libreoffice-resource", "utf8"),
    writeFile(fontPath, "locked-font-bytes", "utf8"),
  ]);
  await chmod(sofficePath, 0o755);
  return {
    root,
    environment: {
      sofficePath,
      libreOfficeBundlePath: root,
      fontFilePaths: [fontPath],
    },
  };
}
