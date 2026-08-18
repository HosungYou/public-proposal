import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const EXPECTED_WORKER_PROTOCOL = "1.0.0";
export const WORKER_PROTOCOL_PROBE = "from kpp_docx.protocol import PROTOCOL_VERSION; print(PROTOCOL_VERSION)";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export class ManagedWorkerError extends Error {
  readonly code: string;
  readonly actual: string | null;

  constructor(code: string, message: string, actual: string | null = null) {
    super(message);
    this.code = code;
    this.actual = actual;
    this.name = "ManagedWorkerError";
  }
}

export async function resolveManagedWorker(manifestPathInput?: string): Promise<string | null> {
  for (const path of candidateManifestPaths(manifestPathInput)) {
    const read = await readManifest(path);
    if (read.kind === "missing") continue;
    if (read.kind === "invalid") {
      throw new ManagedWorkerError("PP_WORKER_PROTOCOL_MISSING", "Managed worker receipt cannot be parsed.");
    }
    return verifyManifest(read.manifest);
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

type ManifestRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly manifest: Record<string, unknown> };

async function readManifest(path: string): Promise<ManifestRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { kind: "missing" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? { kind: "ok", manifest: parsed as Record<string, unknown> }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

async function verifyManifest(manifest: Record<string, unknown>): Promise<string> {
  const executable = validateManifest(manifest);
  if (executable === null) throw manifestError(manifest);
  const installRoot = resolve(manifest.installRoot as string);
  const workerRoot = join(installRoot, "worker");
  const [canonicalInstallRoot, canonicalWorkerRoot, canonicalExecutable] = await Promise.all([
    realpath(installRoot).catch(() => undefined),
    realpath(workerRoot).catch(() => undefined),
    realpath(executable).catch(() => undefined),
  ]);
  if (canonicalInstallRoot === undefined || canonicalWorkerRoot === undefined || canonicalExecutable === undefined) {
    throw new ManagedWorkerError("PP_WORKER_PROTOCOL_MISSING", "Managed worker executable is missing.");
  }
  if (canonicalWorkerRoot !== join(canonicalInstallRoot, "worker") || !isWithinOrEqual(canonicalWorkerRoot, canonicalExecutable)) {
    throw new ManagedWorkerError("PP_WORKER_INTEGRITY_FAILED", "Managed worker executable resolves outside the owned worker root.");
  }
  const expectedSha = (manifest.worker as Record<string, unknown>).sha256 as string;
  const actualSha = `sha256:${createHash("sha256").update(await readFile(canonicalExecutable)).digest("hex")}`;
  if (actualSha !== expectedSha) {
    throw new ManagedWorkerError("PP_WORKER_INTEGRITY_FAILED", "Managed worker executable hash does not match the receipt.");
  }
  return canonicalExecutable;
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
    !SHA256_PATTERN.test(workerRecord.sha256) ||
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

function manifestError(manifest: Record<string, unknown>): ManagedWorkerError {
  const workerProtocol = typeof manifest.workerProtocol === "string" ? manifest.workerProtocol : undefined;
  const worker = manifest.worker;
  const protocolVersion = worker !== null && typeof worker === "object" && !Array.isArray(worker)
    ? (worker as Record<string, unknown>).protocolVersion
    : undefined;
  if (
    (workerProtocol !== undefined && workerProtocol !== EXPECTED_WORKER_PROTOCOL) ||
    (typeof protocolVersion === "string" && protocolVersion !== EXPECTED_WORKER_PROTOCOL)
  ) {
    return new ManagedWorkerError(
      "PP_WORKER_PROTOCOL_MISMATCH",
      `Managed worker protocol ${EXPECTED_WORKER_PROTOCOL} is required.`,
      typeof protocolVersion === "string" ? protocolVersion : workerProtocol ?? null,
    );
  }
  return new ManagedWorkerError("PP_WORKER_PROTOCOL_MISSING", `Managed worker protocol ${EXPECTED_WORKER_PROTOCOL} is required.`);
}

function isWithinOrEqual(parent: string, child: string): boolean {
  const segment = relative(parent, child);
  return segment.length === 0 || (segment !== ".." && !segment.startsWith(`..${sep}`) && !isAbsolute(segment));
}
