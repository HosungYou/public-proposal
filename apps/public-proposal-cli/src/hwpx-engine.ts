import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ProcessRunner } from "./contracts.js";

export const HWPX_ENGINE_REPOSITORY = "https://github.com/jkf87/hwpx-skill.git";
export const HWPX_ENGINE_COMMIT = "96a2633f23a08f707679d7e212ebdc59948260e6";

export interface HwpxEngineFile {
  readonly source: string;
  readonly destination: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface HwpxEngineManifest {
  readonly schemaVersion: "1.0.0";
  readonly repository: typeof HWPX_ENGINE_REPOSITORY;
  readonly commit: typeof HWPX_ENGINE_COMMIT;
  readonly destinationRoot: "vendor/hwpx-skill";
  readonly distributionMode: "fetched-from-upstream-not-redistributed";
  readonly licenseStatus: "no-root-license-file-in-pinned-tree";
  readonly files: readonly HwpxEngineFile[];
}

export interface HwpxEngineInstallation {
  readonly commit: typeof HWPX_ENGINE_COMMIT;
  readonly root: string;
  readonly verified: true;
  readonly fileCount: number;
}

export function parseHwpxEngineManifest(raw: string): HwpxEngineManifest {
  const parsed = JSON.parse(raw) as Partial<HwpxEngineManifest>;
  if (
    parsed.schemaVersion !== "1.0.0"
    || parsed.repository !== HWPX_ENGINE_REPOSITORY
    || parsed.commit !== HWPX_ENGINE_COMMIT
    || parsed.destinationRoot !== "vendor/hwpx-skill"
    || parsed.distributionMode !== "fetched-from-upstream-not-redistributed"
    || parsed.licenseStatus !== "no-root-license-file-in-pinned-tree"
    || !Array.isArray(parsed.files)
    || parsed.files.length === 0
  ) throw new Error("PP_HWPX_ENGINE_MANIFEST_INVALID");

  const seenSources = new Set<string>();
  const seenDestinations = new Set<string>();
  for (const file of parsed.files) {
    if (
      !file
      || !safeRelative(file.source)
      || !safeRelative(file.destination)
      || file.destination === "SKILL.md"
      || file.destination.endsWith("/SKILL.md")
      || !Number.isInteger(file.bytes)
      || file.bytes < 0
      || !/^[a-f0-9]{64}$/u.test(file.sha256)
      || seenSources.has(file.source)
      || seenDestinations.has(file.destination)
    ) throw new Error("PP_HWPX_ENGINE_MANIFEST_INVALID");
    seenSources.add(file.source);
    seenDestinations.add(file.destination);
  }
  if (!parsed.files.some((file) => file.source === "SKILL.md" && file.destination === "UPSTREAM-SKILL.md")) {
    throw new Error("PP_HWPX_ENGINE_MANIFEST_INVALID");
  }
  return parsed as HwpxEngineManifest;
}

export async function installPinnedHwpxEngine(skillRoot: string, spawn: ProcessRunner): Promise<HwpxEngineInstallation> {
  const manifest = parseHwpxEngineManifest(await readFile(join(skillRoot, "HWPX-ENGINE.json"), "utf8"));
  const temporaryRoot = await mkdtemp(join(skillRoot, ".hwpx-fetch-"));
  const checkoutRoot = join(temporaryRoot, "checkout");
  const engineRoot = checkedDescendant(skillRoot, manifest.destinationRoot);
  try {
    await required(spawn, "git", ["clone", "--quiet", "--no-checkout", "--filter=blob:none", manifest.repository, checkoutRoot]);
    await required(spawn, "git", ["-C", checkoutRoot, "checkout", "--quiet", "--detach", manifest.commit]);
    const head = await required(spawn, "git", ["-C", checkoutRoot, "rev-parse", "HEAD"]);
    if (head.stdout.trim() !== manifest.commit) throw new Error("PP_HWPX_ENGINE_COMMIT_MISMATCH");

    await rm(engineRoot, { force: true, recursive: true });
    for (const file of manifest.files) {
      const source = checkedDescendant(checkoutRoot, file.source);
      const destination = checkedDescendant(engineRoot, file.destination);
      const stats = await lstat(source);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`PP_HWPX_ENGINE_FILE_INVALID:${file.source}`);
      const payload = await readFile(source);
      if (payload.byteLength !== file.bytes || digest(payload) !== file.sha256) {
        throw new Error(`PP_HWPX_ENGINE_HASH_MISMATCH:${file.source}`);
      }
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    await writeFile(join(engineRoot, "INSTALLATION.json"), `${JSON.stringify({
      schemaVersion: "1.0.0",
      repository: manifest.repository,
      commit: manifest.commit,
      verified: true,
      fileCount: manifest.files.length,
    }, null, 2)}\n`, "utf8");
    return { commit: manifest.commit, root: engineRoot, verified: true, fileCount: manifest.files.length };
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

export async function verifyInstalledHwpxEngine(skillRoot: string): Promise<HwpxEngineInstallation> {
  const manifest = parseHwpxEngineManifest(await readFile(join(skillRoot, "HWPX-ENGINE.json"), "utf8"));
  const engineRoot = checkedDescendant(skillRoot, manifest.destinationRoot);
  for (const file of manifest.files) {
    const destination = checkedDescendant(engineRoot, file.destination);
    const stats = await lstat(destination);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`PP_HWPX_ENGINE_FILE_INVALID:${file.destination}`);
    const payload = await readFile(destination);
    if (payload.byteLength !== file.bytes || digest(payload) !== file.sha256) {
      throw new Error(`PP_HWPX_ENGINE_HASH_MISMATCH:${file.destination}`);
    }
  }
  return { commit: manifest.commit, root: engineRoot, verified: true, fileCount: manifest.files.length };
}

function checkedDescendant(root: string, child: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...child.split("/"));
  const rel = relative(resolvedRoot, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error("PP_HWPX_ENGINE_PATH_REJECTED");
  return target;
}

function safeRelative(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path)) return false;
  return path.split(/[\\/]/u).every((part) => part.length > 0 && part !== "." && part !== "..");
}

function digest(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

async function required(spawn: ProcessRunner, command: string, args: readonly string[]) {
  const result = await spawn(command, args);
  if (result.code !== 0) throw new Error(`PP_HWPX_ENGINE_FETCH_FAILED:${command} ${args.join(" ")}:${result.stderr.trim()}`);
  return result;
}
