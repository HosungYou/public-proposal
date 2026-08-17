import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTopologyStudyRequest,
  planFigure,
  sha256File,
  validateVisualSourcePacket,
} from "../src/index.js";

describe("semantic figure planner", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ));
  });

  it("routes a milestone schedule to a Gantt and rejects generic cards", () => {
    expect(planFigure(baseRequest({
      intent: "schedule",
      dataShape: "time_axis",
      hasTimeAxis: true,
    }))).toMatchObject({
      family: "gantt",
      renderer: "svg-gantt",
    });

    expectPlanError(() => planFigure(baseRequest({
      intent: "schedule",
      dataShape: "time_axis",
      hasTimeAxis: true,
      requestedFamily: "generic_cards",
    })), "KPP_DESIGN_FIGURE_FAMILY");
  });

  it.each([
    ["responsibility", "responsibility_matrix", "raci", "word-native-raci-table"],
    ["matrix", "two_by_two", "matrix", "svg-2x2-matrix"],
    ["comparison", "comparison_series", "comparison_chart", "svg-comparison-chart"],
    ["evidence_chain", "evidence_links", "evidence_chain", "svg-evidence-chain"],
  ] as const)("routes %s data to the typed %s family", (
    intent,
    dataShape,
    family,
    renderer,
  ) => {
    expect(planFigure(baseRequest({ intent, dataShape }))).toMatchObject({ family, renderer });
  });

  it("rejects a requested family that contradicts the page meaning", () => {
    expectPlanError(() => planFigure(baseRequest({
      intent: "matrix",
      dataShape: "two_by_two",
      requestedFamily: "gantt",
    })), "KPP_DESIGN_FIGURE_FAMILY");
  });

  it("refuses to plan a data-bearing figure with no evidence IDs", () => {
    expectPlanError(() => planFigure({
      ...baseRequest({ intent: "comparison", dataShape: "comparison_series" }),
      evidenceIds: [],
    }), "KPP_EVIDENCE_FIGURE_UNBOUND");
  });

  it("validates actual inspected Korean reference pages and emits only a provisional topology study", async () => {
    const source = await createVisualSourceFixture(temporaryDirectories);
    const packet = await validateVisualSourcePacket(source.packet);

    expect(packet.referencePages).toHaveLength(3);
    await expect(createTopologyStudyRequest({
      figure: planFigure(baseRequest({
        intent: "research_framework",
        dataShape: "research_framework",
      })),
      visualSourcePacket: source.packet,
      researchLogic: source.researchLogic,
      evidenceLedger: source.evidenceLedger,
      directFinalUse: false,
    })).resolves.toMatchObject({
      status: "composition_candidate",
      directFinalUse: false,
      finalEvidenceAllowed: false,
      sourcePacketSha256: packet.packetSha256,
      renderer: "svg-academic-framework",
      evidenceIds: ["EV-001"],
      evidenceBindings: [expect.objectContaining({
        evidenceId: "EV-001",
        targetRequirementId: "REQ-001",
        targetPageId: "page-01",
      })],
    });
  });

  it("normalizes inspected visual source paths to absolute provenance paths", async () => {
    const source = await createVisualSourceFixture(temporaryDirectories);
    const packet = await validateVisualSourcePacket({
      ...source.packet,
      referencePages: source.packet.referencePages.map((page) => ({
        ...page,
        path: relative(process.cwd(), page.path),
      })),
    });

    expect(packet.referencePages.every((page) => isAbsolute(page.path))).toBe(true);
    expect(packet.referencePages.map((page) => page.path)).toEqual(
      source.packet.referencePages.map((page) => page.path),
    );
  });

  it("blocks a topology study when direct final use is requested or an inspected hash is wrong", async () => {
    const source = await createVisualSourceFixture(temporaryDirectories);
    const figure = planFigure(baseRequest({
      intent: "research_framework",
      dataShape: "research_framework",
    }));

    await expect(createTopologyStudyRequest({
      figure,
      visualSourcePacket: source.packet,
      researchLogic: source.researchLogic,
      evidenceLedger: source.evidenceLedger,
      directFinalUse: true,
    })).rejects.toMatchObject({ code: "KPP_DESIGN_TOPOLOGY_FINAL_USE" });

    await expect(createTopologyStudyRequest({
      figure: { ...figure, evidenceIds: [] },
      visualSourcePacket: source.packet,
      researchLogic: source.researchLogic,
      evidenceLedger: source.evidenceLedger,
      directFinalUse: false,
    })).rejects.toMatchObject({ code: "KPP_INPUT_FIGURE_INVALID" });

    await expect(createTopologyStudyRequest({
      figure: {
        ...figure,
        intent: "schedule",
        dataShape: "time_axis",
      },
      visualSourcePacket: source.packet,
      researchLogic: source.researchLogic,
      evidenceLedger: source.evidenceLedger,
      directFinalUse: false,
    })).rejects.toMatchObject({ code: "KPP_INPUT_FIGURE_INVALID" });

    await expect(createTopologyStudyRequest({
      figure,
      visualSourcePacket: source.packet,
      researchLogic: source.researchLogic,
      evidenceLedger: {
        ...source.evidenceLedger,
        bindings: [],
      },
      directFinalUse: false,
    })).rejects.toMatchObject({ code: "KPP_EVIDENCE_FIGURE_UNBOUND" });

    await expect(createTopologyStudyRequest({
      figure: { ...figure, evidenceIds: ["EV-404"] },
      visualSourcePacket: source.packet,
      researchLogic: source.researchLogic,
      evidenceLedger: source.evidenceLedger,
      directFinalUse: false,
    })).rejects.toMatchObject({ code: "KPP_EVIDENCE_FIGURE_UNBOUND" });

    await expect(validateVisualSourcePacket({
      ...source.packet,
      referencePages: [{
        ...source.packet.referencePages[0]!,
        sha256: "0".repeat(64),
      }, source.packet.referencePages[1]!, source.packet.referencePages[2]!],
    })).rejects.toMatchObject({ code: "KPP_INPUT_VISUAL_SOURCE_UNVERIFIED" });

    const renamedTextPath = join(source.root, "not-an-image.png");
    await writeFile(renamedTextPath, "not a PNG file");
    await expect(validateVisualSourcePacket({
      ...source.packet,
      referencePages: [{
        ...source.packet.referencePages[0]!,
        path: renamedTextPath,
        sha256: await sha256File(renamedTextPath),
      }, source.packet.referencePages[1]!, source.packet.referencePages[2]!],
    })).rejects.toMatchObject({ code: "KPP_INPUT_VISUAL_SOURCE_UNVERIFIED" });

    await expect(validateVisualSourcePacket({
      ...source.packet,
      referencePages: [
        source.packet.referencePages[0]!,
        { ...source.packet.referencePages[1]!, rightsStatus: "owned" },
        { ...source.packet.referencePages[2]!, rightsStatus: "licensed" },
      ],
    })).rejects.toMatchObject({ code: "KPP_INPUT_VISUAL_SOURCE_INVALID" });
  });
});

