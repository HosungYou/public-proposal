import { readFile } from "node:fs/promises";
import { verifyFigureArtifact, type FigureManifest, type FigureSpec } from "@kpp/renderers";
import {
  blocked,
  inspectArtifact,
  makeSlice,
  readJsonObject,
  type AuditArtifact,
  type AuditFinding,
  type AuditSlice,
} from "./source.js";

export interface FigureAuditInput {
  readonly specPath: string;
  readonly svgPath: string;
  readonly manifestPath: string;
}

export async function auditFigureArtifacts(inputs: readonly FigureAuditInput[]): Promise<AuditSlice> {
  const findings: AuditFinding[] = [];
  const artifacts: AuditArtifact[] = [];
  if (inputs.length === 0) {
    findings.push(blocked("KPP_DESIGN_FIGURE_MISSING", "검사할 semantic figure가 없습니다."));
  }
  for (const input of inputs) {
    try {
      const [specArtifact, svgArtifact, manifestArtifact] = await Promise.all([
        inspectArtifact(input.specPath),
        inspectArtifact(input.svgPath),
        inspectArtifact(input.manifestPath),
      ]);
      artifacts.push(specArtifact, svgArtifact, manifestArtifact);
      const spec = await readJsonObject(input.specPath) as unknown as FigureSpec;
      const manifest = await readJsonObject(input.manifestPath) as unknown as FigureManifest;
      const svg = await readFile(input.svgPath, "utf8");
      try {
        verifyFigureArtifact({ svg, manifest }, spec);
      } catch (error) {
        findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "semantic spec/renderer token/SVG manifest lineage가 일치하지 않습니다.", {
          path: input.manifestPath,
          actual: error instanceof Error ? error.message : error,
        }));
      }
      const roles = rolesFor(spec.family);
      if (roles.some((role) => !svg.includes(`data-kpp-role="${role}"`))) {
        findings.push(blocked(
          spec.family === "gantt" ? "KPP_DESIGN_GANTT_STRUCTURE" : "KPP_DESIGN_FIGURE_STRUCTURE",
          `${spec.family} SVG에 필수 semantic role이 없습니다.`,
          { path: input.svgPath, expected: roles },
        ));
      }
      if (manifest.bindings.evidenceIds.length === 0 || manifest.bindings.claimIds.length === 0) {
        findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "figure evidence/claim binding이 비어 있습니다.", { path: input.manifestPath }));
      }
    } catch (error) {
      findings.push(blocked("KPP_DESIGN_SURFACE_LINEAGE", "figure spec/SVG/manifest를 직접 검사할 수 없습니다.", {
        path: input.svgPath,
        actual: error instanceof Error ? error.message : error,
      }));
    }
  }
  return makeSlice(findings, artifacts);
}

function rolesFor(family: FigureSpec["family"]): readonly string[] {
  if (family === "gantt") return ["time-axis", "work-package-row", "duration-bar", "milestone"];
  if (family === "raci") return ["raci-header", "raci-row"];
  return ["framework-node", "connector"];
}
