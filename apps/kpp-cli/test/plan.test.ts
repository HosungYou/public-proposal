import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  advanceProject,
  initializeProject,
  sha256File,
  verifyReceipt,
  writeReceipt,
} from "@longtable/kpp-core";
import { planCommand } from "../src/commands/plan.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("plan architecture and reference persistence", () => {
  it("writes and receipt-binds valid v2 manifests", async () => {
    const fixture = await createFixture();
    await planCommand(fixture.root, fixture.requirementsPath);

    const architecturePath = join(fixture.root, "content", "page-architecture.json");
    const referencesPath = join(fixture.root, "evidence", "reference-manifest.json");
    const architecture = JSON.parse(await readFile(architecturePath, "utf8")) as Record<string, unknown>;
    const references = JSON.parse(await readFile(referencesPath, "utf8")) as Record<string, unknown>;
    expect(architecture).toMatchObject({
      schemaVersion: "2.0.0",
      projectId: "plan-v2-fixture",
      documentMode: "public_procurement",
      modePolicyVersion: "1.0.0",
      architectureStatus: "staged",
      pages: [{ pageId: "PAGE-001", claimIds: ["CLAIM-001"], referenceIds: ["EVID-001"] }],
    });
    expect(references).toMatchObject({
      schemaVersion: "2.0.0",
      projectId: "plan-v2-fixture",
      documentMode: "public_procurement",
      modePolicyVersion: "1.0.0",
      references: [{ referenceId: "EVID-001", referenceClass: "evidence" }],
    });
    const requirementsReceipt = await verifyReceipt(join(fixture.root, "receipts", "requirements-lock.json"));
    const evidenceReceipt = await verifyReceipt(join(fixture.root, "receipts", "evidence-lock.json"));
    expect(requirementsReceipt.valid).toBe(true);
    expect(requirementsReceipt.receipt.files.map(({ path }) => path)).toContain(architecturePath);
    expect(evidenceReceipt.valid).toBe(true);
    expect(evidenceReceipt.receipt.files.map(({ path }) => path)).toContain(referencesPath);
  });

  it("does not persist either manifest when locked source validation fails", async () => {
    const fixture = await createFixture("a".repeat(64));
    await expect(planCommand(fixture.root, fixture.requirementsPath)).rejects.toMatchObject({
      code: "KPP_INPUT_EVIDENCE_UNRESOLVED",
    });
    await expect(readFile(join(fixture.root, "content", "page-architecture.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(fixture.root, "evidence", "reference-manifest.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses cross-mode roles and templates before persisting manifests", async () => {
    const fixture = await createFixture(undefined, {
      pageRole: "mutual_value",
      surfaceTemplateId: "partnership_narrative",
    });
    await expect(planCommand(fixture.root, fixture.requirementsPath)).rejects.toMatchObject({
      code: "KPP_PLAN_MANIFEST_INVALID",
    });
    await expect(readFile(join(fixture.root, "content", "page-architecture.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(fixture.root, "evidence", "reference-manifest.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([1, 2, 3])("receipt-binds staged status for an incomplete %i-page plan", async (pageCount) => {
    const fixture = await createFixture(undefined, undefined, pageCount);
    await planCommand(fixture.root, fixture.requirementsPath);
    const architecturePath = join(fixture.root, "content", "page-architecture.json");
    const architecture = JSON.parse(await readFile(architecturePath, "utf8")) as {
      architectureStatus: string;
      pages: unknown[];
    };
    expect(architecture.architectureStatus).toBe("staged");
    expect(architecture.pages).toHaveLength(pageCount);
    const evidenceReceipt = await verifyReceipt(join(fixture.root, "receipts", "evidence-lock.json"));
    expect(evidenceReceipt.valid).toBe(true);
    expect(evidenceReceipt.receipt.files.map(({ path }) => path)).toContain(architecturePath);
  });
});

async function createFixture(
  storedHash?: string,
  page?: { readonly pageRole: string; readonly surfaceTemplateId: string },
  pageCount = 1,
): Promise<{ root: string; requirementsPath: string }> {
  const selectedPage = page ?? {
    pageRole: "requirement_response",
    surfaceTemplateId: "evidence_analysis",
  };
  const root = await mkdtemp(join(tmpdir(), "kpp-plan-v2-"));
  roots.push(root);
  await initializeProject(root, {
    projectId: "plan-v2-fixture",
    documentMode: "public_procurement",
  });
  const sourcePath = join(root, "sources", "rfp.txt");
  const evidencePath = join(root, "sources", "evidence.txt");
  await writeFile(sourcePath, "official RFP\n", "utf8");
  await writeFile(evidencePath, "bounded evidence\n", "utf8");
  await writeReceipt({
    stage: "SOURCE_LOCKED",
    files: [sourcePath],
    inputReceiptHashes: [],
    output: join(root, "receipts", "source-lock.json"),
  });
  await advanceProject(root, "SOURCE_LOCKED");
  const requirementsPath = join(root, "requirements-input.json");
  await writeFile(requirementsPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    confirmationStatus: "confirmed",
    confirmedBy: "fixture-owner",
    evidenceBindings: [{
      evidenceId: "EVID-001",
      sourcePath: evidencePath,
      sourceSha256: storedHash ?? await sha256File(evidencePath),
      scope: "bounded evidence",
      claimIds: ["CLAIM-001"],
      targetRequirementId: "REQ-001",
      targetPageId: "PAGE-001",
      targetPageRole: selectedPage.pageRole,
    }],
    requirements: Array.from({ length: pageCount }, (_, index) => ({
      requirementId: `REQ-${String(index + 1).padStart(3, "0")}`,
      title: `Requirement response ${index + 1}`,
      critical: false,
      pageRole: selectedPage.pageRole,
      surfaceTemplateId: selectedPage.surfaceTemplateId,
      claims: index === 0
        ? [{ claimId: "CLAIM-001", critical: false, evidenceIds: ["EVID-001"] }]
        : [],
      figureSpecs: [],
    })),
  }, null, 2)}\n`, "utf8");
  return { root, requirementsPath };
}
