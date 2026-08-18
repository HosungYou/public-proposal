import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { sha256File } from "../src/hash.js";
import { verifyReceipt, writeReceipt } from "../src/receipts.js";

let setReceiptLockTestHooks: (hooks: Record<string, unknown>) => void;

describe("receipts", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    const lockModule = await import("../src/receipt-lock.js") as unknown as {
      __setReceiptLockTestHooks: (hooks: Record<string, unknown>) => void;
    };
    setReceiptLockTestHooks = lockModule.__setReceiptLockTestHooks;
  });

  afterEach(async () => {
    setReceiptLockTestHooks({});
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

  it("recovers an orphaned receipt lock whose owner process is dead", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);

    await writeFile(input, "alpha");
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({
      pid: 999999,
      token: "orphaned",
      createdAt: "2026-08-18T00:00:00.000Z",
    })}\n`);

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receiptPath,
    })).resolves.toMatchObject({ stage: "SOURCE_LOCKED" });

    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await verifyReceipt(receiptPath)).valid).toBe(true);
  });

  it("cleans up a newly-created lock when owner metadata write fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);
    await writeFile(input, "alpha");
    setReceiptLockTestHooks({
      failAfterLockDirectoryCreated: true,
    });

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receiptPath,
    })).rejects.toMatchObject({ code: "KPP_RECEIPT_LOCK_SETUP" });

    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(receiptPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans up a newly-created lock when owner metadata sync fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);
    await writeFile(input, "alpha");
    setReceiptLockTestHooks({
      failAfterOwnerMetadataWritten: true,
    });

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receiptPath,
    })).rejects.toMatchObject({ code: "KPP_RECEIPT_LOCK_SETUP" });

    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(receiptPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a stable lock timeout error for a live owner lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);

    await writeFile(input, "alpha");
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({
      pid: process.pid,
      token: "live-owner",
      createdAt: new Date().toISOString(),
    })}\n`);
    setReceiptLockTestHooks({
      lockAttempts: 2,
      lockRetryMs: 0,
    });

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receiptPath,
    })).rejects.toMatchObject({ code: "KPP_RECEIPT_LOCK_TIMEOUT" });

    await expect(stat(lockPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("does not recover a malformed receipt lock owner as stale", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);

    await writeFile(input, "alpha");
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({
      pid: -1,
      token: "malformed-owner",
      createdAt: new Date().toISOString(),
    })}\n`);
    setReceiptLockTestHooks({
      lockAttempts: 2,
      lockRetryMs: 0,
    });

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receiptPath,
    })).rejects.toMatchObject({ code: "KPP_RECEIPT_LOCK_TIMEOUT" });

    await expect(readFile(join(lockPath, "owner.json"), "utf8")).resolves.toContain("malformed-owner");
  });

  it("does not recover a fresh ownerless receipt lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);

    await writeFile(input, "alpha");
    await mkdir(lockPath, { recursive: true });
    setReceiptLockTestHooks({
      lockAttempts: 2,
      lockRetryMs: 0,
      orphanGraceMs: 60_000,
    });

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receiptPath,
    })).rejects.toMatchObject({ code: "KPP_RECEIPT_LOCK_TIMEOUT" });

    await expect(stat(lockPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(readFile(receiptPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers an aged ownerless receipt lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);
    const oldTime = new Date(Date.now() - 120_000);

    await writeFile(input, "alpha");
    await mkdir(lockPath, { recursive: true });
    await utimes(lockPath, oldTime, oldTime);
    setReceiptLockTestHooks({
      orphanGraceMs: 1_000,
    });

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receiptPath,
    })).resolves.toMatchObject({ stage: "SOURCE_LOCKED" });

    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await verifyReceipt(receiptPath)).valid).toBe(true);
  });

  it("recovers an aged malformed receipt lock owner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);
    const oldTime = new Date(Date.now() - 120_000);

    await writeFile(input, "alpha");
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), "{not-json");
    await utimes(lockPath, oldTime, oldTime);
    setReceiptLockTestHooks({
      orphanGraceMs: 1_000,
    });

    await expect(writeReceipt({
      stage: "SOURCE_LOCKED",
      files: [input],
      output: receiptPath,
    })).resolves.toMatchObject({ stage: "SOURCE_LOCKED" });

    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await verifyReceipt(receiptPath)).valid).toBe(true);
  });

  it("does not let concurrent stale-lock recovery remove a later live lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kpp-receipt-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "source.txt");
    const receiptPath = join(directory, "receipts", "source-lock.json");
    const lockPath = join(directory, "receipts", `.${basename(receiptPath)}.lock`);
    let observedRecoverable = 0;
    let quarantined = 0;

    await writeFile(input, "alpha");
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({
      pid: 999999,
      token: "dead-owner",
      createdAt: "2026-08-18T00:00:00.000Z",
    })}\n`);
    setReceiptLockTestHooks({
      lockAttempts: 2,
      lockRetryMs: 0,
      afterRecoverableLockObserved: async () => {
        observedRecoverable += 1;
      },
      afterStaleLockQuarantined: async () => {
        quarantined += 1;
        await mkdir(lockPath, { recursive: true });
        await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({
          pid: process.pid,
          token: "late-live-owner",
          createdAt: new Date().toISOString(),
        })}\n`, { flag: "wx" });
      },
    });

    const results = await Promise.allSettled([
      writeReceipt({
        stage: "SOURCE_LOCKED",
        files: [input],
        output: receiptPath,
      }),
      writeReceipt({
        stage: "SOURCE_LOCKED",
        files: [input],
        output: receiptPath,
      }),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ status: "rejected" }),
      expect.objectContaining({ status: "rejected" }),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({
        reason: expect.objectContaining({ code: "KPP_RECEIPT_LOCK_TIMEOUT" }),
      });
    }
    expect(observedRecoverable).toBeGreaterThanOrEqual(1);
    expect(quarantined).toBe(1);
    await expect(readFile(join(lockPath, "owner.json"), "utf8")).resolves.toContain("late-live-owner");
    await expect(readFile(receiptPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