function expectPlanError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected the planner to reject the figure request");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    figureId: "fig-01",
    requirementId: "REQ-001",
    pageId: "page-01",
    title: "연구 수행 구조",
    intent: "flow",
    dataShape: "process_flow",
    decisionTask: "평가자가 수행 방법을 검토한다.",
    evidenceIds: ["EV-001"],
    claimIds: ["CLAIM-001"],
    ...overrides,
  };
}

async function createVisualSourceFixture(temporaryDirectories: string[]) {
  const root = await mkdtemp(join(tmpdir(), "kpp-figure-source-"));
  temporaryDirectories.push(root);
  const firstPage = join(root, "issuer-reference-page-01.png");
  const secondPage = join(root, "public-report-page-02.png");
  const thirdPage = join(root, "public-report-page-03.png");
  const researchLogicPath = join(root, "research-logic.yaml");
  const evidencePath = join(root, "research-evidence.txt");
  await Promise.all([
    writeFile(firstPage, minimalPng()),
    writeFile(secondPage, minimalPng()),
    writeFile(thirdPage, minimalPng()),
    writeFile(researchLogicPath, "status: locked\nlogic: evidence-to-decision\n"),
    writeFile(evidencePath, "confirmed research evidence\n"),
  ]);
  const [firstSha, secondSha, thirdSha, logicSha, evidenceSha] = await Promise.all([
    sha256File(firstPage),
    sha256File(secondPage),
    sha256File(thirdPage),
    sha256File(researchLogicPath),
    sha256File(evidencePath),
  ]);
  const packet = {
    schemaVersion: "1.0.0",
    referencePages: [
      {
        path: firstPage,
        sha256: firstSha,
        language: "ko",
        rightsStatus: "issuer_provided",
        classification: "issuer_reference",
        sourceId: "KEITI-RFP-2026",
        pageLocator: "page:1",
        inspectedAt: "2026-08-17T00:00:00.000Z",
      },
      {
        path: secondPage,
        sha256: secondSha,
        language: "ko",
        rightsStatus: "public_reference",
        classification: "report_reference",
        sourceId: "REPORT-2025-A",
        pageLocator: "page:12",
        inspectedAt: "2026-08-17T00:00:00.000Z",
      },
      {
        path: thirdPage,
        sha256: thirdSha,
        language: "ko",
        rightsStatus: "public_reference",
        classification: "official_template",
        sourceId: "TEMPLATE-2025-B",
        pageLocator: "page:3",
        inspectedAt: "2026-08-17T00:00:00.000Z",
      },
    ],
  } as const;
  const researchLogic = {
    logicId: "framework-01",
    status: "locked",
    path: researchLogicPath,
    sha256: logicSha,
  } as const;
  const evidenceLedger = {
    schemaVersion: "1.0.0",
    claims: [{
      claimId: "CLAIM-001",
      status: "verified",
      evidenceIds: ["EV-001"],
    }],
    bindings: [{
      evidenceId: "EV-001",
      sourcePath: evidencePath,
      sourceSha256: evidenceSha,
      scope: "연구 프레임워크의 근거",
      claimIds: ["CLAIM-001"],
      targetRequirementId: "REQ-001",
      targetPageId: "page-01",
      targetPageRole: "research_framework",
    }],
  } as const;
  return { root, packet, researchLogic, evidenceLedger };
}

function minimalPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLkYQAAAABJRU5ErkJggg==",
    "base64",
  );
}
