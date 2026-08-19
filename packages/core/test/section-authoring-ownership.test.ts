import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSectionPlan, initializeProject } from "../src/index.js";

describe("KPP-owned section authoring", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it("persists the canonical section plan through @longtable/kpp-core", async () => {
    const root = join(tmpdir(), `kpp-section-authoring-${crypto.randomUUID()}`);
    temporaryDirectories.push(root);
    await initializeProject(root, { projectId: "project-1", proposalClass: "general_procurement" });

    const plan = await createSectionPlan({
      root,
      projectId: "project-1",
      sections: [{
        sectionId: "section-problem",
        parentSectionId: null,
        purpose: "문제와 필요성을 설명한다.",
        readerTasks: ["실행 가능성을 판단한다."],
        requirementIds: ["requirement-1"],
        claimIds: ["claim-1"],
        evidenceIds: ["evidence-1"],
        argumentMoves: ["problem", "evidence", "action"],
        visualNeeds: [],
        openDecisionIds: [],
        representativeRole: "problem",
      }],
    });

    expect(plan).toMatchObject({ schemaVersion: "section-plan/v1", projectId: "project-1" });
    await expect(readFile(join(root, "content", "section-plan.json"), "utf8")).resolves.toContain('"section-problem"');
  });
});
