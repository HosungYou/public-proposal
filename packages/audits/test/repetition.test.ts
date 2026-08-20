import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  auditSurfaceRepetition,
  resolveSurfaceRepetitionAuthority,
  type SurfaceTopologyObservation,
} from "../src/index.js";
import { PageArchitectureManifestSchema } from "@longtable/kpp-schemas";
import { sha256File } from "@longtable/kpp-core";

const repeated: readonly SurfaceTopologyObservation[] = [
  { pageLocator: "page:0002", topologySignature: "d".repeat(64) },
  { pageLocator: "page:0003", topologySignature: "d".repeat(64) },
];

describe("rendered surface topology repetition audit", () => {
  test("blocks identical topology signatures across a consecutive run", () => {
    const result = auditSurfaceRepetition(repeated);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "KPP_RENDER_SURFACE_TOPOLOGY_REPETITION",
      actual: expect.objectContaining({ pages: ["page:0002", "page:0003"] }),
    }));
  });

  test("allows only an explicit source-bound permitted exception", () => {
    const result = auditSurfaceRepetition(repeated.map((observation) => ({
      ...observation,
      permittedException: {
        ruleId: "issuer_mandatory_form",
        sourceId: "SRC-ISSUER-FORM-001",
        sourceSha256: "e".repeat(64),
        rationale: "발주기관 필수 양식의 반복 표지다.",
      },
    })));

    expect(result.status).toBe("PASS");
  });

  test("blocks a repeated run when its exceptions cite different authorities", () => {
    const result = auditSurfaceRepetition(repeated.map((observation, index) => ({
      ...observation,
      permittedException: {
        ruleId: "issuer_mandatory_form",
        sourceId: index === 0 ? "SRC-ISSUER-FORM-001" : "SRC-ARBITRARY",
        sourceSha256: "e".repeat(64),
        rationale: "발주기관 필수 양식의 반복 표지다.",
      },
    })));

    expect(result.status).toBe("BLOCKED");
    expect(result.findings.map(({ code }) => code)).toContain("KPP_RENDER_SURFACE_TOPOLOGY_REPETITION");
  });

  test("resolves only a declared, verified source-bound exception from persisted architecture", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpp-repetition-authority-"));
    try {
      const sourcePath = join(root, "issuer-form.txt");
      await writeFile(sourcePath, "issuer mandatory form\n", "utf8");
      const sourceSha256 = await sha256File(sourcePath);
      const referencePath = join(root, "reference-manifest.json");
      await writeFile(referencePath, `${JSON.stringify({
        schemaVersion: "2.0.0", projectId: "authority-fixture", documentMode: "research_service", modePolicyVersion: "1.0.0",
        references: [{
          referenceId: "SRC-ISSUER-FORM-001", referenceClass: "issuer_rule", sourcePath, sourceSha256,
          targets: [{ kind: "page", id: "P-01" }], verificationStatus: "verified", availability: "available",
        }],
      })}\n`, "utf8");
      const architecture = (sourceId: string) => PageArchitectureManifestSchema.parse({
        schemaVersion: "2.0.0", projectId: "authority-fixture", documentMode: "research_service", modePolicyVersion: "1.0.0",
        architectureStatus: "complete", chapters: [{ chapterId: "CH-01" }], sections: [{ sectionId: "SEC-01", chapterId: "CH-01" }],
        pages: ["P-01", "P-02"].map((pageId) => ({
          pageId, chapterId: "CH-01", sectionId: "SEC-01", pageRole: "research_method", surfaceTemplateId: "issuer-form",
          titleScope: "section", continuation: false, dominantSurface: "form", surfaceVisibility: "reader",
          claimIds: [], proofIds: [], referenceIds: [sourceId], figureIds: [],
          surfaceRepetitionException: { ruleId: "issuer_mandatory_form", sourceId, sourceSha256, rationale: "발주기관 필수 양식의 반복 표지다." },
        })),
      });
      const accepted = await resolveSurfaceRepetitionAuthority(architecture("SRC-ISSUER-FORM-001"), referencePath);
      expect(accepted.findings).toEqual([]);
      expect(auditSurfaceRepetition(repeated.map((page, index) => ({
        ...page,
        permittedException: accepted.exceptions.get(`P-0${index + 1}`),
      }))).status).toBe("PASS");

      const rejected = await resolveSurfaceRepetitionAuthority(architecture("SRC-ARBITRARY"), referencePath);
      expect(rejected.findings.map(({ code }) => code)).toContain("KPP_RENDER_SURFACE_TOPOLOGY_EXCEPTION_UNBOUND");
      expect(auditSurfaceRepetition(repeated.map((page, index) => ({
        ...page,
        permittedException: rejected.exceptions.get(`P-0${index + 1}`),
      }))).status).toBe("BLOCKED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
