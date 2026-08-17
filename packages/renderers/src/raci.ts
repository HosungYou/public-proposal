import {
  R08_RENDERER_TOKENS,
  assertNonEmptyIds,
  assertText,
  escapeXml,
  joinEvidenceIds,
  svgClose,
  svgOpen,
  type RaciFigureSpec,
} from "./types.js";

export function renderRaci(figure: RaciFigureSpec): string {
  validateRaci(figure);
  const width = 720;
  const tableX = 24;
  const tableWidth = 672;
  const labelWidth = 216;
  const actorWidth = (tableWidth - labelWidth) / figure.data.actors.length;
  const headerY = 58;
  const headerHeight = 40;
  const rowHeight = 72;
  const height = headerY + headerHeight + figure.data.activities.length * rowHeight + 62;
  const lines = svgOpen(figure, width, height);

  lines.push(`  <g data-kpp-role="raci-header">`);
  lines.push(`    <rect x="${tableX}" y="${headerY}" width="${tableWidth}" height="${headerHeight}" fill="${R08_RENDERER_TOKENS.surfaceStrong}" stroke="${R08_RENDERER_TOKENS.hairline}"/>`);
  lines.push(`    <text class="strong" x="32" y="${headerY + 25}">과업 / 상태 / 수용기준</text>`);
  figure.data.actors.forEach((actor, index) => {
    const x = tableX + labelWidth + index * actorWidth;
    lines.push(`    <line x1="${format(x)}" y1="${headerY}" x2="${format(x)}" y2="${height - 62}" stroke="${R08_RENDERER_TOKENS.hairline}"/>`);
    lines.push(`    <text text-anchor="middle" x="${format(x + actorWidth / 2)}" y="${headerY + 25}">${escapeXml(actor)}</text>`);
  });
  lines.push("  </g>");

  figure.data.activities.forEach((activity, rowIndex) => {
    const y = headerY + headerHeight + rowIndex * rowHeight;
    lines.push(`  <g data-kpp-role="raci-row" data-activity-id="${escapeXml(activity.id)}" data-owner="${escapeXml(activity.owner)}" data-state="${escapeXml(activity.state)}" data-acceptance="${escapeXml(activity.acceptance)}" data-evidence-ids="${joinEvidenceIds(activity.evidenceIds)}">`);
    lines.push(`    <rect x="${tableX}" y="${y}" width="${tableWidth}" height="${rowHeight}" fill="${rowIndex % 2 === 0 ? R08_RENDERER_TOKENS.paper : R08_RENDERER_TOKENS.surface}" stroke="${R08_RENDERER_TOKENS.hairline}"/>`);
    lines.push(`    <text class="strong" x="32" y="${y + 20}">${escapeXml(activity.id)} · ${escapeXml(activity.label)}</text>`);
    lines.push(`    <text class="meta" x="32" y="${y + 39}">책임 ${escapeXml(activity.owner)} · 상태 ${escapeXml(activity.state)}</text>`);
    lines.push(`    <text class="meta" x="32" y="${y + 58}">수용 ${escapeXml(activity.acceptance)} · 근거 ${escapeXml(activity.evidenceIds.join(", "))}</text>`);
    activity.assignments.forEach((assignment, actorIndex) => {
      const centerX = tableX + labelWidth + actorIndex * actorWidth + actorWidth / 2;
      lines.push(`    <text class="strong" text-anchor="middle" x="${format(centerX)}" y="${y + 40}" aria-label="${escapeXml(figure.data.actors[actorIndex] ?? "")} ${assignment}">${assignment}</text>`);
    });
    lines.push("  </g>");
  });
  lines.push(...svgClose(figure, height));
  return lines.join("\n");
}

function validateRaci(figure: RaciFigureSpec): void {
  if (figure.data.kind !== "responsibility_matrix") {
    throw new Error("RACI family and data kind must agree");
  }
  if (figure.data.actors.length === 0 || figure.data.activities.length === 0) {
    throw new Error("RACI data requires actors and activities");
  }
  figure.data.actors.forEach((actor) => assertText(actor, "actor"));
  for (const activity of figure.data.activities) {
    assertText(activity.id, "activity.id");
    assertText(activity.label, "activity.label");
    assertText(activity.owner, "activity.owner");
    assertText(activity.state, "activity.state");
    assertText(activity.acceptance, "activity.acceptance");
    assertNonEmptyIds(activity.evidenceIds, "activity.evidenceIds");
    if (activity.assignments.length !== figure.data.actors.length) {
      throw new Error("Each RACI row must have one assignment per actor");
    }
    if (activity.assignments.some((assignment) => !RACI_ASSIGNMENTS.has(assignment))) {
      throw new Error("RACI assignment must be one of R, A, C, I, or -");
    }
    if (!activity.assignments.includes("R") || !activity.assignments.includes("A")) {
      throw new Error("Each RACI row must identify Responsible and Accountable assignments");
    }
  }
}

const RACI_ASSIGNMENTS: ReadonlySet<string> = new Set(["R", "A", "C", "I", "-"]);

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
