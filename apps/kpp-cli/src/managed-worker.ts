import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const EXPECTED_WORKER_PROTOCOL = "1.0.0";
export const WORKER_PROTOCOL_PROBE = "from kpp_docx.protocol import PROTOCOL_VERSION; print(PROTOCOL_VERSION)";

export async function resolveManagedWorker(manifestPathInput?: string): Promise<string | null> {
  for (const path of candidateManifestPaths(manifestPathInput)) {
    const manifest = await readManifest(path);
    const worker = validateManifest(manifest);
    if (worker !== null) return worker;
  }
  return null;
}

export function resolveExplicitWorker(input?: string): string | null {
  const worker = input ?? process.env.KPP_WORKER_PATH;
  return worker === undefined || worker.trim().length === 0 ? null : resolve(worker);
}

function candidateManifestPaths(input?: string): readonly string[] {
  if (input !== undefined) return [input];
  return [
    process.env.PUBLIC_PROPOSAL_INSTALLATION_MANIFEST,
    join(process.cwd(), ".public-proposal", "installation.json"),
    join(process.env.HOME ?? homedir(), ".config", "public-proposal", "installation.json"),
  ].filter((path): path is string => path !== undefined && path.length > 0);
}

async function readManifest(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function validateManifest(manifest: Record<string, unknown> | null): string | null {
  if (manifest === null || manifest.workerProtocol !== EXPECTED_WORKER_PROTOCOL) return null;
  const installRoot = typeof manifest.installRoot === "string" ? resolve(manifest.installRoot) : null;
  const worker = manifest.worker;
  const ownedPaths = Array.isArray(manifest.ownedPaths) ? manifest.ownedPaths : [];
  if (installRoot === null || manifest.installRoot !== installRoot || worker === null || typeof worker !== "object" || Array.isArray(worker)) {
    return null;
  }
  const workerRecord = worker as Record<string, unknown>;
  const executable = typeof workerRecord.executable === "string" ? workerRecord.executable : "";
  if (
    workerRecord.protocolVersion !== EXPECTED_WORKER_PROTOCOL ||
    typeof workerRecord.sha256 !== "string" ||
    !workerRecord.sha256.startsWith("sha256:") ||
    executable !== resolve(executable) ||
    !isAbsolute(executable) ||
    !isWithinOrEqual(join(installRoot, "worker"), executable)
  ) {
    return null;
  }
  const expectedOwned = new Set([
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "codex-skills"),
    join(installRoot, "worker"),
  ]);
  if (
    ownedPaths.length !== expectedOwned.size ||
    ownedPaths.some((path) => typeof path !== "string" || path !== resolve(path) || !expectedOwned.has(path))
  ) {
    return null;
  }
  return executable;
}

function isWithinOrEqual(parent: string, child: string): boolean {
  const segment = relative(parent, child);
  return segment.length === 0 || (segment !== ".." && !segment.startsWith(`..${sep}`) && !isAbsolute(segment));
}
