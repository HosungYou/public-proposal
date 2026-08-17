import { describe, expect, it, vi } from "vitest";
import { copyFileAtomically, type AtomicCopyOperations } from "../src/commands/ingest.js";

describe("atomic source copy", () => {
  it("fsyncs copied bytes before rename and then fsyncs the directory", async () => {
    const events: string[] = [];
    const operations: AtomicCopyOperations = {
      mkdir: vi.fn(async () => undefined),
      copyFile: vi.fn(async () => { events.push("copy"); }),
      open: vi.fn(async (path: string) => ({
        sync: async () => { events.push(path.endsWith(".tmp") ? "file-sync" : "directory-sync"); },
        close: async () => undefined,
      })),
      rename: vi.fn(async () => { events.push("rename"); }),
      rm: vi.fn(async () => undefined),
    };

    await copyFileAtomically("/input/rfp.txt", "/project/sources/rfp.txt", operations);

    expect(events).toEqual(["copy", "file-sync", "rename", "directory-sync"]);
    expect(operations.rm).not.toHaveBeenCalled();
  });

  it("removes the unique temporary copy when its file fsync fails", async () => {
    const removed: string[] = [];
    const operations: AtomicCopyOperations = {
      mkdir: vi.fn(async () => undefined),
      copyFile: vi.fn(async () => undefined),
      open: vi.fn(async (path: string) => ({
        sync: async () => {
          if (path.endsWith(".tmp")) {
            throw new Error("simulated fsync failure");
          }
        },
        close: async () => undefined,
      })),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async (path: string) => { removed.push(path); }),
    };

    await expect(
      copyFileAtomically("/input/rfp.txt", "/project/sources/rfp.txt", operations),
    ).rejects.toThrow("simulated fsync failure");

    expect(operations.rename).not.toHaveBeenCalled();
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^\/project\/sources\/\.rfp\.txt\.\d+\..+\.tmp$/);
  });
});
