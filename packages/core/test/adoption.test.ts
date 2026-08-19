import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adoptProject, readProject } from "../src/index.js";

describe("legacy project adoption", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("adopts a draft as UNMANAGED_DRAFT without creating approval or release artifacts", async () => {
    const legacyRoot = await temporaryRoot("kpp-legacy-");
    const outputRoot = join(await temporaryRoot("kpp-adopt-parent-"), "project");
    await mkdir(join(legacyRoot, ".longtable", "runs", "run-001"), { recursive: true });
    await writeFile(join(legacyRoot, "기관-제안요청서.pdf"), "rfp bytes", "utf8");
    await writeFile(join(legacyRoot, "working-master.docx"), "draft bytes", "utf8");
    await writeFile(join(legacyRoot, "claim-ledger.json"), '{"claims":[{"claimId":"CLM-1"}]}\n', "utf8");
    await writeFile(join(legacyRoot, "evidence-ledger.json"), '{"claims":[],"bindings":[]}\n', "utf8");
    await writeFile(join(legacyRoot, "figure-ledger.json"), '{"figures":[]}\n', "utf8");
    await writeFile(join(legacyRoot, "unsupported-section.md"), "source-less draft", "utf8");

    const report = await adoptProject({ root: legacyRoot, outputRoot });

    expect(report.state).toBe("UNMANAGED_DRAFT");
    expect((await readProject(outputRoot)).state).toBe("UNMANAGED_DRAFT");
    expect(report.longtableRuns).toEqual([expect.objectContaining({ status: "legacy_readable" })]);
    expect(report.provisionalContent).toEqual([
      expect.objectContaining({ originalPath: join(legacyRoot, "unsupported-section.md"), status: "provisional" }),
    ]);
    await expect(readFile(join(outputRoot, "content-approval.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(outputRoot, "receipts", "content-approval.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(outputRoot, "receipts", "human-approval.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(outputRoot, "release", "release-receipt.json"), "utf8")).rejects.toThrow();
  });

  it("is idempotent for unchanged inputs and fails closed with a diff when input bytes change", async () => {
    const legacyRoot = await temporaryRoot("kpp-legacy-idempotent-");
    const outputRoot = join(await temporaryRoot("kpp-adopt-idempotent-parent-"), "project");
    const master = join(legacyRoot, "working-master.docx");
    await writeFile(master, "draft v1", "utf8");

    const first = await adoptProject({ root: legacyRoot, outputRoot, master });
    const second = await adoptProject({ root: legacyRoot, outputRoot, master });

    expect(first.adoptionId).toBe(second.adoptionId);
    expect(second.changed).toBe(false);
    expect(second.imports).toEqual(first.imports);

    await writeFile(master, "draft v2", "utf8");
    await expect(adoptProject({ root: legacyRoot, outputRoot, master })).rejects.toMatchObject({
      code: "KPP_ADOPTION_INPUT_CHANGED",
      details: expect.objectContaining({ changed: expect.arrayContaining([expect.objectContaining({ path: master })]) }),
    });
    expect(JSON.parse(await readFile(join(outputRoot, "receipts", "adoption.json"), "utf8"))).toMatchObject({
      adoptionId: first.adoptionId,
    });
  });

  it("keeps a source-less working master bound and marks its content provisional", async () => {
    const legacyRoot = await temporaryRoot("kpp-legacy-master-only-");
    const outputRoot = join(await temporaryRoot("kpp-adopt-master-only-parent-"), "project");
    const master = join(legacyRoot, "working-master.docx");
    await writeFile(master, "source-less draft", "utf8");

    const report = await adoptProject({ root: legacyRoot, outputRoot, master });

    expect(report.imports).toEqual([
      expect.objectContaining({ role: "working_master", originalPath: master }),
    ]);
    expect(report.provisionalContent).toEqual([
      expect.objectContaining({ originalPath: master, status: "provisional", reason: "no_source_binding" }),
    ]);
    expect(JSON.parse(await readFile(join(outputRoot, "content", "provisional-content.json"), "utf8"))).toMatchObject({
      entries: [expect.objectContaining({ originalPath: master, status: "provisional" })],
    });
  });

  it("rejects a symlinked adoption root before it can mutate the target", async () => {
    const targetRoot = await temporaryRoot("kpp-adopt-symlink-target-");
    const parentRoot = await temporaryRoot("kpp-adopt-symlink-parent-");
    const linkedRoot = join(parentRoot, "linked-legacy");
    await writeFile(join(targetRoot, "working-master.docx"), "legacy draft", "utf8");
    await symlink(targetRoot, linkedRoot, "dir");

    await expect(adoptProject({ root: linkedRoot })).rejects.toMatchObject({
      code: "KPP_INPUT_ADOPTION_SYMLINK",
    });
    await expect(readFile(join(targetRoot, "kpp.project.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(targetRoot, "receipts", "adoption.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an adoption root behind a symlinked ancestor before it can mutate the target", async () => {
    const targetParent = await temporaryRoot("kpp-adopt-ancestor-target-");
    const targetRoot = join(targetParent, "legacy");
    const parentRoot = await temporaryRoot("kpp-adopt-ancestor-parent-");
    const linkedAncestor = join(parentRoot, "linked-parent");
    await mkdir(targetRoot);
    await writeFile(join(targetRoot, "working-master.docx"), "legacy draft", "utf8");
    await symlink(targetParent, linkedAncestor, "dir");

    await expect(adoptProject({ root: join(linkedAncestor, "legacy") })).rejects.toMatchObject({
      code: "KPP_INPUT_ADOPTION_SYMLINK",
    });
    await expect(readFile(join(targetRoot, "kpp.project.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(targetRoot, "receipts", "adoption.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an existing symlink output root before it can mutate the target", async () => {
    const legacyRoot = await temporaryRoot("kpp-adopt-output-symlink-legacy-");
    const targetRoot = await temporaryRoot("kpp-adopt-output-symlink-target-");
    const parentRoot = await temporaryRoot("kpp-adopt-output-symlink-parent-");
    const linkedOutputRoot = join(parentRoot, "linked-project");
    await writeFile(join(legacyRoot, "working-master.docx"), "legacy draft", "utf8");
    await symlink(targetRoot, linkedOutputRoot, "dir");

    await expect(adoptProject({ root: legacyRoot, outputRoot: linkedOutputRoot })).rejects.toMatchObject({
      code: "KPP_INPUT_ADOPTION_SYMLINK",
    });
    await expect(readFile(join(targetRoot, "kpp.project.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(targetRoot, "receipts", "adoption.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an existing output root behind a symlinked ancestor", async () => {
    const legacyRoot = await temporaryRoot("kpp-adopt-output-ancestor-legacy-");
    const targetParent = await temporaryRoot("kpp-adopt-output-ancestor-target-");
    const targetRoot = join(targetParent, "project");
    const parentRoot = await temporaryRoot("kpp-adopt-output-ancestor-parent-");
    const linkedAncestor = join(parentRoot, "linked-parent");
    await writeFile(join(legacyRoot, "working-master.docx"), "legacy draft", "utf8");
    await mkdir(targetRoot);
    await symlink(targetParent, linkedAncestor, "dir");

    await expect(adoptProject({ root: legacyRoot, outputRoot: join(linkedAncestor, "project") })).rejects.toMatchObject({
      code: "KPP_INPUT_ADOPTION_SYMLINK",
    });
    await expect(readFile(join(targetRoot, "kpp.project.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(targetRoot, "receipts", "adoption.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("publishes adoption atomically so a mid-import failure can be retried", async () => {
    const legacyRoot = await temporaryRoot("kpp-legacy-atomic-");
    const outputRoot = join(await temporaryRoot("kpp-adopt-atomic-parent-"), "project");
    const brief = join(legacyRoot, "living-brief.json");
    await writeFile(join(legacyRoot, "working-master.docx"), "draft bytes", "utf8");
    await writeFile(brief, JSON.stringify({ problem: "stable legacy brief" }), "utf8");
    let copies = 0;

    await expect(adoptProject({ root: legacyRoot, outputRoot }, {
      copyFile: async (...args) => {
        copies += 1;
        if (copies === 2) throw new Error("injected mid-import failure");
        return copyFile(...args);
      },
    })).rejects.toThrow("injected mid-import failure");
    await expect(readFile(join(outputRoot, "kpp.project.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const retried = await adoptProject({ root: legacyRoot, outputRoot });

    expect(retried).toMatchObject({ changed: true, state: "UNMANAGED_DRAFT" });
    expect(JSON.parse(await readFile(join(outputRoot, "receipts", "adoption.json"), "utf8"))).toMatchObject({
      adoptionId: retried.adoptionId,
    });
  });

  it("creates a Living Brief candidate and decision diff when legacy brief inputs exist", async () => {
    const legacyRoot = await temporaryRoot("kpp-legacy-brief-");
    const outputRoot = join(await temporaryRoot("kpp-adopt-brief-parent-"), "project");
    await writeFile(join(legacyRoot, "living-brief.json"), JSON.stringify({
      problem: "legacy problem",
      activeDecisions: [{ decisionId: "DEC-1" }],
      openDecisions: [{ decisionId: "OPEN-1" }],
    }), "utf8");

    const report = await adoptProject({ root: legacyRoot, outputRoot });

    expect(report.livingBrief).toMatchObject({ candidatePath: join(outputRoot, "brief", "living-brief-candidate.json") });
    expect(JSON.parse(await readFile(join(outputRoot, "brief", "living-brief-decision-diff.json"), "utf8"))).toMatchObject({
      changed: ["DEC-1"],
      stillOpen: ["OPEN-1"],
      nextHumanGate: "review_adopted_living_brief",
    });
  });

  async function temporaryRoot(prefix: string): Promise<string> {
    const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    roots.push(root);
    return root;
  }
});
