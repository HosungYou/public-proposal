import { createHash } from "node:crypto";
import { renderFramework } from "./framework.js";
import { renderGantt } from "./gantt.js";
import { renderRaci } from "./raci.js";
import {
  R08_TOKEN_PROFILE,
  R08_TOKEN_PROFILE_SHA256,
  assertFigureBase,
  stableCanonicalJson,
  type FigureSpec,
} from "./types.js";

/** Legacy Gantt/RACI/framework renderer manifest version. */
export const FIGURE_RENDERER_VERSION = "0.1.0" as const;

export interface FigureManifest {
  readonly schemaVersion: "1";
  readonly renderer: {
    readonly name: "@longtable/kpp-renderers";
    readonly version: typeof FIGURE_RENDERER_VERSION;
  };
  readonly figure: {
    readonly id: string;
    readonly family: FigureSpec["family"];
  };
  readonly tokenProfile: {
    readonly id: typeof R08_TOKEN_PROFILE;
    readonly sha256: string;
  };
  readonly input: {
    readonly kind: "semantic";
    readonly sha256: string;
  };
  readonly bindings: {
    readonly evidenceIds: readonly string[];
    readonly claimIds: readonly string[];
  };
  readonly output: {
    readonly format: "svg";
    readonly sha256: string;
  };
}

export interface FigureArtifact {
  readonly svg: string;
  readonly manifest: FigureManifest;
}

export * from "./types.js";
export * from "./figure-specs.js";
export { compileFigure, compileFigurePng } from "./visual-evidence-compiler.js";
export { renderFramework } from "./framework.js";
export { renderGantt } from "./gantt.js";
export { renderRaci } from "./raci.js";

export async function renderFigure(figure: FigureSpec): Promise<string> {
  assertFigureBase(figure);
  return renderFigureSync(figure);
}

function renderFigureSync(figure: FigureSpec): string {
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

export async function renderFigureArtifact(figure: FigureSpec): Promise<FigureArtifact> {
  const svg = await renderFigure(figure);
  const manifest: FigureManifest = {
    schemaVersion: "1",
    renderer: { name: "@longtable/kpp-renderers", version: FIGURE_RENDERER_VERSION },
    figure: { id: figure.figureId, family: figure.family },
    tokenProfile: { id: R08_TOKEN_PROFILE, sha256: R08_TOKEN_PROFILE_SHA256 },
    input: {
      kind: "semantic",
      sha256: sha256(stableCanonicalJson(figure)),
    },
    bindings: {
      evidenceIds: [...figure.evidenceIds],
      claimIds: [...figure.claimIds],
    },
    output: { format: "svg", sha256: sha256(svg) },
  };
  return { svg, manifest };
}

export async function renderFigureManifest(figure: FigureSpec): Promise<FigureManifest> {
  return (await renderFigureArtifact(figure)).manifest;
}

export function verifyFigureArtifact(artifact: FigureArtifact, figure: FigureSpec): true {
  assertFigureBase(figure);
  if (artifact.manifest.schemaVersion !== "1"
    || artifact.manifest.input.kind !== "semantic") {
    throw new Error("Figure manifest lineage schema mismatch");
  }
  if (artifact.manifest.renderer.name !== "@longtable/kpp-renderers"
    || artifact.manifest.renderer.version !== FIGURE_RENDERER_VERSION) {
    throw new Error("Figure manifest renderer identity does not match this renderer");
  }
  if (artifact.manifest.tokenProfile.id !== R08_TOKEN_PROFILE
    || artifact.manifest.tokenProfile.sha256 !== R08_TOKEN_PROFILE_SHA256) {
    throw new Error("Figure manifest token profile hash mismatch");
  }
  if (artifact.manifest.input.sha256 !== sha256(stableCanonicalJson(figure))) {
    throw new Error("Figure semantic input lineage hash mismatch");
  }
  if (artifact.manifest.figure.id !== figure.figureId
    || artifact.manifest.figure.family !== figure.family) {
    throw new Error("Figure manifest identity or family mismatch");
  }
  if (!sameOrderedStrings(artifact.manifest.bindings.evidenceIds, figure.evidenceIds)
    || !sameOrderedStrings(artifact.manifest.bindings.claimIds, figure.claimIds)) {
    throw new Error("Figure manifest evidence or claim binding mismatch");
  }
  if (artifact.manifest.output.format !== "svg"
    || artifact.manifest.output.sha256 !== sha256(artifact.svg)) {
    throw new Error("Figure output hash mismatch");
  }
  if (artifact.svg !== renderFigureSync(figure)) {
    throw new Error("Figure SVG does not match the locked semantic input lineage");
  }
  return true;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameOrderedStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
