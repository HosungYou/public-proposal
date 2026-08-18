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
let writeReceipt: typeof import("../src/index.js").writeReceipt;

describe("LongTable research lock import", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    expect(await runProcess("npm", ["run", "build", "--workspace", "@longtable/kpp-schemas"]))
      .toMatchObject({ code: 0, stderr: "" });
    ({ importResearchLock, initializeProject, verifyReceipt, writeReceipt } = await import("../src/index.js"));
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

  it("rejects and preserves an existing malformed research-lock receipt", async () => {
    const root = await createResearchProject(temporaryDirectories);
    const receiptPath = join(root, "receipts", "research-lock.json");
    const malformedReceipt = "{not-json}\n";
    await writeFile(receiptPath, malformedReceipt);

    await expect(importResearchLock(root, handoffPath, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_RESEARCH_LOCK_INVALID" });

    expect(await readFile(receiptPath, "utf8")).toBe(malformedReceipt);
  });

  it("rejects and preserves an existing stale research-lock receipt", async () => {
    const root = await createResearchProject(temporaryDirectories);
    await importResearchLock(root, handoffPath, "0.1.72");
    const receiptPath = join(root, "receipts", "research-lock.json");
    const originalReceipt = await readFile(receiptPath, "utf8");
    await writeFile(join(root, "evidence", "research-lock", "source-ledger.json"), "changed source ledger\n");

    await expect(importResearchLock(root, handoffPath, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_RESEARCH_LOCK_INVALID" });

    expect(await readFile(receiptPath, "utf8")).toBe(originalReceipt);
  });

  it("rejects a valid foreign-stage receipt at the research-lock path", async () => {
    const root = await createResearchProject(temporaryDirectories);
    const receiptPath = join(root, "receipts", "research-lock.json");
    await writeReceipt({
      stage: "SOURCE_LOCKED",
      files: expectedReceiptFiles(root),
      inputReceiptHashes: expectedInputHashes(),
      output: receiptPath,
    });
    const foreignReceipt = await readFile(receiptPath, "utf8");

    await expect(importResearchLock(root, handoffPath, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_RESEARCH_LOCK_EXISTS" });

    expect(await readFile(receiptPath, "utf8")).toBe(foreignReceipt);
  });

  it("rejects a valid research-lock receipt for different input bindings", async () => {
    const root = await createResearchProject(temporaryDirectories);
    const receiptPath = join(root, "receipts", "research-lock.json");
    const extra = join(root, "evidence", "research-lock", "extra.json");
    await writeFile(extra, "{}\n");
    await writeReceipt({
      stage: "EVIDENCE_LOCKED",
      files: [...expectedReceiptFiles(root), extra],
      inputReceiptHashes: expectedInputHashes(),
      output: receiptPath,
    });
    const differentReceipt = await readFile(receiptPath, "utf8");

    await expect(importResearchLock(root, handoffPath, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_RESEARCH_LOCK_EXISTS" });

    expect(await readFile(receiptPath, "utf8")).toBe(differentReceipt);
  });

  it("rejects duplicate artifact references even when the duplicated file hash matches", async () => {
    const root = await createResearchProject(temporaryDirectories);
    const handoff = JSON.parse(await readFile(handoffPath, "utf8")) as Record<string, unknown>;
    handoff.citationSlotMatrixPath = handoff.researchSpecificationPath;
    handoff.citationSlotMatrixSha256 = handoff.researchSpecificationSha256;
    const duplicateHandoffPath = join(root, "evidence", "research-lock", "duplicate-handoff.json");
    await writeFile(duplicateHandoffPath, `${JSON.stringify(handoff, null, 2)}\n`);

    await expect(importResearchLock(root, duplicateHandoffPath, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_RESEARCH_ARTIFACT_DUPLICATE" });
  });

  it("rejects all four artifact hash mismatches without writing a receipt", async () => {
    const hashFields = [
      "researchSpecificationSha256",
      "citationSlotMatrixSha256",
      "sourceLedgerSha256",
      "claimTransferLedgerSha256",
    ];

    for (const hashField of hashFields) {
      const root = await createResearchProject(temporaryDirectories);
      const handoff = JSON.parse(await readFile(handoffPath, "utf8")) as Record<string, unknown>;
      handoff[hashField] = "0".repeat(64);
      const mismatchHandoffPath = join(root, "evidence", "research-lock", `${hashField}.json`);
      await writeFile(mismatchHandoffPath, `${JSON.stringify(handoff, null, 2)}\n`);

      await expect(importResearchLock(root, mismatchHandoffPath, "0.1.72"))
        .rejects.toMatchObject({ code: "PP_RESEARCH_ARTIFACT_HASH" });
      await expect(readFile(join(root, "receipts", "research-lock.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects project identity, proposal class, version, absolute path, and traversal mismatches", async () => {
    const cases = [
      { patch: { projectId: "other" }, code: "PP_RESEARCH_PROJECT_MISMATCH" },
      { patch: { proposalClass: "policy_research" }, code: "PP_RESEARCH_PROJECT_MISMATCH" },
      { patch: { longtableVersion: "0.1.71" }, code: "PP_LONGTABLE_VERSION_MISMATCH" },
      { patch: { sourceLedgerPath: join(fixtureDirectory, "evidence", "research-lock", "source-ledger.json") }, code: "PP_RESEARCH_ARTIFACT_PATH" },
      { patch: { sourceLedgerPath: "evidence/research-lock/../source-ledger.json" }, code: "PP_RESEARCH_ARTIFACT_PATH" },
    ];

    for (const [index, testCase] of cases.entries()) {
      const root = await createResearchProject(temporaryDirectories);
      const handoff = {
        ...JSON.parse(await readFile(handoffPath, "utf8")) as Record<string, unknown>,
        ...testCase.patch,
      };
      const invalidHandoffPath = join(root, "evidence", "research-lock", `identity-${index}.json`);
      await writeFile(invalidHandoffPath, `${JSON.stringify(handoff, null, 2)}\n`);

      await expect(importResearchLock(root, invalidHandoffPath, "0.1.72"))
        .rejects.toMatchObject({ code: testCase.code });
    }

    const generalRoot = await createResearchProject(temporaryDirectories, "general_procurement");
    await expect(importResearchLock(generalRoot, handoffPath, "0.1.72"))
      .rejects.toMatchObject({ code: "PP_LONGTABLE_REQUIRED" });
  });

  it("cleans up a newly emitted receipt when post-write verification detects replaced artifact bytes", async () => {
    const root = await createResearchProject(temporaryDirectories);
    const sourceLedger = join(root, "evidence", "research-lock", "source-ledger.json");

    await expect(importResearchLock(root, handoffPath, "0.1.72", {
      afterArtifactsVerified: async () => {
        await writeFile(sourceLedger, "changed between verification and receipt write\n");
      },
    })).rejects.toMatchObject({ code: "PP_RESEARCH_LOCK_WRITE_MISMATCH" });

    await expect(readFile(join(root, "receipts", "research-lock.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function createResearchProject(
  temporaryDirectories: string[],
  proposalClass: "academic_research" | "research_service" | "policy_research" | "general_procurement" = "research_service",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-research-lock-"));
  temporaryDirectories.push(root);
  await initializeProject(root, {
    projectId: "research-lock-fixture",
    proposalClass,
  });
  await cp(join(fixtureDirectory, "evidence"), join(root, "evidence"), { recursive: true });
  return root;
}

function expectedReceiptFiles(root: string): string[] {
  return [
    handoffPath,
    join(root, "evidence", "research-lock", "citation-slot-matrix.json"),
    join(root, "evidence", "research-lock", "claim-transfer-ledger.json"),
    join(root, "evidence", "research-lock", "research-specification.json"),
    join(root, "evidence", "research-lock", "source-ledger.json"),
  ];
}

function expectedInputHashes(): string[] {
  return [
    "9247cacf92548fa6b25f469c221899da8cb51eab221bec47746cbab9177ed024",
    "db605b1ba19ab40c47f81b624a199471a2021e30d0098edaaa99468e71d754ee",
    "e28bd6b7a183bade21d9e18ce1d1fd2f4e7759974a46a4cb2135e7d1014d9d6e",
    "f10795ef239462d0cabd87a9e6b84e7a13156c86a346e09974e45c177609695e",
  ];
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
