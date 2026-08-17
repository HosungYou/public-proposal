import { createHash } from "node:crypto";

export const R08_RENDERER_TOKENS = {
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
} as const;

export const R08_TOKEN_PROFILE = "R08-approved-project-profile" as const;
export const R08_TOKEN_PROFILE_SHA256 = createHash("sha256")
  .update(stableCanonicalJson(R08_RENDERER_TOKENS))
  .digest("hex");

interface BaseFigureSpec {
  readonly figureId: string;
  readonly title: string;
  readonly caption: string;
  readonly evidenceIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly inputKind: "semantic";
  readonly tokenProfileHash: typeof R08_TOKEN_PROFILE_SHA256;
}

export interface GanttWorkPackage {
  readonly id: string;
  readonly label: string;
  readonly owner: string;
  readonly start: number;
  readonly end: number;
  readonly evidenceIds: readonly string[];
}

export interface GanttMilestone {
  readonly id: string;
  readonly label: string;
  readonly period: number;
  readonly owner: string;
  readonly evidenceIds: readonly string[];
  readonly acceptance: string;
}

export interface GanttData {
  readonly kind: "time_axis";
  readonly periods: readonly string[];
  readonly workPackages: readonly GanttWorkPackage[];
  readonly milestones: readonly GanttMilestone[];
}

export interface GanttFigureSpec extends BaseFigureSpec {
  readonly family: "gantt";
  readonly data: GanttData;
}

export type RaciAssignment = "R" | "A" | "C" | "I" | "-";

export interface RaciActivity {
  readonly id: string;
  readonly label: string;
  readonly assignments: readonly RaciAssignment[];
  readonly owner: string;
  readonly state: string;
  readonly evidenceIds: readonly string[];
  readonly acceptance: string;
}

export interface RaciData {
  readonly kind: "responsibility_matrix";
  readonly actors: readonly string[];
  readonly activities: readonly RaciActivity[];
}

export interface RaciFigureSpec extends BaseFigureSpec {
  readonly family: "raci";
  readonly data: RaciData;
}

export interface FrameworkNode {
  readonly id: string;
  readonly label: string;
  readonly owner: string;
  readonly state: string;
  readonly evidenceIds: readonly string[];
  readonly acceptance: string;
}

export interface FrameworkEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface FrameworkData {
  readonly kind: "research_framework";
  readonly readingOrder: readonly string[];
  readonly nodes: readonly FrameworkNode[];
  readonly edges: readonly FrameworkEdge[];
}

export interface FrameworkFigureSpec extends BaseFigureSpec {
  readonly family: "framework";
  readonly data: FrameworkData;
}

export type FigureSpec = GanttFigureSpec | RaciFigureSpec | FrameworkFigureSpec;

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ENTITIES[character] ?? character);
}

export function joinEvidenceIds(evidenceIds: readonly string[]): string {
  return evidenceIds.map(escapeXml).join(" ");
}

export function assertFigureBase(figure: FigureSpec): void {
  const candidate = figure as FigureSpec & { readonly inputKind?: unknown };
  if (candidate.inputKind !== "semantic") {
    throw new Error("Final figure input must be semantic; raster and imagegen inputs are prohibited");
  }
  assertText(candidate.figureId, "figureId");
  assertText(candidate.title, "title");
  assertText(candidate.caption, "caption");
  assertNonEmptyIds(candidate.evidenceIds, "evidenceIds");
  assertNonEmptyIds(candidate.claimIds, "claimIds");
  if (candidate.tokenProfileHash !== R08_TOKEN_PROFILE_SHA256) {
    throw new Error("R08 token profile hash is missing or does not match the canonical profile");
  }
}

export function assertText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

export function assertNonEmptyIds(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must contain at least one evidence or claim ID`);
  }
  for (const id of value) {
    assertText(id, field);
  }
}

export function svgOpen(figure: FigureSpec, width: number, height: number): string[] {
  const ids = figureScopedIds(figure.figureId);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${ids.title} ${ids.caption}" data-kpp-family="${figure.family}" data-token-profile="${R08_TOKEN_PROFILE}" data-token-hash="${R08_TOKEN_PROFILE_SHA256}">`,
    `  <title id="${ids.title}">${escapeXml(figure.title)}</title>`,
    `  <desc id="${ids.caption}">${escapeXml(figure.caption)}</desc>`,
    `  <rect width="${width}" height="${height}" fill="${R08_RENDERER_TOKENS.paper}"/>`,
    `  <style>text{font-family:"Noto Sans CJK KR","Noto Sans KR","맑은 고딕",sans-serif;font-size:${R08_RENDERER_TOKENS.minimumLabelPt}pt;fill:${R08_RENDERER_TOKENS.ink}}.title{font-size:12pt;font-weight:700;fill:${R08_RENDERER_TOKENS.navy}}.meta{font-size:8pt;fill:${R08_RENDERER_TOKENS.muted}}.strong{font-weight:700}</style>`,
    `  <text class="title" x="24" y="30">${escapeXml(figure.title)}</text>`,
  ];
}

export function figureScopedIds(figureId: string): Readonly<{ title: string; caption: string; arrow: string }> {
  const scope = createHash("sha256").update(figureId).digest("hex").slice(0, 16);
  return {
    title: `kpp-${scope}-title`,
    caption: `kpp-${scope}-caption`,
    arrow: `kpp-${scope}-arrow`,
  };
}

export function stableCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableCanonicalJson(item)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(record[key])}`).join(",")}}`;
}

export function svgClose(figure: FigureSpec, height: number): string[] {
  return [
    `  <text class="meta" x="24" y="${height - 30}">${escapeXml(figure.caption)}</text>`,
    `  <text class="meta" x="24" y="${height - 14}">근거 ${escapeXml(figure.evidenceIds.join(", "))} · 주장 ${escapeXml(figure.claimIds.join(", "))}</text>`,
    "</svg>",
  ];
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
