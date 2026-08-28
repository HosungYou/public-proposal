import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProcessResult } from "./contracts.js";

export async function runProcess(
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options?.cwd,
      env: options?.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error: Error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function sha256File(path: string): Promise<string> {
  const contents = await readFile(path);
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

export async function writeFileWithMode(path: string, contents: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (mode !== undefined) {
    const handle = await open(path, "wx", mode);
    try {
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
    return;
  }
  await writeFile(path, contents, "utf8");
}

export const nodeFs = {
  copyDir: async (from: string, to: string) => {
    await cp(from, to, { recursive: true, force: false, errorOnExist: false });
  },
  exists: async (path: string) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  mkdir: async (path: string) => {
    await mkdir(path, { recursive: true });
  },
  listDir: async (path: string) => (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(),
  readFile: async (path: string) => readFile(path, "utf8"),
  realpath,
  remove: async (path: string) => {
    await rm(path, { recursive: true, force: true });
  },
  rename,
  sha256: sha256File,
  spawn: runProcess,
  writeFile: writeFileWithMode,
};
