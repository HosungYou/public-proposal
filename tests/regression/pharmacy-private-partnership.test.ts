import { afterEach, describe, expect, test } from "vitest";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { approveProject } from "../../apps/kpp-cli/src/commands/approve.js";
import { releaseProject } from "../../apps/kpp-cli/src/commands/release.js";
import {
  cleanupPharmacyFixtures,
  materializePharmacyPartnership,
  runPharmacyBuildRenderAudit,
} from "./pharmacy-fixture.js";

afterEach(cleanupPharmacyFixtures);

describe("anonymized pharmacy private-partnership regression", () => {
  test("passes the complete private-partnership architecture through build, render, and audit but remains unreleasable without named approval", async () => {
    const fixture = await materializePharmacyPartnership("valid");
    const result = await runPharmacyBuildRenderAudit(fixture);

    expect(result.audit).toMatchObject({ state: "AUDITED", report: { status: "PASS" } });
    expect(result.audit.report.slices.map(({ sliceId }) => sliceId)).toEqual(expect.arrayContaining([
      "page_architecture",
      "reference_integrity",
      "operating_model_traceability",
      "render_repetition",
      "figure_value",
      "korean_prose_review",
    ]));
    expect(result.audit.report.findings).toEqual([]);
    await expect(releaseProject(fixture.root, {
      approvalPath: join(fixture.root, "receipts", "approval.json"),
      outputParent: join(fixture.root, "release-output"),
    })).rejects.toMatchObject({ code: "KPP_RELEASE_STATE" });
    await expect(access(join(fixture.root, "receipts", "approval.json"))).rejects.toBeDefined();
  }, 120_000);

  test("blocks the oversized continuation title before the worker", async () => {
    const fixture = await materializePharmacyPartnership("oversized_title");
    await expect(runPharmacyBuildRenderAudit(fixture)).rejects.toMatchObject({
      code: "KPP_BUILD_MANIFEST_UNBOUND",
    });
  }, 30_000);

  test("blocks three consecutive copies of one rendered page topology", async () => {
    const fixture = await materializePharmacyPartnership("repeated_topology");
    const result = await runPharmacyBuildRenderAudit(fixture);
    expect(result.audit.state).toBe("RENDERED");
    expect(result.audit.report.status).toBe("BLOCKED");
    expect(result.audit.report.findings.map(({ code }) => code))
      .toContain("KPP_RENDER_SURFACE_TOPOLOGY_REPETITION");
  }, 120_000);

  test("blocks a decorative surface used in the evidentiary figure channel", async () => {
    const fixture = await materializePharmacyPartnership("decorative_evidence");
    const result = await runPharmacyBuildRenderAudit(fixture);
    expect(result.audit.state).toBe("RENDERED");
    expect(result.audit.report.status).toBe("BLOCKED");
    expect(result.audit.report.findings.map(({ code }) => code))
      .toContain("KPP_FIGURE_VALUE_DECORATIVE");
    await expect(approveProject(fixture.root, {
      approvedBy: "익명 검토자",
      auditPath: result.audit.auditPath,
    })).rejects.toMatchObject({ code: "KPP_APPROVAL_STATE" });
  }, 120_000);
});
