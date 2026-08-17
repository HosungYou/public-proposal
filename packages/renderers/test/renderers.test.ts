import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  R08_RENDERER_TOKENS,
  renderFigure,
  renderFigureHash,
  type FigureSpec,
} from "../src/index.js";

const gantt: FigureSpec = {
  figureId: "FIG-GANTT-001",
  family: "gantt",
  title: "연구 수행 일정",
  caption: "그림 1. 연구 수행 일정과 검토 관문",
  evidenceIds: ["EV-SCHEDULE-001"],
  claimIds: ["CL-SCHEDULE-001"],
  inputKind: "semantic",
  data: {
    kind: "time_axis",
    periods: ["1개월", "2개월", "3개월", "4개월"],
    workPackages: [
      {
        id: "WP1",
        label: "현황 진단",
        owner: "연구책임자",
        start: 0,
        end: 1,
        evidenceIds: ["EV-WP1"],
      },
      {
        id: "WP2",
        label: "실행안 설계",
        owner: "분석팀",
        start: 1,
        end: 3,
        evidenceIds: ["EV-WP2"],
      },
    ],
    milestones: [
      {
        id: "MS1",
        label: "중간보고 승인",
        period: 2,
        owner: "발주기관",
        evidenceIds: ["EV-MS1"],
        acceptance: "수용",
      },
    ],
  },
};

const raci: FigureSpec = {
  figureId: "FIG-RACI-001",
  family: "raci",
  title: "업무 책임 체계",
  caption: "그림 2. 과업별 책임과 검토 상태",
  evidenceIds: ["EV-RACI-001"],
  claimIds: ["CL-RACI-001"],
  inputKind: "semantic",
  data: {
    kind: "responsibility_matrix",
    actors: ["발주기관", "연구책임자", "분석팀"],
    activities: [
      {
        id: "ACT1",
        label: "현황 진단",
        assignments: ["A", "R", "C"],
        owner: "연구책임자",
        state: "진행",
        evidenceIds: ["EV-ACT1"],
        acceptance: "중간보고 승인",
      },
    ],
  },
};

const framework: FigureSpec = {
  figureId: "FIG-FRAMEWORK-001",
  family: "framework",
  title: "연구 분석 프레임워크",
  caption: "그림 3. 근거에서 실행안까지의 연구 논리",
  evidenceIds: ["EV-FRAMEWORK-001"],
  claimIds: ["CL-FRAMEWORK-001"],
  inputKind: "semantic",
  data: {
    kind: "research_framework",
    readingOrder: ["input", "method", "output"],
    nodes: [
      {
        id: "input",
        label: "정책·기관 근거",
        owner: "자료팀",
        state: "검증",
        evidenceIds: ["EV-INPUT"],
        acceptance: "출처 확인",
      },
      {
        id: "method",
        label: "교차 분석",
        owner: "분석팀",
        state: "분석",
        evidenceIds: ["EV-METHOD"],
        acceptance: "재현 가능",
      },
      {
        id: "output",
        label: "실행 로드맵",
        owner: "연구책임자",
        state: "후보",
        evidenceIds: ["EV-OUTPUT"],
        acceptance: "기관 수용",
      },
    ],
    edges: [
      { from: "input", to: "method", label: "분석" },
      { from: "method", to: "output", label: "종합" },
    ],
  },
};

