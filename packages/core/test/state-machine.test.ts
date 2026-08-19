import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  advanceProject,
  allowedNext,
  initializeProject,
  readProject,
  sha256File,
  writeReceipt,
} from "../src/index.js";

describe("project state transitions", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it("cannot skip from INIT to BUILT", async () => {
    const root = await createProjectRoot(temporaryDirectories);

    await expect(advanceProject(root, "BUILT")).rejects.toMatchObject({
      code: "KPP_STATE_INVALID_TRANSITION",
    });
  });

  it("cannot repeat a completed transition", async () => {
    const root = await createProjectRoot(temporaryDirectories);
    await writeStageReceipt(root, "SOURCE_LOCKED");
    await advanceProject(root, "SOURCE_LOCKED");

    await expect(advanceProject(root, "SOURCE_LOCKED")).rejects.toMatchObject({
      code: "KPP_STATE_INVALID_TRANSITION",
    });
  });

  it("returns only the adjacent state as an allowed next transition", () => {
    expect(allowedNext("INIT")).toEqual(["SOURCE_LOCKED"]);
    expect(allowedNext("SOURCE_LOCKED")).toEqual(["REQUIREMENTS_LOCKED"]);
    expect(allowedNext("REQUIREMENTS_LOCKED")).toEqual(["BRIEF_LOCKED", "EVIDENCE_LOCKED"]);
    expect(allowedNext("DESIGN_LOCKED")).toEqual(["REPRESENTATIVE_REVIEW_REQUIRED"]);
    expect(allowedNext("RELEASED")).toEqual([]);
  });

  it("requires representative approval before content approval on the vNext path", async () => {
    const root = await createProjectRoot(temporaryDirectories);
    await writeStageReceipt(root, "SOURCE_LOCKED");
    await advanceProject(root, "SOURCE_LOCKED");
    await writeStageReceipt(root, "REQUIREMENTS_LOCKED", {
      inputReceiptHashes: [await sha256File(receiptPath(root, "SOURCE_LOCKED"))],
    });
    await advanceProject(root, "REQUIREMENTS_LOCKED");
    await writeStageReceipt(root, "BRIEF_LOCKED", {
      inputReceiptHashes: [await sha256File(receiptPath(root, "REQUIREMENTS_LOCKED"))],
    });
    await advanceProject(root, "BRIEF_LOCKED");
    await writeStageReceipt(root, "DESIGN_LOCKED", {
      inputReceiptHashes: [await sha256File(receiptPath(root, "BRIEF_LOCKED"))],
    });
    await advanceProject(root, "DESIGN_LOCKED");

    await expect(advanceProject(root, "CONTENT_APPROVED")).rejects.toMatchObject({
      code: "KPP_STATE_INVALID_TRANSITION",
    });
  });

  it("requires a valid passing receipt for the adjacent transition", async () => {
    const root = await createProjectRoot(temporaryDirectories);

    await expect(advanceProject(root, "SOURCE_LOCKED")).rejects.toMatchObject({
      code: "KPP_INPUT_RECEIPT_READ",
    });

    await writeStageReceipt(root, "SOURCE_LOCKED", { result: "BLOCKED" });

    await expect(advanceProject(root, "SOURCE_LOCKED")).rejects.toMatchObject({
      code: "KPP_STATE_RECEIPT_BLOCKED",
    });
  });

  it("does not advance with an empty passing receipt", async () => {
    const root = await createProjectRoot(temporaryDirectories);

    await writeFile(
      receiptPath(root, "SOURCE_LOCKED"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        stage: "SOURCE_LOCKED",
        createdAt: "2026-08-17T00:00:00.000Z",
        toolVersion: "0.1.0",
        files: [],
        inputReceiptHashes: [],
        result: "PASS",
      })}\n`,
    );

    await expect(advanceProject(root, "SOURCE_LOCKED")).rejects.toMatchObject({
      code: "KPP_INPUT_RECEIPT_INVALID",
    });
    await expect(readProject(root)).resolves.toMatchObject({ state: "INIT" });
  });

  it("requires the preceding receipt hash as a transition input", async () => {
    const root = await createProjectRoot(temporaryDirectories);
    await writeStageReceipt(root, "SOURCE_LOCKED");
    await advanceProject(root, "SOURCE_LOCKED");
    await writeStageReceipt(root, "REQUIREMENTS_LOCKED");

    await expect(advanceProject(root, "REQUIREMENTS_LOCKED")).rejects.toMatchObject({
      code: "KPP_INPUT_RECEIPT_MISSING",
    });
  });

  it("invalidates to the predecessor of the earliest changed receipt stage", async () => {
    const root = await createProjectRoot(temporaryDirectories);
    const source = join(root, "sources", "rfp.txt");

    await writeFile(source, "original source");
    await writeStageReceipt(root, "SOURCE_LOCKED", { files: [source] });
    await advanceProject(root, "SOURCE_LOCKED");
    await writeStageReceipt(root, "REQUIREMENTS_LOCKED", {
      inputReceiptHashes: [await sha256File(receiptPath(root, "SOURCE_LOCKED"))],
    });
    await advanceProject(root, "REQUIREMENTS_LOCKED");
    await writeFile(source, "changed source");
    await writeStageReceipt(root, "EVIDENCE_LOCKED", {
      inputReceiptHashes: [await sha256File(receiptPath(root, "REQUIREMENTS_LOCKED"))],
    });

    await expect(advanceProject(root, "EVIDENCE_LOCKED")).rejects.toMatchObject({
      code: "KPP_INPUT_RECEIPT_INVALID",
    });
    await expect(readProject(root)).resolves.toMatchObject({ state: "INIT" });
  });

  it("invalidates a released project before rejecting a new transition", async () => {
    const root = await createProjectRoot(temporaryDirectories);
    const stageArtifacts = new Map<string, string>();
    let predecessorHash: string | undefined;

    for (const stage of allowedStagesAfterInit()) {
      const artifact = await createStageArtifact(root, stage);
      stageArtifacts.set(stage, artifact);
      await writeStageReceipt(root, stage, {
        files: [artifact],
        inputReceiptHashes: predecessorHash === undefined ? [] : [predecessorHash],
      });
      await advanceProject(root, stage);
      predecessorHash = await sha256File(receiptPath(root, stage));
    }

    await writeFile(stageArtifacts.get("HUMAN_APPROVED")!, "changed approval artifact");

    await expect(advanceProject(root, "RELEASED")).rejects.toMatchObject({
      code: "KPP_INPUT_RECEIPT_INVALID",
    });
    await expect(readProject(root)).resolves.toMatchObject({ state: "AUDITED" });
  });

  it("cleans up a project temporary file when the final rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpp-state-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "kpp.project.yaml"));

    await expect(initializeProject(root, { projectId: "sample" })).rejects.toThrow();

    expect((await readdir(root)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps project state readable after concurrent atomic initialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpp-state-"));
    temporaryDirectories.push(root);

    await Promise.all(
      Array.from({ length: 16 }, () => initializeProject(root, { projectId: "sample" })),
    );

    await expect(readProject(root)).resolves.toMatchObject({
      projectId: "sample",
      state: "INIT",
    });
    expect((await readdir(root)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("defaults initializeProject to general_procurement when proposalClass is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpp-state-"));
    temporaryDirectories.push(root);

    const project = await initializeProject(root, { projectId: "sample" });

    expect(project).toMatchObject({
      projectId: "sample",
      proposalClass: "general_procurement",
      state: "INIT",
    });
    await expect(readFile(join(root, "kpp.project.yaml"), "utf8")).resolves.toContain(
      "proposalClass: general_procurement",
    );
  });
});

async function createProjectRoot(temporaryDirectories: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-state-"));
  temporaryDirectories.push(root);
  await initializeProject(root, { projectId: "sample" });
  return root;
}

async function writeStageReceipt(
  root: string,
  stage: Parameters<typeof writeReceipt>[0]["stage"],
  options: {
    readonly files?: readonly string[];
    readonly inputReceiptHashes?: readonly string[];
    readonly result?: "PASS" | "BLOCKED";
  } = {},
): Promise<void> {
  const files = options.files ?? [await createStageArtifact(root, stage)];
  await writeReceipt({
    stage,
    files,
    inputReceiptHashes: options.inputReceiptHashes,
    result: options.result,
    output: receiptPath(root, stage),
  });
}

async function createStageArtifact(
  root: string,
  stage: Parameters<typeof writeReceipt>[0]["stage"],
): Promise<string> {
  const directory = join(root, "artifacts");
  const artifact = join(directory, `${stage.toLowerCase()}.txt`);
  await mkdir(directory, { recursive: true });
  await writeFile(artifact, `${stage} artifact`);
  return artifact;
}

function allowedStagesAfterInit(): Parameters<typeof writeReceipt>[0]["stage"][] {
  return [
    "SOURCE_LOCKED",
    "REQUIREMENTS_LOCKED",
    "EVIDENCE_LOCKED",
    "DESIGN_LOCKED",
    "CONTENT_APPROVED",
    "BUILT",
    "RENDERED",
    "AUDITED",
    "HUMAN_APPROVED",
    "RELEASED",
  ];
}

function receiptPath(root: string, stage: Parameters<typeof writeReceipt>[0]["stage"]): string {
  const filenames: Partial<Record<Parameters<typeof writeReceipt>[0]["stage"], string>> = {
    SOURCE_LOCKED: "source-lock.json",
    REQUIREMENTS_LOCKED: "requirements-lock.json",
    BRIEF_LOCKED: "brief-lock.json",
    RESEARCH_LOCKED: "research-bundle-lock.json",
    EVIDENCE_LOCKED: "evidence-lock.json",
    DESIGN_LOCKED: "design-lock.json",
    REPRESENTATIVE_REVIEW_REQUIRED: "representative-review.json",
    REPRESENTATIVE_APPROVED: "representative-approval.json",
    CONTENT_APPROVED: "content-approval.json",
    BUILT: "build.json",
    RENDERED: "render.json",
    AUDITED: "audit.json",
    HUMAN_APPROVED: "approval.json",
    RELEASED: "release.json",
  };
  return join(root, "receipts", filenames[stage] ?? "no-receipt.json");
}
