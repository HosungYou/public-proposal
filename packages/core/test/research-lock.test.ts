import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "research-lock");
const handoffPath = join(fixtureDirectory, "valid-handoff.json");
const openCheckpointHandoff = join(fixtureDirectory, "open-checkpoint-handoff.json");

let importResearchLock: typeof import("../src/index.js").importResearchLock;
let initializeProject: typeof import("../src/index.js").initializeProject;
let verifyReceipt: typeof import("../src/index.js").verifyReceipt;

describe("LongTable research lock import", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    expect(await runProcess("npm", ["run", "build", "--workspace", "@longtable/kpp-schemas"]))
      .toMatchObject({ code: 0, stderr: "" });
    ({ importResearchLock, initializeProject, verifyReceipt } = await import("../src/index.js"));
  });

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it("imports a valid LongTable handoff and writes a hash-bound research receipt", async () => {
    const root = await createResearchProject(temporaryDirectories);

    const result = await importResearchLock(root, handoffPath, "0.1.72");

    expect(result).toMatchObject({
      state: "PASS",
      receiptPath: join(root, "receipts", "research-lock.json"),
    });
    const verification = await verifyReceipt(join(root, "receipts", "research-lock.json"));
    expect(verification).toMatchObject({ valid: true });
    expect(verification.receipt.inputReceiptHashes).toEqual([
      "9247cacf92548fa6b25f469c221899da8cb51eab221bec47746cbab9177ed024",
      "db605b1ba19ab40c47f81b624a199471a2021e30d0098edaaa99468e71d754ee",
      "e28bd6b7a183bade21d9e18ce1d1fd2f4e7759974a46a4cb2135e7d1014d9d6e",
      "f10795ef239462d0cabd87a9e6b84e7a13156c86a346e09974e45c177609695e",
    ]);
    expect(verification.receipt.files.map(({ path }) => path).sort()).toEqual([
      handoffPath,
      join(root, "evidence", "research-lock", "citation-slot-matrix.json"),
      join(root, "evidence", "research-lock", "claim-transfer-ledger.json"),
      join(root, "evidence", "research-lock", "research-specification.json"),
      join(root, "evidence", "research-lock", "source-ledger.json"),
    ].sort());
  });

  it("blocks a handoff with an unresolved required checkpoint", async () => {
    const root = await createResearchProject(temporaryDirectories);

    await expect(importResearchLock(root, openCheckpointHandoff, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_RESEARCH_CHECKPOINT_OPEN" });
    await expect(readFile(join(root, "receipts", "research-lock.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a hash-only handoff that omits the project-relative artifact paths", async () => {
    const root = await createResearchProject(temporaryDirectories);
    const handoff = JSON.parse(await readFile(handoffPath, "utf8")) as Record<string, unknown>;
    delete handoff.researchSpecificationPath;
    const invalidHandoffPath = join(root, "evidence", "research-lock", "hash-only-handoff.json");
    await writeFile(invalidHandoffPath, `${JSON.stringify(handoff, null, 2)}\n`);

    await expect(importResearchLock(root, invalidHandoffPath, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_RESEARCH_HANDOFF_INVALID" });
  });

  it("rejects a handoff artifact path that escapes through a symlink", async () => {
    const root = await createResearchProject(temporaryDirectories);
    const outside = join(await mkdtemp(join(tmpdir(), "kpp-research-outside-")), "source-ledger.json");
    temporaryDirectories.push(dirname(outside));
    await writeFile(outside, await readFile(join(root, "evidence", "research-lock", "source-ledger.json")));
    await rm(join(root, "evidence", "research-lock", "source-ledger.json"));
    await symlink(outside, join(root, "evidence", "research-lock", "source-ledger.json"));

    await expect(importResearchLock(root, handoffPath, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_RESEARCH_ARTIFACT_PATH" });
  });

  it("does not overwrite an existing valid research receipt for the same handoff", async () => {
    const root = await createResearchProject(temporaryDirectories);
    await importResearchLock(root, handoffPath, "0.1.72");
    const receiptPath = join(root, "receipts", "research-lock.json");
    const originalReceipt = await readFile(receiptPath, "utf8");

    await importResearchLock(root, handoffPath, "0.1.72");

    expect(await readFile(receiptPath, "utf8")).toBe(originalReceipt);
  });
});

async function createResearchProject(temporaryDirectories: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-research-lock-"));
  temporaryDirectories.push(root);
  await initializeProject(root, {
    projectId: "research-lock-fixture",
    proposalClass: "research_service",
  });
  await cp(join(fixtureDirectory, "evidence"), join(root, "evidence"), { recursive: true });
  return root;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runProcess(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error: Error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