describe("deterministic proposal figure renderers", () => {
  it("renders a Gantt with an axis, rows, bars, and milestones", async () => {
    const svg = await renderFigure(gantt);

    expect(svg).toContain('data-kpp-role="time-axis"');
    expect(svg).toContain('data-kpp-role="work-package-row"');
    expect(svg).toContain('data-kpp-role="duration-bar"');
    expect(svg).toContain('data-kpp-role="milestone"');
    expect(svg.indexOf("WP1 · 현황 진단")).toBeLessThan(svg.indexOf("WP2 · 실행안 설계"));
    expect(svg).toContain("중간보고 승인");
  });

  it("renders RACI reading order with responsibility, state, evidence, and acceptance text", async () => {
    const svg = await renderFigure(raci);

    expect(svg).toContain('data-kpp-role="raci-row"');
    expect(svg).toContain('data-owner="연구책임자"');
    expect(svg).toContain('data-state="진행"');
    expect(svg).toContain('data-evidence-ids="EV-ACT1"');
    expect(svg).toContain("중간보고 승인");
    expect(svg.indexOf("발주기관")).toBeLessThan(svg.indexOf("연구책임자"));
  });

  it("renders the framework in declared reading order with evidence and acceptance semantics", async () => {
    const svg = await renderFigure(framework);

    expect(svg.indexOf("정책·기관 근거")).toBeLessThan(svg.indexOf("교차 분석"));
    expect(svg.indexOf("교차 분석")).toBeLessThan(svg.indexOf("실행 로드맵"));
    expect(svg).toContain('data-kpp-role="framework-node"');
    expect(svg).toContain('data-owner="자료팀"');
    expect(svg).toContain('data-evidence-ids="EV-INPUT"');
    expect(svg).toContain("출처 확인");
    expect(svg).toContain('data-kpp-role="connector"');
  });

  it("produces identical SVG and SHA-256 for identical ordered input", async () => {
    const first = await renderFigure(gantt);
    const second = await renderFigure(gantt);

    expect(second).toBe(first);
    expect(await renderFigureHash(gantt)).toBe(createHash("sha256").update(first).digest("hex"));
    expect(await renderFigureHash(gantt)).toBe(await renderFigureHash(gantt));
  });

  it("rejects empty evidence bindings and mismatched family data", async () => {
    await expect(renderFigure({ ...gantt, evidenceIds: [] })).rejects.toThrow(/evidence/i);
    await expect(renderFigure({ ...gantt, data: framework.data } as unknown as FigureSpec)).rejects.toThrow(
      /family.*data|data.*family/i,
    );
  });

  it.each(["raster", "imagegen"])("rejects %s final inputs", async (inputKind) => {
    await expect(renderFigure({ ...framework, inputKind } as unknown as FigureSpec)).rejects.toThrow(
      /semantic|raster|imagegen/i,
    );
  });

  it("rejects values outside the closed RACI assignment vocabulary", async () => {
    const malformed = {
      ...raci,
      data: {
        ...raci.data,
        activities: [{ ...raci.data.activities[0], assignments: ["A", "R", "owner"] }],
      },
    };

    await expect(renderFigure(malformed as unknown as FigureSpec)).rejects.toThrow(/RACI.*assignment/i);
  });

  it("uses the R08 neutral palette, square boxes, and readable label sizes", async () => {
    const svg = await renderFigure(framework);

    expect(R08_RENDERER_TOKENS).toEqual({
      paper: "#FCFCFA",
      ink: "#1D232B",
      navy: "#082F63",
      navySecondary: "#234D7B",
      muted: "#626D79",
      hairline: "#C9CFD6",
      surface: "#F4F6F8",
      surfaceStrong: "#E8EEF5",
      warning: "#B96B13",
      minimumLabelPt: 8,
    });
    expect(svg).not.toMatch(/<linearGradient|<radialGradient|filter=|<image\b|\brx=/);
    expect(svg).toContain("font-size:8pt");
    expect(svg).toContain('data-token-profile="R08-approved-project-profile"');
  });

  it("escapes untrusted text while retaining a readable SVG title and caption", async () => {
    const svg = await renderFigure({
      ...gantt,
      title: '일정 <검토> & "승인"',
      caption: "근거 > 일정",
    });

    expect(svg).toContain('<title id="figure-title">일정 &lt;검토&gt; &amp; &quot;승인&quot;</title>');
    expect(svg).toContain("근거 &gt; 일정");
    expect(svg).not.toContain("일정 <검토>");
  });
});
