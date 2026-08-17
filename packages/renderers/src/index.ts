import { createHash } from "node:crypto";
import { renderFramework } from "./framework.js";
import { renderGantt } from "./gantt.js";
import { renderRaci } from "./raci.js";
import { assertFigureBase, type FigureSpec } from "./types.js";

export * from "./types.js";
export { renderFramework } from "./framework.js";
export { renderGantt } from "./gantt.js";
export { renderRaci } from "./raci.js";

export async function renderFigure(figure: FigureSpec): Promise<string> {
  assertFigureBase(figure);
  if (figure.family === "gantt") {
    return renderGantt(figure);
  }
  if (figure.family === "raci") {
    return renderRaci(figure);
  }
  if (figure.family === "framework") {
    return renderFramework(figure);
  }
  throw new Error(`Unsupported semantic figure family: ${String((figure as { family?: unknown }).family)}`);
}

export async function renderFigureHash(figure: FigureSpec): Promise<string> {
  return createHash("sha256").update(await renderFigure(figure)).digest("hex");
}
