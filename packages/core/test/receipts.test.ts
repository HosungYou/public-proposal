import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256File } from "../src/hash.js";
import { verifyReceipt, writeReceipt } from "../src/receipts.js";

describe("receipts", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it("hashes file bytes with SHA-256", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");

    await writeFile(input, "alpha");

    expect(await sha256File(input)).toBe(
      "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
    );
  });

  it("invalidates a receipt when a bound file changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receipt = join(directory, "receipts", "source-lock.json");

    await writeFile(input, "alpha");
    await writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receipt,
    });
    await writeFile(input, "beta");

    expect((await verifyReceipt(receipt)).valid).toBe(false);
  });

  it("writes sorted file records and supplied input receipt hashes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const firstFile = join(directory, "a.txt");
    const secondFile = join(directory, "b.txt");
    const receiptPath = join(directory, "receipts", "evidence-lock.json");
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);

    await writeFile(firstFile, "first");
    await writeFile(secondFile, "second");
    const receipt = await writeReceipt({
      stage: "EVIDENCE_LOCKED",
      files: [secondFile, firstFile],
      inputReceiptHashes: [secondHash, firstHash],
      output: receiptPath,
    });

    expect(receipt.files).toEqual([
      {
        path: firstFile,
        sha256: "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e",
      },
      {
        path: secondFile,
        sha256: "16367aacb67a4a017c8da8ab95682ccb390863780f7114dda0a0e0c55644c7c4",
      },
    ]);
    expect(receipt.inputReceiptHashes).toEqual([firstHash, secondHash]);
    expect(receipt.result).toBe("PASS");
    expect(receipt.schemaVersion).toBe("1.0.0");
    expect(receipt.toolVersion).toBe("0.1.0");
    expect(JSON.parse(await readFile(receiptPath, "utf8"))).toEqual(receipt);
  });

  it("allows concurrent writes to the same receipt path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");

    await writeFile(input, "alpha");

    const receipts = await Promise.all(
      Array.from({ length: 16 }, () => writeReceipt({
        stage: "SOURCE_LOCKED",
        files: [input],
        output: receiptPath,
      })),
    );

    expect(receipts).toHaveLength(16);
    expect((await verifyReceipt(receiptPath)).valid).toBe(true);
  });

  it("removes its temporary file when the final rename fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const outputDirectory = join(directory, "receipt-target");

    await writeFile(input, "alpha");
    // Reserve the output path as a directory so the final rename fails.
    await mkdir(outputDirectory);

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: outputDirectory,
    })).rejects.toThrow();

    expect((await readdir(directory)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });
});
