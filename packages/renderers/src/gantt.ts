import {
  R08_RENDERER_TOKENS,
  assertNonEmptyIds,
  assertText,
  escapeXml,
  joinEvidenceIds,
  svgClose,
  svgOpen,
  type GanttFigureSpec,
} from "./types.js";

export function renderGantt(figure: GanttFigureSpec): string {
  validateGantt(figure);
  const width = 720;
  const labelWidth = 204;
  const chartX = 216;
  const chartWidth = 480;
  const periodWidth = chartWidth / figure.data.periods.length;
  const axisY = 58;
  const rowHeight = 52;
  const milestoneHeight = 48;
  const contentHeight = axisY + 32 + figure.data.workPackages.length * rowHeight + milestoneHeight;
  const height = contentHeight + 62;
  const lines = svgOpen(figure, width, height);

  lines.push(`  <g data-kpp-role="time-axis" aria-label="기간 축">`);
  lines.push(`    <rect x="24" y="${axisY}" width="672" height="32" fill="${R08_RENDERER_TOKENS.surfaceStrong}" stroke="${R08_RENDERER_TOKENS.hairline}"/>`);
  lines.push(`    <text class="strong" x="32" y="${axisY + 21}">과업 / 책임</text>`);
  figure.data.periods.forEach((period, index) => {
    const x = chartX + index * periodWidth;
    lines.push(`    <line x1="${format(x)}" y1="${axisY}" x2="${format(x)}" y2="${contentHeight}" stroke="${R08_RENDERER_TOKENS.hairline}"/>`);
    lines.push(`    <text text-anchor="middle" x="${format(x + periodWidth / 2)}" y="${axisY + 21}">${escapeXml(period)}</text>`);
  });
  lines.push(`    <line x1="696" y1="${axisY}" x2="696" y2="${contentHeight}" stroke="${R08_RENDERER_TOKENS.hairline}"/>`);
  lines.push("  </g>");

  figure.data.workPackages.forEach((workPackage, index) => {
    const y = axisY + 32 + index * rowHeight;
    const barX = chartX + workPackage.start * periodWidth + 5;
    const barWidth = (workPackage.end - workPackage.start + 1) * periodWidth - 10;
    lines.push(`  <g data-kpp-role="work-package-row" data-work-package-id="${escapeXml(workPackage.id)}" data-owner="${escapeXml(workPackage.owner)}" data-evidence-ids="${joinEvidenceIds(workPackage.evidenceIds)}">`);
    lines.push(`    <rect x="24" y="${y}" width="672" height="${rowHeight}" fill="${index % 2 === 0 ? R08_RENDERER_TOKENS.paper : R08_RENDERER_TOKENS.surface}" stroke="${R08_RENDERER_TOKENS.hairline}"/>`);
    lines.push(`    <text class="strong" x="32" y="${y + 20}">${escapeXml(workPackage.id)} · ${escapeXml(workPackage.label)}</text>`);
    lines.push(`    <text class="meta" x="32" y="${y + 38}">책임 ${escapeXml(workPackage.owner)} · 근거 ${escapeXml(workPackage.evidenceIds.join(", "))}</text>`);
    lines.push(`    <rect data-kpp-role="duration-bar" x="${format(barX)}" y="${y + 15}" width="${format(barWidth)}" height="22" fill="${R08_RENDERER_TOKENS.navy}"/>`);
    lines.push("  </g>");
  });

  const milestoneY = axisY + 32 + figure.data.workPackages.length * rowHeight;
  lines.push(`  <rect x="24" y="${milestoneY}" width="672" height="${milestoneHeight}" fill="${R08_RENDERER_TOKENS.surfaceStrong}" stroke="${R08_RENDERER_TOKENS.hairline}"/>`);
  for (const milestone of figure.data.milestones) {
    const centerX = chartX + (milestone.period + 0.5) * periodWidth;
    const points = `${format(centerX)},${milestoneY + 8} ${format(centerX + 8)},${milestoneY + 16} ${format(centerX)},${milestoneY + 24} ${format(centerX - 8)},${milestoneY + 16}`;
    lines.push(`  <g data-kpp-role="milestone" data-milestone-id="${escapeXml(milestone.id)}" data-owner="${escapeXml(milestone.owner)}" data-acceptance="${escapeXml(milestone.acceptance)}" data-evidence-ids="${joinEvidenceIds(milestone.evidenceIds)}">`);
    lines.push(`    <polygon points="${points}" fill="${R08_RENDERER_TOKENS.warning}"/>`);
    lines.push(`    <text text-anchor="middle" x="${format(centerX)}" y="${milestoneY + 40}">${escapeXml(milestone.label)}</text>`);
    lines.push("  </g>");
  }
  lines.push(...svgClose(figure, height));
  return lines.join("\n");
}

function validateGantt(figure: GanttFigureSpec): void {
  if (figure.data.kind !== "time_axis") {
    throw new Error("Gantt family and data kind must agree");
  }
  if (figure.data.periods.length === 0 || figure.data.workPackages.length === 0 || figure.data.milestones.length === 0) {
    throw new Error("Gantt data requires periods, work packages, and milestones");
  }
  if (figure.data.periods.length > MAX_GANTT_PERIODS) {
    throw new Error(`Gantt period capacity is ${MAX_GANTT_PERIODS} to retain readable axis cells`);
  }
  if (figure.data.workPackages.length > MAX_GANTT_WORK_PACKAGES) {
    throw new Error(`Gantt work package capacity is ${MAX_GANTT_WORK_PACKAGES} for an A4-safe surface`);
  }
  figure.data.periods.forEach((period) => assertText(period, "period"));
  for (const workPackage of figure.data.workPackages) {
    assertText(workPackage.id, "workPackage.id");
    assertText(workPackage.label, "workPackage.label");
    assertText(workPackage.owner, "workPackage.owner");
    assertNonEmptyIds(workPackage.evidenceIds, "workPackage.evidenceIds");
    if (!Number.isInteger(workPackage.start) || !Number.isInteger(workPackage.end)
      || workPackage.start < 0 || workPackage.end < workPackage.start
      || workPackage.end >= figure.data.periods.length) {
      throw new Error("Gantt work package range must address the declared time axis");
    }
  }
  const occupiedMilestonePeriods = new Set<number>();
  for (const milestone of figure.data.milestones) {
    assertText(milestone.id, "milestone.id");
    assertText(milestone.label, "milestone.label");
    assertText(milestone.owner, "milestone.owner");
    assertText(milestone.acceptance, "milestone.acceptance");
    assertNonEmptyIds(milestone.evidenceIds, "milestone.evidenceIds");
    if (!Number.isInteger(milestone.period) || milestone.period < 0 || milestone.period >= figure.data.periods.length) {
      throw new Error("Gantt milestone must address the declared time axis");
    }
    if (occupiedMilestonePeriods.has(milestone.period)) {
      throw new Error("Gantt milestone periods must be unique to prevent label collisions");
    }
    occupiedMilestonePeriods.add(milestone.period);
  }
}

const MAX_GANTT_PERIODS = 10;
const MAX_GANTT_WORK_PACKAGES = 12;

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
