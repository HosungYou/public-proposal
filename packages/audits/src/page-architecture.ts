import type { PageArchitectureManifest } from "@longtable/kpp-schemas";
import { blocked, makeSlice, type AuditSlice } from "./source.js";
import type { RenderObservationManifest } from "./render-observations.js";

export interface RenderedPageArchitectureAuditInput {
  readonly architecture: PageArchitectureManifest;
  readonly observations: RenderObservationManifest;
}

export function auditRenderedPageArchitecture(
  input: RenderedPageArchitectureAuditInput,
): AuditSlice {
  const { architecture, observations } = input;
  const findings = [];
  if (architecture.projectId !== observations.projectId
    || architecture.documentMode !== observations.documentMode
    || architecture.modePolicyVersion !== observations.modePolicyVersion) {
    findings.push(blocked(
      "KPP_PAGE_ARCHITECTURE_IDENTITY",
      "렌더 관찰 원장과 잠긴 페이지 아키텍처의 문서 정체성이 다릅니다.",
      {
        path: observations.sourceArtifact.path,
        expected: {
          projectId: architecture.projectId,
          documentMode: architecture.documentMode,
          modePolicyVersion: architecture.modePolicyVersion,
        },
        actual: {
          projectId: observations.projectId,
          documentMode: observations.documentMode,
          modePolicyVersion: observations.modePolicyVersion,
        },
      },
    ));
  }
  if (architecture.pages.length !== observations.pages.length) {
    findings.push(blocked(
      "KPP_PAGE_OBSERVATION_COUNT",
      "잠긴 페이지 수와 실제 관찰 페이지 수가 다릅니다.",
      {
        path: observations.sourceArtifact.path,
        expected: architecture.pages.length,
        actual: observations.pages.length,
      },
    ));
  }
  for (const [index, planned] of architecture.pages.entries()) {
    const observed = observations.pages[index];
    if (observed === undefined) continue;
    if (observed.sourceArtifactSha256 !== observations.sourceArtifact.sha256) {
      findings.push(blocked(
        "KPP_PAGE_OBSERVATION_SOURCE",
        "페이지 관찰값이 원본 렌더 아티팩트 해시에 결속되지 않았습니다.",
        {
          path: observed.pageLocator,
          expected: observations.sourceArtifact.sha256,
          actual: observed.sourceArtifactSha256,
        },
      ));
    }
    const strongestHeading = Math.max(0, ...observed.measuredHeadingPointSizes);
    const override = issuerOverrideBound(architecture, planned);
    if (planned.continuation && strongestHeading > 12 && !override) {
      findings.push(blocked(
        "KPP_PAGE_TITLE_CONTINUATION_LARGE",
        "연속 면에서 측정된 가장 큰 제목이 12pt를 초과했습니다.",
        {
          path: observed.pageLocator,
          expected: { maximumPointSize: 12, issuerOverride: false },
          actual: { measuredPointSize: strongestHeading, issuerOverride: false },
        },
      ));
    }
    if (planned.continuation && !observed.continuationMarkers.fromPrevious) {
      findings.push(blocked(
        "KPP_PAGE_CONTINUATION_UNOBSERVED",
        "잠긴 연속 면이 실제 렌더에서 이전 면과의 연속 표식을 보이지 않습니다.",
        {
          path: observed.pageLocator,
          expected: { fromPrevious: true },
          actual: observed.continuationMarkers,
        },
      ));
    }
  }
  return makeSlice(findings, [observations.sourceArtifact]);
}

function issuerOverrideBound(
  architecture: PageArchitectureManifest,
  page: PageArchitectureManifest["pages"][number],
): boolean {
  const override = page.issuerOverride;
  return override !== undefined
    && override.documentMode === architecture.documentMode
    && override.modePolicyVersion === architecture.modePolicyVersion
    && (override.ruleId !== undefined || override.sourceId !== undefined)
    && override.reason.trim().length > 0;
}
