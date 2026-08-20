import { describe, expect, it } from "vitest";
import type { PageArchitectureManifest } from "@longtable/kpp-schemas";
import {
  auditRenderedPageArchitecture,
  type RenderObservationManifest,
} from "../src/index.js";

const source = {
  path: "/tmp/proposal.docx",
  sha256: "a".repeat(64),
  bytes: 4096,
};

function architecture(): PageArchitectureManifest {
  return {
    schemaVersion: "2.0.0",
    projectId: "partnership-proposal",
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    architectureStatus: "complete",
    chapters: [],
    sections: [],
    pages: [
      page("P-01", "cover", false),
      page("P-02", "chapter", false),
      {
        ...page("P-03", "section", true),
        continuityFromPageId: "P-02",
      },
    ],
  };
}

function page(
  pageId: string,
  titleScope: "cover" | "chapter" | "section",
  continuation: boolean,
): PageArchitectureManifest["pages"][number] {
  return {
    pageId,
    chapterId: "CH-01",
    sectionId: "SEC-01",
    pageRole: "operating_model",
    surfaceTemplateId: "operating_model",
    titleScope,
    continuation,
    dominantSurface: "narrative",
    surfaceVisibility: "internal",
    claimIds: [],
    proofIds: [],
    referenceIds: [],
    figureIds: [],
  };
}

function observations(continuationSize = 12): RenderObservationManifest {
  return {
    schemaVersion: "1.0.0",
    projectId: "partnership-proposal",
    documentMode: "private_partnership",
    modePolicyVersion: "1.0.0",
    sourceArtifact: source,
    pages: [
      observed(1, 20.5, false, true),
      observed(2, 20.5, false, true),
      observed(3, continuationSize, true, false),
    ],
  };
}

function observed(
  pageNumber: number,
  headingSize: number,
  fromPrevious: boolean,
  toNext: boolean,
): RenderObservationManifest["pages"][number] {
  return {
    pageNumber,
    pageLocator: `page:${String(pageNumber).padStart(4, "0")}`,
    sourceArtifactSha256: source.sha256,
    measuredHeadingPointSizes: [headingSize],
    titleBlocks: [{
      textFingerprint: `${pageNumber}`.repeat(64).slice(0, 64),
      pointSize: headingSize,
      region: "top",
    }],
    surfaceFamily: pageNumber === 3 ? "narrative_continuation" : "chapter_opener",
    regionFingerprints: [`region-${pageNumber}`],
    geometry: {
      widthPoint: 595.28,
      heightPoint: 841.89,
      textBlockCount: 3,
      tableCount: 0,
      figureCount: 0,
    },
    continuationMarkers: { fromPrevious, toNext },
  };
}

describe("rendered page architecture audit", () => {
  it("accepts independently measured cover/chapter/continuation title hierarchy", () => {
    const result = auditRenderedPageArchitecture({
      architecture: architecture(),
      observations: observations(),
    });

    expect(result).toMatchObject({ status: "PASS", findings: [] });
    expect(result.artifacts).toEqual([source]);
  });

  it("blocks a measured 20.5pt title on a continuation page with a stable locator", () => {
    const result = auditRenderedPageArchitecture({
      architecture: architecture(),
      observations: observations(20.5),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "KPP_PAGE_TITLE_CONTINUATION_LARGE",
      path: "page:0003",
      expected: { maximumPointSize: 12, issuerOverride: false },
      actual: { measuredPointSize: 20.5, issuerOverride: false },
    }));
  });

  it("does not trust planned continuity when the rendered page has no measured marker", () => {
    const manifest = observations();
    manifest.pages[2]!.continuationMarkers.fromPrevious = false;

    const result = auditRenderedPageArchitecture({
      architecture: architecture(),
      observations: manifest,
    });

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "KPP_PAGE_CONTINUATION_UNOBSERVED",
      path: "page:0003",
    }));
  });

  it("permits a measured large continuation heading only with a manifest-bound issuer override", () => {
    const locked = architecture();
    locked.pages[2]!.issuerOverride = {
      documentMode: "private_partnership",
      modePolicyVersion: "1.0.0",
      sourceId: "SRC-ISSUER-01",
      reason: "파트너 지정 양식의 연속 면 제목 규칙",
    };

    expect(auditRenderedPageArchitecture({
      architecture: locked,
      observations: observations(20.5),
    })).toMatchObject({ status: "PASS", findings: [] });
  });
});
