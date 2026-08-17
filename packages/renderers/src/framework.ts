import {
  R08_RENDERER_TOKENS,
  assertNonEmptyIds,
  assertText,
  escapeXml,
  joinEvidenceIds,
  svgClose,
  svgOpen,
  type FrameworkFigureSpec,
  type FrameworkNode,
} from "./types.js";

export function renderFramework(figure: FrameworkFigureSpec): string {
  const orderedNodes = validateFramework(figure);
  const width = 720;
  const nodeWidth = 184;
  const nodeHeight = 116;
  const gap = 36;
  const layoutWidth = orderedNodes.length * nodeWidth + (orderedNodes.length - 1) * gap;
  const startX = (width - layoutWidth) / 2;
  const nodeY = 72;
  const height = 266;
  const positions = new Map(orderedNodes.map((node, index) => [node.id, startX + index * (nodeWidth + gap)]));
  const lines = svgOpen(figure, width, height);

  lines.push("  <defs>");
  lines.push(`    <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${R08_RENDERER_TOKENS.navySecondary}"/></marker>`);
  lines.push("  </defs>");
  for (const edge of figure.data.edges) {
    const fromX = (positions.get(edge.from) ?? 0) + nodeWidth;
    const toX = positions.get(edge.to) ?? 0;
    const centerY = nodeY + nodeHeight / 2;
    lines.push(`  <g data-kpp-role="connector" data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}">`);
    lines.push(`    <line x1="${format(fromX + 4)}" y1="${centerY}" x2="${format(toX - 8)}" y2="${centerY}" stroke="${R08_RENDERER_TOKENS.navySecondary}" stroke-width="2" marker-end="url(#arrow)"/>`);
    if (edge.label !== undefined) {
      lines.push(`    <text class="meta" text-anchor="middle" x="${format((fromX + toX) / 2)}" y="${centerY - 9}">${escapeXml(edge.label)}</text>`);
    }
    lines.push("  </g>");
  }
  orderedNodes.forEach((node, index) => {
    const x = positions.get(node.id) ?? 0;
    lines.push(`  <g data-kpp-role="framework-node" data-reading-order="${index + 1}" data-node-id="${escapeXml(node.id)}" data-owner="${escapeXml(node.owner)}" data-state="${escapeXml(node.state)}" data-acceptance="${escapeXml(node.acceptance)}" data-evidence-ids="${joinEvidenceIds(node.evidenceIds)}">`);
    lines.push(`    <rect x="${format(x)}" y="${nodeY}" width="${nodeWidth}" height="${nodeHeight}" fill="${index === orderedNodes.length - 1 ? R08_RENDERER_TOKENS.surfaceStrong : R08_RENDERER_TOKENS.surface}" stroke="${R08_RENDERER_TOKENS.navy}"/>`);
    lines.push(`    <rect x="${format(x)}" y="${nodeY}" width="6" height="${nodeHeight}" fill="${R08_RENDERER_TOKENS.navy}"/>`);
    lines.push(`    <text class="strong" x="${format(x + 16)}" y="${nodeY + 25}">${escapeXml(node.label)}</text>`);
    lines.push(`    <text class="meta" x="${format(x + 16)}" y="${nodeY + 49}">책임 ${escapeXml(node.owner)}</text>`);
    lines.push(`    <text class="meta" x="${format(x + 16)}" y="${nodeY + 68}">상태 ${escapeXml(node.state)}</text>`);
    lines.push(`    <text class="meta" x="${format(x + 16)}" y="${nodeY + 87}">수용 ${escapeXml(node.acceptance)}</text>`);
    lines.push(`    <text class="meta" x="${format(x + 16)}" y="${nodeY + 106}">근거 ${escapeXml(node.evidenceIds.join(", "))}</text>`);
    lines.push("  </g>");
  });
  lines.push(...svgClose(figure, height));
  return lines.join("\n");
}

function validateFramework(figure: FrameworkFigureSpec): readonly FrameworkNode[] {
  if (figure.data.kind !== "research_framework") {
    throw new Error("Framework family and data kind must agree");
  }
  if (figure.data.nodes.length === 0 || figure.data.readingOrder.length !== figure.data.nodes.length) {
    throw new Error("Framework reading order must contain every node exactly once");
  }
  const byId = new Map<string, FrameworkNode>();
  for (const node of figure.data.nodes) {
    assertText(node.id, "node.id");
    assertText(node.label, "node.label");
    assertText(node.owner, "node.owner");
    assertText(node.state, "node.state");
    assertText(node.acceptance, "node.acceptance");
    assertNonEmptyIds(node.evidenceIds, "node.evidenceIds");
    if (byId.has(node.id)) {
      throw new Error("Framework node IDs must be unique");
    }
    byId.set(node.id, node);
  }
  const orderedNodes = figure.data.readingOrder.map((id) => byId.get(id));
  if (new Set(figure.data.readingOrder).size !== figure.data.nodes.length || orderedNodes.some((node) => node === undefined)) {
    throw new Error("Framework reading order must contain every node exactly once");
  }
  for (const edge of figure.data.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) {
      throw new Error("Framework connectors must reference two distinct declared nodes");
    }
    if (edge.label !== undefined) {
      assertText(edge.label, "edge.label");
    }
  }
  return orderedNodes as readonly FrameworkNode[];
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
