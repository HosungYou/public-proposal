import { describe, expect, it } from "vitest";
import { AGENT_TRIGGER_MATRIX, selectAgentProfile } from "../src/agent-policy.js";

describe("automatic proposal agent routing", () => {
  it("selects only compliance and architect for quick ordinary procurement", () => {
    const plan = selectAgentProfile({
      proposalClass: "general_procurement",
      risk: "low",
      hasFigure: false,
      representative: false,
    });

    expect(plan.roles).toEqual(["Proposal Architect", "RFP/Compliance Reviewer"]);
    expect(plan.longtable).toBe(false);
    expect(plan.profile).toBe("quick");
    expect(plan.maxConcurrency).toBe(3);
    expect(plan.maxRebuttalsPerFinding).toBe(1);
    expect(plan.maxAutomaticSectionRevisions).toBe(2);
    expect(plan.maxAgentRunsPerStage).toBe(12);
  });

  it("adds only the reviewers triggered by research, evidence, representative, visual, privacy, and release work", () => {
    const plan = selectAgentProfile({
      proposalClass: "research_service",
      risk: "high",
      hasFigure: true,
      hasInstitutionFacts: true,
      hasQualificationOrPii: true,
      representative: true,
      stage: "release",
    });

    expect(plan.roles).toEqual([
      "Proposal Architect",
      "RFP/Compliance Reviewer",
      "Methods/Evidence Reviewer",
      "Institutional Evidence and Data Reviewer",
      "Korean Prose Reviewer",
      "Evaluator Red Team",
      "Visual/Render Reviewer",
      "Proof/Privacy Reviewer",
      "fresh-context Submission Gate Reviewer",
    ]);
    expect(plan.longtable).toBe(true);
    expect(plan.profile).toBe("deep");
    expect(plan.maxConcurrency).toBe(10);
  });

  it("exports the exact trigger constants consumed by the CLI and documented user surface", () => {
    expect(AGENT_TRIGGER_MATRIX).toMatchObject({
      everyProposal: ["Proposal Architect", "RFP/Compliance Reviewer"],
      researchOrPolicy: ["Methods/Evidence Reviewer"],
      institutionFacts: ["Institutional Evidence and Data Reviewer"],
      representative: ["Korean Prose Reviewer", "Evaluator Red Team"],
      figureOrTable: ["Visual/Render Reviewer"],
      qualificationOrPii: ["Proof/Privacy Reviewer"],
      release: ["fresh-context Submission Gate Reviewer"],
    });
  });

  it("routes visual review for a table even when a section has no figure", () => {
    const plan = selectAgentProfile({
      proposalClass: "general_procurement",
      risk: "low",
      hasFigure: false,
      hasTable: true,
      representative: false,
    });

    expect(plan.roles).toContain("Visual/Render Reviewer");
  });
});
