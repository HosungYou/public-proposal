import { describe, expect, it } from "vitest";
import { PageArchitectureManifestSchema, type PageArchitectureManifest, type PagePlan } from "@longtable/kpp-schemas";
import { getDocumentModePolicy, validatePageArchitecture } from "../src/index.js";

const figure = {
  figureId: "FIG-001",
  requirementId: "REQ-003",
  pageId: "PAGE-003",
  title: "Delivery controls",
  intent: "flow" as const,
  dataShape: "process_flow" as const,
  decisionTask: "Confirm the control path.",
  semanticValueIntent: "operational_control" as const,
  decisionEffect: "Confirm the control owner and acceptance condition.",
  nonDuplicateOf: ["BLK-003"],
  encodedVariables: ["owner", "timing", "acceptance"],
  claimIds: ["CLAIM-003"],
  evidenceIds: ["PROOF-003"],
  family: "flow" as const,
  renderer: "svg-flow" as const,
};

const pagePlan: PagePlan = {
  schemaVersion: "1.0.0",
  pages: [
    { pageId: "PAGE-001", requirementId: "REQ-001", pageRole: "executive_summary", surfaceTemplateId: "narrative_continuation", claimIds: ["CLAIM-001"], figureSpecs: [] },
    { pageId: "PAGE-002", requirementId: "REQ-002", pageRole: "procurement_evaluation_crosswalk", surfaceTemplateId: "comparison_decision", claimIds: ["CLAIM-002"], figureSpecs: [] },
    { pageId: "PAGE-003", requirementId: "REQ-003", pageRole: "requirement_response", surfaceTemplateId: "process_control", claimIds: ["CLAIM-003"], figureSpecs: [figure] },
    { pageId: "PAGE-004", requirementId: "REQ-004", pageRole: "delivery_control", surfaceTemplateId: "schedule_ownership", claimIds: ["CLAIM-004"], figureSpecs: [] },
    { pageId: "PAGE-005", requirementId: "REQ-005", pageRole: "mandatory_form", surfaceTemplateId: "mandatory_form", claimIds: ["CLAIM-005"], figureSpecs: [] },
  ],
};

function architecture(): PageArchitectureManifest {
  return {
    schemaVersion: "2.0.0",
    projectId: "fixture-project",
    documentMode: "public_procurement",
    modePolicyVersion: "1.0.0",
    architectureStatus: "complete",
    chapters: [{ chapterId: "CH-001", title: "Proposal", order: 0 }],
    sections: pagePlan.pages.map((page, index) => ({ sectionId: `SEC-${index + 1}`, chapterId: "CH-001", order: index })),
    pages: pagePlan.pages.map((page, index) => ({
      pageId: page.pageId,
      chapterId: "CH-001",
      sectionId: `SEC-${index + 1}`,
      pageRole: page.pageRole,
      surfaceTemplateId: page.surfaceTemplateId,
      titleScope: index === 0 ? "chapter" as const : index === 3 ? "none" as const : "section" as const,
      continuation: index === 3,
      dominantSurface: index === 0 ? "narrative" as const : index === 1 ? "table" as const : index === 2 ? "mixed" as const : index === 4 ? "form" as const : "figure" as const,
      surfaceVisibility: "internal" as const,
      claimIds: [...page.claimIds],
      proofIds: index === 2 ? ["PROOF-003"] : [],
      referenceIds: [],
      figureIds: page.figureSpecs.map(({ figureId }) => figureId),
      ...(index === 2 ? { continuityToPageId: "PAGE-004" } : {}),
      ...(index === 3 ? { continuityFromPageId: "PAGE-003" } : {}),
    })),
  };
}

