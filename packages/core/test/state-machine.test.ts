import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    expect(allowedNext("RELEASED")).toEqual([]);
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

    await mkdir(join(root, "sources"));
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
  await writeReceipt({
    stage,
    files: options.files ?? [],
    inputReceiptHashes: options.inputReceiptHashes,
    result: options.result,
    output: receiptPath(root, stage),
  });
}

function receiptPath(root: string, stage: Parameters<typeof writeReceipt>[0]["stage"]): string {
  const filenames: Partial<Record<Parameters<typeof writeReceipt>[0]["stage"], string>> = {
    SOURCE_LOCKED: "source-lock.json",
    REQUIREMENTS_LOCKED: "requirements-lock.json",
    EVIDENCE_LOCKED: "evidence-lock.json",
    DESIGN_LOCKED: "design-lock.json",
    CONTENT_APPROVED: "content-approval.json",
    BUILT: "build.json",
    RENDERED: "render.json",
    AUDITED: "audit.json",
    HUMAN_APPROVED: "approval.json",
    RELEASED: "release.json",
  };
  return join(root, "receipts", filenames[stage] ?? "no-receipt.json");
}
