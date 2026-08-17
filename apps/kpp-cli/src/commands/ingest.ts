import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  advanceProject,
  KppError,
  readProject,
  sha256File,
  writeReceipt,
} from "@kpp/core";
import { success, type CliEnvelope } from "../output.js";

const SourceManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  sources: z.array(z.object({
    sourceId: z.string().min(1),
    role: z.literal("rfp"),
    originalPath: z.string().min(1),
    copiedPath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
});

export async function ingestCommand(rootInput: string, rfpInput: string): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  const rfpPath = resolve(rfpInput);
  const project = await readProject(root);
  if (project.state !== "INIT") {
    throw new KppError("KPP_STATE_INVALID_TRANSITION", "소스는 INIT 상태에서만 잠글 수 있습니다.", {
      stage: project.state,
      expected: "INIT",
      actual: project.state,
    });
  }

  let metadata;
  try {
    metadata = await stat(rfpPath);
  } catch (error) {
    throw new KppError("KPP_INPUT_SOURCE_READ", "RFP 원본 파일을 읽을 수 없습니다.", {
      path: rfpPath,
      actual: error instanceof Error ? error.message : error,
    });
  }
  if (!metadata.isFile()) {
    throw new KppError("KPP_INPUT_SOURCE_INVALID", "RFP 입력은 파일이어야 합니다.", {
      path: rfpPath,
    });
  }

  const filename = basename(rfpPath);
  const copiedPath = join(root, "sources", filename);
  if (filename === "manifest.json" || copiedPath === rfpPath) {
    throw new KppError("KPP_INPUT_SOURCE_INVALID", "RFP 원본은 프로젝트 source 대상과 달라야 합니다.", {
      path: rfpPath,
    });
  }

  await copyFileAtomically(rfpPath, copiedPath);
  const manifestPath = join(root, "sources", "manifest.json");
  const manifest = SourceManifestSchema.parse({
    schemaVersion: "1.0.0",
    sources: [{
      sourceId: "SRC-001",
      role: "rfp",
      originalPath: rfpPath,
      copiedPath,
      sha256: await sha256File(copiedPath),
    }],
  });
  await writeJsonAtomically(manifestPath, manifest);

  await writeReceipt({
    stage: "SOURCE_LOCKED",
    files: [copiedPath, manifestPath],
    output: join(root, "receipts", "source-lock.json"),
  });
  const advanced = await advanceProject(root, "SOURCE_LOCKED");
  return success("RFP 원본 복사본과 manifest를 잠갔습니다.", {
    state: advanced.state,
    manifestPath,
    sourceCount: manifest.sources.length,
  });
}

export async function readJsonFile(path: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new KppError("KPP_INPUT_FILE_READ", "입력 JSON 파일을 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new KppError("KPP_INPUT_FILE_INVALID", "입력 파일이 올바른 JSON이 아닙니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

export async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let created = false;
  let renamed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    renamed = true;
    await syncDirectory(directory);
  } finally {
    if (created && !renamed) {
      await rm(temporaryPath, { force: true });
    }
  }
}

interface AtomicCopyHandle {
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicCopyOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  copyFile(source: string, destination: string): Promise<void>;
  open(path: string, flags: string): Promise<AtomicCopyHandle>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const DEFAULT_ATOMIC_COPY_OPERATIONS: AtomicCopyOperations = {
  mkdir: async (path, options) => mkdir(path, options),
  copyFile: async (source, destination) => copyFile(source, destination),
  open: async (path, flags) => open(path, flags),
  rename: async (source, destination) => rename(source, destination),
  rm: async (path, options) => rm(path, options),
};

export async function copyFileAtomically(
  source: string,
  destination: string,
  operations: AtomicCopyOperations = DEFAULT_ATOMIC_COPY_OPERATIONS,
): Promise<void> {
  const directory = dirname(destination);
  await operations.mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  let copied = false;
  let renamed = false;
  try {
    await operations.copyFile(source, temporaryPath);
    copied = true;
    const temporaryHandle = await operations.open(temporaryPath, "r");
    try {
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await operations.rename(temporaryPath, destination);
    renamed = true;
    const directoryHandle = await operations.open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    if (copied && !renamed) {
      await operations.rm(temporaryPath, { force: true });
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