describe("validatePageArchitecture", () => {
  it("accepts a valid five-page mixed architecture", () => {
    expect(validatePageArchitecture(architecture(), pagePlan, getDocumentModePolicy("public_procurement")))
      .toEqual({ status: "PASS", findings: [] });
  });

  it("rejects a 20.5-point continuation title with a stable locator", () => {
    const manifest = architecture();
    manifest.pages[3] = { ...manifest.pages[3]!, titleScope: "surface", titlePointSize: 20.5 };
    expect(validatePageArchitecture(manifest, pagePlan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: [{ ruleId: "KPP_ARCH_TITLE_SCOPE", evidence: { locator: "page:PAGE-004" } }],
    });
  });

  it("rejects a missing reciprocal continuity link", () => {
    const manifest = architecture();
    manifest.pages[2] = { ...manifest.pages[2]!, continuityToPageId: undefined };
    expect(validatePageArchitecture(manifest, pagePlan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: [{ ruleId: "KPP_ARCH_CONTINUITY", evidence: { locator: "page:PAGE-004" } }],
    });
  });

  it("rejects mode and policy mismatches", () => {
    const manifest = { ...architecture(), documentMode: "research_service" as const };
    expect(validatePageArchitecture(manifest, pagePlan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: [{ ruleId: "KPP_ARCH_MODE_MISMATCH", evidence: { locator: "manifest" } }],
    });
  });

  it("rejects a cross-mode page role even when the page plan repeats it", () => {
    const manifest = architecture();
    const plan = structuredClone(pagePlan);
    manifest.pages[0] = { ...manifest.pages[0]!, pageRole: "mutual_value" };
    plan.pages[0] = { ...plan.pages[0]!, pageRole: "mutual_value" };
    expect(validatePageArchitecture(manifest, plan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({
        ruleId: "KPP_ARCH_MODE_PAGE_ROLE",
        evidence: expect.objectContaining({ locator: "page:PAGE-001/pageRole" }),
      })]),
    });
  });

  it("rejects a cross-mode surface template even when the page plan repeats it", () => {
    const manifest = architecture();
    const plan = structuredClone(pagePlan);
    manifest.pages[0] = { ...manifest.pages[0]!, surfaceTemplateId: "partnership_narrative" };
    plan.pages[0] = { ...plan.pages[0]!, surfaceTemplateId: "partnership_narrative" };
    expect(validatePageArchitecture(manifest, plan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({
        ruleId: "KPP_ARCH_MODE_SURFACE",
        evidence: expect.objectContaining({ locator: "page:PAGE-001/surfaceTemplateId" }),
      })]),
    });
  });

  it("rejects missing required roles in a complete architecture", () => {
    const manifest = architecture();
    const plan = structuredClone(pagePlan);
    manifest.pages[1] = { ...manifest.pages[1]!, pageRole: "approach_overview" };
    plan.pages[1] = { ...plan.pages[1]!, pageRole: "approach_overview" };
    expect(validatePageArchitecture(manifest, plan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({
        ruleId: "KPP_ARCH_REQUIRED_ROLE_MISSING",
        evidence: expect.objectContaining({ locator: "manifest/pageRoles" }),
      })]),
    });
  });

  it("rejects a one-page manifest that claims complete without every required role", () => {
    const manifest = architecture();
    const plan = structuredClone(pagePlan);
    manifest.pages = [manifest.pages[2]!];
    manifest.sections = [manifest.sections[2]!];
    plan.pages = [plan.pages[2]!];
    expect(validatePageArchitecture(manifest, plan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "KPP_ARCH_REQUIRED_ROLE_MISSING" })]),
    });
  });

  it("allows the same explicit one-page subset only when status is staged", () => {
    const manifest = architecture();
    const plan = structuredClone(pagePlan);
    manifest.architectureStatus = "staged";
    manifest.pages = [{ ...manifest.pages[2]!, continuityToPageId: undefined }];
    manifest.sections = [manifest.sections[2]!];
    plan.pages = [plan.pages[2]!];
    expect(validatePageArchitecture(manifest, plan, getDocumentModePolicy("public_procurement")))
      .toEqual({ status: "PASS", findings: [] });
  });

  it("rejects an untyped continuation title size at the schema boundary", () => {
    const manifest = architecture() as unknown as { pages: Array<Record<string, unknown>> };
    manifest.pages[3] = { ...manifest.pages[3]!, titlePointSize: "20.5" };
    expect(PageArchitectureManifestSchema.safeParse(manifest)).toMatchObject({ success: false });
  });

  it("rejects duplicate page IDs", () => {
    const manifest = architecture();
    manifest.pages[4] = { ...manifest.pages[4]!, pageId: "PAGE-004" };
    expect(validatePageArchitecture(manifest, pagePlan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "KPP_ARCH_DUPLICATE_PAGE_ID", evidence: expect.objectContaining({ locator: "page:PAGE-004" }) })]),
    });
  });

  it.each([
    ["claimIds", "CLAIM-404", "KPP_ARCH_UNRESOLVED_CLAIM_ID"],
    ["figureIds", "FIG-404", "KPP_ARCH_UNRESOLVED_FIGURE_ID"],
    ["proofIds", "PROOF-404", "KPP_ARCH_UNRESOLVED_PROOF_ID"],
  ] as const)("rejects unresolved %s", (field, identifier, ruleId) => {
    const manifest = architecture();
    manifest.pages[2] = { ...manifest.pages[2]!, [field]: [identifier] };
    expect(validatePageArchitecture(manifest, pagePlan, getDocumentModePolicy("public_procurement"))).toMatchObject({
      status: "FAIL",
      findings: expect.arrayContaining([expect.objectContaining({ ruleId, evidence: expect.objectContaining({ locator: `page:PAGE-003/${field}:${identifier}` }) })]),
    });
  });
});
