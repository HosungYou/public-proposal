import { describe, expect, it } from "vitest";
import { renderObservationManifestFromGeometry } from "../src/index.js";

const identity = {
  projectId: "partnership-proposal",
  documentMode: "private_partnership" as const,
  modePolicyVersion: "1.0.0",
};

describe("render observation normalization", () => {
  it("binds measured geometry to the source artifact without copying planned roles", () => {
    const geometry = {
      schemaVersion: "1",
      docx: { path: "/tmp/proposal.docx", sha256: "a".repeat(64), bytes: 2048 },
      pageObservations: [{
        pageNumber: 1,
        pageLocator: "page:0001",
        sourceArtifactSha256: "a".repeat(64),
        measuredHeadingPointSizes: [20.5],
        titleBlocks: [{ textFingerprint: "b".repeat(64), pointSize: 20.5, region: "top" }],
        surfaceFamily: "chapter_opener",
        regionFingerprints: ["c".repeat(64)],
        geometry: {
          widthPoint: 595.28,
          heightPoint: 841.89,
          textBlockCount: 4,
          tableCount: 0,
          figureCount: 1,
        },
        continuationMarkers: { fromPrevious: false, toNext: true },
        pageRole: "must-not-be-copied",
      }],
    };

    const first = renderObservationManifestFromGeometry(geometry, identity);
    const second = renderObservationManifestFromGeometry(geometry, identity);

    expect(first).toEqual(second);
    expect(first.sourceArtifact).toEqual({
      path: "/tmp/proposal.docx",
      sha256: "a".repeat(64),
      bytes: 2048,
    });
    expect(first.pages[0]).not.toHaveProperty("pageRole");
    expect(first.pages[0]).toMatchObject({
      pageLocator: "page:0001",
      sourceArtifactSha256: "a".repeat(64),
      measuredHeadingPointSizes: [20.5],
    });
  });

  it("rejects non-deterministic or unbound page locators", () => {
    expect(() => renderObservationManifestFromGeometry({
      docx: { path: "/tmp/proposal.docx", sha256: "a".repeat(64), bytes: 2048 },
      pageObservations: [{ pageNumber: 1, pageLocator: "page one" }],
    }, identity)).toThrow(/page observation/i);
  });
});
