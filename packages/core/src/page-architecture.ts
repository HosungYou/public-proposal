import type {
  PageArchitectureManifest,
  PageArchitecturePage,
  PagePlan,
} from "@longtable/kpp-schemas";
import type { DocumentModePolicy } from "./mode-policy.js";

export interface ValidationEvidence {
  readonly locator: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export interface ValidationFinding {
  readonly ruleId: string;
  readonly severity: "error";
  readonly message: string;
  readonly evidence: ValidationEvidence;
}

export interface ValidationResult {
  readonly status: "PASS" | "FAIL";
  readonly findings: readonly ValidationFinding[];
}

export function validatePageArchitecture(
  manifest: PageArchitectureManifest,
  pagePlan: PagePlan,
  policy: DocumentModePolicy,
): ValidationResult {
  const findings: ValidationFinding[] = [];
  if (
    manifest.documentMode !== policy.documentMode
    || manifest.modePolicyVersion !== policy.modePolicyVersion
  ) {
    findings.push(finding(
      "KPP_ARCH_MODE_MISMATCH",
      "Architecture mode identity must match the selected policy.",
      "manifest",
      { documentMode: policy.documentMode, modePolicyVersion: policy.modePolicyVersion },
      { documentMode: manifest.documentMode, modePolicyVersion: manifest.modePolicyVersion },
    ));
  }

  const architectureById = new Map<string, PageArchitecturePage>();
  for (const page of manifest.pages) {
    if (architectureById.has(page.pageId)) {
      findings.push(finding(
        "KPP_ARCH_DUPLICATE_PAGE_ID",
        "Architecture page IDs must be unique.",
        `page:${page.pageId}`,
        "unique pageId",
        page.pageId,
      ));
    } else {
      architectureById.set(page.pageId, page);
    }
  }

  const planById = new Map(pagePlan.pages.map((page) => [page.pageId, page]));
  const observedCanonicalRoles = new Set<string>();
  for (const page of manifest.pages) {
    const planned = planById.get(page.pageId);
    if (
      planned === undefined
      || planned.pageRole !== page.pageRole
      || planned.surfaceTemplateId !== page.surfaceTemplateId
    ) {
      findings.push(finding(
        "KPP_ARCH_PAGE_PLAN_MISMATCH",
        "Every architecture page must match its production page-plan assignment.",
        `page:${page.pageId}`,
        planned,
        { pageRole: page.pageRole, surfaceTemplateId: page.surfaceTemplateId },
      ));
      continue;
    }

    validateModePolicy(page, policy, observedCanonicalRoles, findings);
    validateTitleScope(page, findings);
    validateContinuity(page, architectureById, findings);
    validateIdentifiers(page, planned, findings);
  }

  // Small requirement subsets remain valid for backwards-compatible staged
  // planning. Once the architecture is large enough to carry the complete
  // policy role set, every required role must be represented.
  if (manifest.pages.length >= policy.requiredPageRoles.length) {
    const missingRoles = policy.requiredPageRoles.filter((role) => !observedCanonicalRoles.has(role));
    if (missingRoles.length > 0) {
      findings.push(finding(
        "KPP_ARCH_REQUIRED_ROLE_MISSING",
        "Complete-sized architectures must represent every required mode role.",
        "manifest/pageRoles",
        policy.requiredPageRoles,
        [...observedCanonicalRoles],
      ));
    }
  }

  for (const planned of pagePlan.pages) {
    if (!architectureById.has(planned.pageId)) {
      findings.push(finding(
        "KPP_ARCH_PAGE_PLAN_MISMATCH",
        "Every planned page must have an architecture record.",
        `page-plan:${planned.pageId}`,
        planned.pageId,
        undefined,
      ));
    }
  }
  return result(findings);
}

function validateModePolicy(
  page: PageArchitecturePage,
  policy: DocumentModePolicy,
  observedCanonicalRoles: Set<string>,
  findings: ValidationFinding[],
): void {
  const canonicalRole = policy.pageRoleAliases[page.pageRole] ?? page.pageRole;
  if (!policy.allowedPageRoles.includes(canonicalRole)) {
    findings.push(finding(
      "KPP_ARCH_MODE_PAGE_ROLE",
      "Page role is not allowed by the selected document mode.",
      `page:${page.pageId}/pageRole`,
      policy.allowedPageRoles,
      page.pageRole,
    ));
  } else {
    observedCanonicalRoles.add(canonicalRole);
  }
  const surfaceFamily = policy.surfaceTemplateFamilies[page.surfaceTemplateId]
    ?? page.surfaceTemplateId;
  if (!policy.allowedSurfaceFamilies.includes(surfaceFamily)) {
    findings.push(finding(
      "KPP_ARCH_MODE_SURFACE",
      "Surface template does not resolve to a family allowed by the selected document mode.",
      `page:${page.pageId}/surfaceTemplateId`,
      policy.allowedSurfaceFamilies,
      { surfaceTemplateId: page.surfaceTemplateId, resolvedSurfaceFamily: surfaceFamily },
    ));
  }
}

function validateTitleScope(page: PageArchitecturePage, findings: ValidationFinding[]): void {
  const titlePointSize = page.titlePointSize;
  const forbiddenScope = page.titleScope === "cover" || page.titleScope === "chapter";
  const oversized = typeof titlePointSize === "number" && titlePointSize > 12;
  if (page.continuation && (forbiddenScope || oversized) && page.issuerOverride === undefined) {
    findings.push(finding(
      "KPP_ARCH_TITLE_SCOPE",
      "Continuation pages cannot introduce a large title without a bound issuer override.",
      `page:${page.pageId}`,
      { maximumPointSize: 12, titleScope: ["section", "surface", "none"] },
      { titleScope: page.titleScope, titlePointSize },
    ));
  }
}

function validateContinuity(
  page: PageArchitecturePage,
  pages: ReadonlyMap<string, PageArchitecturePage>,
  findings: ValidationFinding[],
): void {
  if (page.continuation && page.continuityFromPageId === undefined) {
    findings.push(finding(
      "KPP_ARCH_CONTINUITY",
      "Continuation pages must identify the preceding page.",
      `page:${page.pageId}`,
      "continuityFromPageId",
      undefined,
    ));
  }
  if (page.continuityFromPageId !== undefined) {
    const previous = pages.get(page.continuityFromPageId);
    if (previous === undefined || previous.continuityToPageId !== page.pageId) {
      findings.push(finding(
        "KPP_ARCH_CONTINUITY",
        "Continuity links must resolve reciprocally.",
        `page:${page.pageId}`,
        { from: page.continuityFromPageId, reciprocalTo: page.pageId },
        previous?.continuityToPageId,
      ));
    }
  }
  if (page.continuityToPageId !== undefined) {
    const next = pages.get(page.continuityToPageId);
    if (next === undefined || next.continuityFromPageId !== page.pageId) {
      findings.push(finding(
        "KPP_ARCH_CONTINUITY",
        "Continuity links must resolve reciprocally.",
        `page:${page.pageId}`,
        { to: page.continuityToPageId, reciprocalFrom: page.pageId },
        next?.continuityFromPageId,
      ));
    }
  }
}

function validateIdentifiers(
  page: PageArchitecturePage,
  planned: PagePlan["pages"][number],
  findings: ValidationFinding[],
): void {
  const knownClaims = new Set(planned.claimIds);
  const plannedFigures = planned.figureSpecs;
  const knownFigures = new Set(plannedFigures.map(({ figureId }) => figureId));
  const knownProofs = new Set(plannedFigures.flatMap(({ evidenceIds }) => evidenceIds));
  for (const claimId of page.claimIds) {
    if (!knownClaims.has(claimId)) {
      findings.push(unresolved("KPP_ARCH_UNRESOLVED_CLAIM_ID", page.pageId, "claimIds", claimId));
    }
  }
  for (const figureId of page.figureIds) {
    if (!knownFigures.has(figureId)) {
      findings.push(unresolved("KPP_ARCH_UNRESOLVED_FIGURE_ID", page.pageId, "figureIds", figureId));
    }
  }
  for (const proofId of page.proofIds) {
    if (!knownProofs.has(proofId)) {
      findings.push(unresolved("KPP_ARCH_UNRESOLVED_PROOF_ID", page.pageId, "proofIds", proofId));
    }
  }
}

function unresolved(ruleId: string, pageId: string, field: string, id: string): ValidationFinding {
  return finding(
    ruleId,
    "Architecture identifiers must resolve to the matching production page plan.",
    `page:${pageId}/${field}:${id}`,
    "declared page-plan identifier",
    id,
  );
}

export function finding(
  ruleId: string,
  message: string,
  locator: string,
  expected?: unknown,
  actual?: unknown,
): ValidationFinding {
  return {
    ruleId,
    severity: "error",
    message,
    evidence: {
      locator,
      ...(expected === undefined ? {} : { expected }),
      ...(actual === undefined ? {} : { actual }),
    },
  };
}

export function result(findings: readonly ValidationFinding[]): ValidationResult {
  return { status: findings.length === 0 ? "PASS" : "FAIL", findings };
}
