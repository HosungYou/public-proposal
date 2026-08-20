import { describe, expect, test } from "vitest";
import {
  auditSurfaceRepetition,
  type SurfaceTopologyObservation,
} from "../src/index.js";

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
        rationale: "발주기관 필수 양식의 반복 표지다.",
      },
    })));

    expect(result.status).toBe("PASS");
  });
});
