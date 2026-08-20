import {
  R08_RENDERER_TOKENS,
  assertFigureEvidenceIds,
  assertText,
  escapeXml,
  figureScopedIds,
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
  const horizontalGap = 36;
  const verticalGap = 52;
  const columns = Math.min(3, orderedNodes.length);
  const rows = Math.ceil(orderedNodes.length / columns);
  const layoutWidth = columns * nodeWidth + (columns - 1) * horizontalGap;
  const startX = (width - layoutWidth) / 2;
  const startY = 72;
  const height = startY + rows * nodeHeight + (rows - 1) * verticalGap + 78;
  const positions = new Map(orderedNodes.map((node, index) => {
    const row = Math.floor(index / columns);
    const positionInRow = index % columns;
    const column = row % 2 === 0 ? positionInRow : columns - 1 - positionInRow;
    return [node.id, {
      x: startX + column * (nodeWidth + horizontalGap),
      y: startY + row * (nodeHeight + verticalGap),
      row,
    }] as const;
  }));
  const ids = figureScopedIds(figure.figureId);
  const lines = svgOpen(figure, width, height);

  lines.push("  <defs>");
  lines.push(`    <marker id="${ids.arrow}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${R08_RENDERER_TOKENS.navySecondary}"/></marker>`);
  lines.push("  </defs>");
  for (const edge of figure.data.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new Error("Framework connector layout could not resolve a declared node");
    }
    const path = connectorPath(from, to, nodeWidth, nodeHeight);
    const label = connectorLabelPosition(from, to, nodeWidth, nodeHeight);
    lines.push(`  <g data-kpp-role="connector" data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}">`);
    lines.push(`    <path d="${path}" fill="none" stroke="${R08_RENDERER_TOKENS.navySecondary}" stroke-width="2" marker-end="url(#${ids.arrow})"/>`);
    if (edge.label !== undefined) {
      lines.push(`    <text class="meta" text-anchor="middle" x="${format(label.x)}" y="${format(label.y)}">${escapeXml(edge.label)}</text>`);
    }
    lines.push("  </g>");
  }
  orderedNodes.forEach((node, index) => {
    const position = positions.get(node.id);
    if (position === undefined) {
      throw new Error("Framework node layout could not resolve reading order");
    }
    const { x, y } = position;
    lines.push(`  <g data-kpp-role="framework-node" data-reading-order="${index + 1}" data-node-id="${escapeXml(node.id)}" data-owner="${escapeXml(node.owner)}" data-state="${escapeXml(node.state)}" data-acceptance="${escapeXml(node.acceptance)}" data-evidence-ids="${joinEvidenceIds(node.evidenceIds)}">`);
    lines.push(`    <rect x="${format(x)}" y="${format(y)}" width="${nodeWidth}" height="${nodeHeight}" fill="${index === orderedNodes.length - 1 ? R08_RENDERER_TOKENS.surfaceStrong : R08_RENDERER_TOKENS.surface}" stroke="${R08_RENDERER_TOKENS.navy}"/>`);
    lines.push(`    <rect x="${format(x)}" y="${format(y)}" width="6" height="${nodeHeight}" fill="${R08_RENDERER_TOKENS.navy}"/>`);
    lines.push(`    <text class="strong" x="${format(x + 16)}" y="${format(y + 25)}">${escapeXml(node.label)}</text>`);
    lines.push(`    <text class="meta" x="${format(x + 16)}" y="${format(y + 49)}">책임 ${escapeXml(node.owner)}</text>`);
    lines.push(`    <text class="meta" x="${format(x + 16)}" y="${format(y + 68)}">상태 ${escapeXml(node.state)}</text>`);
    lines.push(`    <text class="meta" x="${format(x + 16)}" y="${format(y + 87)}">수용 ${escapeXml(node.acceptance)}</text>`);
    lines.push(`    <text class="meta" x="${format(x + 16)}" y="${format(y + 106)}">근거 ${escapeXml(node.evidenceIds.join(", "))}</text>`);
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
  if (figure.data.nodes.length > MAX_FRAMEWORK_NODES) {
    throw new Error(`Framework node capacity is ${MAX_FRAMEWORK_NODES} for an A4-safe wrapped surface`);
  }
  const byId = new Map<string, FrameworkNode>();
  for (const node of figure.data.nodes) {
    assertText(node.id, "node.id");
    assertText(node.label, "node.label");
    assertText(node.owner, "node.owner");
    assertText(node.state, "node.state");
    assertText(node.acceptance, "node.acceptance");
    assertFigureEvidenceIds(figure, node.evidenceIds, "node.evidenceIds");
    if (byId.has(node.id)) {
      throw new Error("Framework node IDs must be unique");
    }
    byId.set(node.id, node);
  }
  const orderedNodes = figure.data.readingOrder.map((id) => byId.get(id));
  if (new Set(figure.data.readingOrder).size !== figure.data.nodes.length || orderedNodes.some((node) => node === undefined)) {
    throw new Error("Framework reading order must contain every node exactly once");
  }
  const readingIndex = new Map(figure.data.readingOrder.map((id, index) => [id, index]));
  for (const edge of figure.data.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) {
      throw new Error("Framework connectors must reference two distinct declared nodes");
    }
    if (edge.label !== undefined) {
      assertText(edge.label, "edge.label");
    }
    if ((readingIndex.get(edge.from) ?? -1) >= (readingIndex.get(edge.to) ?? -1)) {
      throw new Error("Framework connectors must follow the declared forward reading order");
    }
  }
  return orderedNodes as readonly FrameworkNode[];
}

const MAX_FRAMEWORK_NODES = 15;

interface NodePosition {
  readonly x: number;
  readonly y: number;
  readonly row: number;
}

function connectorPath(from: NodePosition, to: NodePosition, width: number, height: number): string {
  if (from.row === to.row) {
    const leftToRight = from.x < to.x;
    const fromX = leftToRight ? from.x + width + 4 : from.x - 4;
    const toX = leftToRight ? to.x - 8 : to.x + width + 8;
    const centerY = from.y + height / 2;
    return `M ${format(fromX)} ${format(centerY)} H ${format(toX)}`;
  }
  const fromX = from.x + width / 2;
  const fromY = from.y + height + 4;
  const toX = to.x + width / 2;
  const toY = to.y - 8;
  const middleY = from.y + height + (to.y - (from.y + height)) / 2;
  return `M ${format(fromX)} ${format(fromY)} V ${format(middleY)} H ${format(toX)} V ${format(toY)}`;
}

function connectorLabelPosition(from: NodePosition, to: NodePosition, width: number, height: number): Readonly<{ x: number; y: number }> {
  if (from.row === to.row) {
    return { x: (from.x + width + to.x) / 2, y: from.y + height / 2 - 9 };
  }
  return {
    x: (from.x + width / 2 + to.x + width / 2) / 2,
    y: from.y + height + (to.y - (from.y + height)) / 2 - 6,
  };
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
