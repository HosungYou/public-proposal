import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FIGURE_RENDERER_VERSION,
  R08_RENDERER_TOKENS,
  R08_TOKEN_PROFILE_SHA256,
  renderFigure,
  renderFigureArtifact,
  renderFigureHash,
  verifyFigureArtifact,
  type FigureSpec,
} from "../src/index.js";
import { ganttFixture as gantt } from "./fixtures.js";

const raci: FigureSpec = {
  figureId: "FIG-RACI-001",
  family: "raci",
  title: "업무 책임 체계",
  caption: "그림 2. 과업별 책임과 검토 상태",
  evidenceIds: ["EV-RACI-001"],
  claimIds: ["CL-RACI-001"],
  inputKind: "semantic",
  tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
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
  tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
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

  it("binds ordered semantic input and SVG output into a deterministic figure manifest", async () => {
    const first = await renderFigureArtifact(gantt);
    const second = await renderFigureArtifact(gantt);

    expect(second).toEqual(first);
    expect(first.manifest).toMatchObject({
      schemaVersion: "1",
      renderer: { name: "@longtable/kpp-renderers", version: FIGURE_RENDERER_VERSION },
      figure: { id: "FIG-GANTT-001", family: "gantt" },
      tokenProfile: {
        id: "R08-approved-project-profile",
        sha256: R08_TOKEN_PROFILE_SHA256,
      },
      input: { kind: "semantic" },
      output: { format: "svg" },
    });
    expect(first.manifest.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.manifest.output.sha256).toBe(createHash("sha256").update(first.svg).digest("hex"));
    expect(first.manifest).not.toHaveProperty("png");
    expect(verifyFigureArtifact(first, gantt)).toBe(true);
  });

  it("rejects a missing or forged R08 token profile hash", async () => {
    const { tokenProfileHash: _missing, ...withoutTokenHash } = gantt;
    await expect(renderFigure(withoutTokenHash as FigureSpec)).rejects.toThrow(/token.*hash|profile/i);
    await expect(renderFigure({ ...gantt, tokenProfileHash: "0".repeat(64) })).rejects.toThrow(/token.*hash|profile/i);
  });

  it("detects a manifest/output hash mismatch", async () => {
    const artifact = await renderFigureArtifact(gantt);
    expect(() => verifyFigureArtifact({ ...artifact, svg: `${artifact.svg}\n<!-- tampered -->` }, gantt)).toThrow(
      /output.*hash|hash.*mismatch/i,
    );
    expect(() => verifyFigureArtifact({
      ...artifact,
      manifest: {
        ...artifact.manifest,
        tokenProfile: { ...artifact.manifest.tokenProfile, sha256: "0".repeat(64) },
      },
    }, gantt)).toThrow(/token.*hash|hash.*mismatch/i);
  });

  it("rejects tampered semantic input and manifest bindings", async () => {
    const artifact = await renderFigureArtifact(gantt);
    const manifestMutations = [
      { ...artifact.manifest, input: { ...artifact.manifest.input, sha256: "0".repeat(64) } },
      { ...artifact.manifest, figure: { ...artifact.manifest.figure, id: "FIG-TAMPERED" } },
      { ...artifact.manifest, figure: { ...artifact.manifest.figure, family: "raci" as const } },
      { ...artifact.manifest, bindings: { ...artifact.manifest.bindings, evidenceIds: ["EV-TAMPERED"] } },
      { ...artifact.manifest, bindings: { ...artifact.manifest.bindings, claimIds: ["CL-TAMPERED"] } },
    ];

    for (const manifest of manifestMutations) {
      expect(() => verifyFigureArtifact({ ...artifact, manifest }, gantt)).toThrow(
        /input|figure|family|binding|lineage|mismatch/i,
      );
    }

    expect(() => verifyFigureArtifact(artifact, { ...gantt, title: "변조된 입력" })).toThrow(
      /input|lineage|mismatch/i,
    );
  });

  it("rejects a manifest rebound to changed semantics without the corresponding SVG", async () => {
    const original = await renderFigureArtifact(gantt);
    const changedFigure = { ...gantt, title: "변경된 연구 수행 일정" };
    const changed = await renderFigureArtifact(changedFigure);
    const rebound = {
      svg: original.svg,
      manifest: { ...changed.manifest, output: original.manifest.output },
    };

    expect(() => verifyFigureArtifact(rebound, changedFigure)).toThrow(/render|semantic|lineage|mismatch/i);
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

  it("requires exactly one Accountable and at least one Responsible per RACI row", async () => {
    const duplicateAccountable = {
      ...raci,
      data: {
        ...raci.data,
        activities: [{ ...raci.data.activities[0], assignments: ["A", "A", "R"] }],
      },
    };
    const missingResponsible = {
      ...raci,
      data: {
        ...raci.data,
        activities: [{ ...raci.data.activities[0], assignments: ["A", "C", "I"] }],
      },
    };

    await expect(renderFigure(duplicateAccountable as FigureSpec)).rejects.toThrow(/exactly one.*Accountable/i);
    await expect(renderFigure(missingResponsible as FigureSpec)).rejects.toThrow(/Responsible/i);
  });

  it("rejects layout inputs that cannot retain readable Gantt or RACI cells", async () => {
    const overloadedRaci = {
      ...raci,
      data: { ...raci.data, actors: ["A", "B", "C", "D", "E", "F", "G"] },
    };
    const collidingGantt = {
      ...gantt,
      data: {
        ...gantt.data,
        milestones: [gantt.data.milestones[0], { ...gantt.data.milestones[0], id: "MS2" }],
      },
    };

    await expect(renderFigure(overloadedRaci as FigureSpec)).rejects.toThrow(/actor.*capacity|capacity.*actor/i);
    await expect(renderFigure(collidingGantt as FigureSpec)).rejects.toThrow(/milestone.*period|period.*milestone/i);
  });

  it("wraps four framework nodes inside the SVG viewBox and preserves forward reading order", async () => {
    const fourthNode = {
      id: "adoption",
      label: "기관 적용",
      owner: "기관담당",
      state: "수용",
      evidenceIds: ["EV-ADOPTION"],
      acceptance: "최종 승인",
    };
    const wrapped = {
      ...framework,
      data: {
        ...framework.data,
        readingOrder: [...framework.data.readingOrder, fourthNode.id],
        nodes: [...framework.data.nodes, fourthNode],
        edges: [...framework.data.edges, { from: "output", to: "adoption", label: "적용" }],
      },
    };

    const svg = await renderFigure(wrapped as FigureSpec);
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(viewBox).not.toBeNull();
    const width = Number(viewBox?.[1]);
    const height = Number(viewBox?.[2]);
    const nodeRects = [...svg.matchAll(/data-kpp-role="framework-node"[\s\S]*?<rect x="([\d.]+)" y="([\d.]+)" width="(\d+)" height="(\d+)"/g)];
    expect(nodeRects).toHaveLength(4);
    for (const match of nodeRects) {
      const [, x, y, nodeWidth, nodeHeight] = match.map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + nodeWidth).toBeLessThanOrEqual(width);
      expect(y + nodeHeight).toBeLessThanOrEqual(height);
    }
    expect(svg).toContain('data-reading-order="4"');
    expect(svg).toContain('data-from="output" data-to="adoption"');
    expect(svg).not.toMatch(/\bx="-/);
  });

  it("uses figure-scoped SVG IDs and references across multiple figures", async () => {
    const first = await renderFigure(framework);
    const second = await renderFigure({ ...framework, figureId: "FIG-FRAMEWORK-002" });
    const firstIds = [...first.matchAll(/(?:^|\s)id="([^"]+)"/g)].map((match) => match[1]);
    const secondIds = [...second.matchAll(/(?:^|\s)id="([^"]+)"/g)].map((match) => match[1]);

    expect(firstIds.length).toBeGreaterThanOrEqual(3);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
    expect(first).toContain(`aria-labelledby="${firstIds[0]} ${firstIds[1]}"`);
    expect(second).toContain(`aria-labelledby="${secondIds[0]} ${secondIds[1]}"`);
    expect(first).toContain(`url(#${firstIds[2]})`);
    expect(second).toContain(`url(#${secondIds[2]})`);
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

    expect(svg).toContain('>일정 &lt;검토&gt; &amp; &quot;승인&quot;</title>');
    expect(svg).toContain("근거 &gt; 일정");
    expect(svg).not.toContain("일정 <검토>");
  });
});
