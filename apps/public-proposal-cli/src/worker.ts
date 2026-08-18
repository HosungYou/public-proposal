import { createHash } from "node:crypto";
import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INSTALL_MANIFEST_SCHEMA_VERSION,
  SUPPORTED_KPP_VERSION,
  SUPPORTED_LONGTABLE_VERSION,
  WORKER_PROTOCOL_VERSION,
  PublicProposalContractError,
  type ProcessRunner,
  type WorkerInstallation,
} from "./contracts.js";
import { manifestPath, manifestTempPath } from "./paths.js";

const PROTOCOL_PROBE = "from kpp_docx.protocol import PROTOCOL_VERSION; print(PROTOCOL_VERSION)";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface VerifiedManagedWorker extends WorkerInstallation {
  readonly executable: string;
}

export interface ManagedWorkerVerificationDependencies {
  readonly readFile?: (path: string) => Promise<string>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly sha256?: (path: string) => Promise<string>;
}

export interface ManagedWorkerInstallOptions {
  readonly updateManifest?: boolean;
}

export async function installManagedWorker(
  root: string,
  runner: ProcessRunner,
  options: ManagedWorkerInstallOptions = {},
): Promise<WorkerInstallation> {
  const installRoot = resolve(root);
  const workerRoot = join(installRoot, "worker");
  const source = join(workerRoot, "source");
  const bin = join(workerRoot, "bin");
  const executable = join(bin, "python");
  const packageWorker = join(defaultPackageRoot(), "worker");

  await verifyPackagedWorker(packageWorker);
  await rm(source, { recursive: true, force: true });
  await mkdir(workerRoot, { recursive: true });
  await cp(packageWorker, source, {
    recursive: true,
    force: false,
    filter: (path) => isAllowedWorkerSnapshotPath(packageWorker, path),
  });

  const uv = await runner("uv", ["sync", "--locked", "--no-dev"], {
    cwd: source,
    env: workerEnvironment(workerRoot),
  });
  if (uv.code !== 0) {
    throw new PublicProposalContractError("PP_WORKER_INSTALL_FAILED", uv.stderr || uv.stdout || "uv sync failed");
  }

  await mkdir(bin, { recursive: true });
  await writeFile(executable, workerWrapperScript(), { mode: 0o755 });
  await verifyWorkerProtocol(executable, runner);
  const installation = {
    executable,
    protocolVersion: WORKER_PROTOCOL_VERSION,
    sha256: await sha256Text(await readFile(executable)),
  } satisfies WorkerInstallation;
  if (options.updateManifest !== false) {
    await updateManifestIfPresent(installRoot, installation);
  }
  return installation;
}

export async function resolveManagedWorker(manifestPathInput?: string): Promise<string | null> {
  for (const candidate of candidateManifestPaths(manifestPathInput)) {
    const manifest = await readManifest(candidate);
    const worker = resolveManagedWorkerFromManifest(manifest, { verifyHashFormat: false });
    if (worker !== null) return worker;
  }
  return null;
}

export function resolveManagedWorkerFromManifestContents(contents: string): string | null {
  try {
    const parsed: unknown = JSON.parse(contents);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? resolveManagedWorkerFromManifest(parsed as Record<string, unknown>, { verifyHashFormat: false })
      : null;
  } catch {
    return null;
  }
}

export async function resolveVerifiedManagedWorker(
  manifestPathInput?: string,
  dependencies: ManagedWorkerVerificationDependencies = {},
): Promise<VerifiedManagedWorker | null> {
  const read = dependencies.readFile ?? ((path: string) => readFile(path, "utf8"));
  for (const candidate of candidateManifestPaths(manifestPathInput)) {
    const raw = await read(candidate).catch(() => undefined);
    if (raw === undefined) continue;
    return verifyManagedWorkerFromManifestContents(raw, dependencies);
  }
  return null;
}

export async function verifyManagedWorkerFromManifestContents(
  contents: string,
  dependencies: ManagedWorkerVerificationDependencies = {},
): Promise<VerifiedManagedWorker> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new PublicProposalContractError("PP_WORKER_PROTOCOL_MISSING", "Managed worker receipt cannot be parsed.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PublicProposalContractError("PP_WORKER_PROTOCOL_MISSING", "Managed worker receipt must be an object.");
  }
  const manifest = parsed as Record<string, unknown>;
  const executable = resolveManagedWorkerFromManifest(manifest, { verifyHashFormat: true });
  if (executable === null) {
    throw workerManifestError(manifest);
  }
  const worker = manifest.worker as Record<string, unknown>;
  const canonical = await canonicalManagedExecutable(manifest, executable, dependencies);
  const expectedSha = worker.sha256 as string;
  const actualSha = await (dependencies.sha256 ?? sha256File)(canonical);
  if (actualSha !== expectedSha) {
    throw new PublicProposalContractError("PP_WORKER_INTEGRITY_FAILED", "Managed worker executable hash does not match the receipt.");
  }
  return {
    executable: canonical,
    protocolVersion: WORKER_PROTOCOL_VERSION,
    sha256: expectedSha,
  };
}

export async function verifyWorkerProtocol(
  protocolOrExecutable: string,
  runner?: ProcessRunner,
): Promise<typeof WORKER_PROTOCOL_VERSION> {
  const protocol = runner === undefined
    ? protocolOrExecutable
    : await readWorkerProtocol(protocolOrExecutable, runner);
  if (protocol.length === 0) {
    throw new PublicProposalContractError("PP_WORKER_PROTOCOL_MISSING", `worker protocol ${WORKER_PROTOCOL_VERSION} is required.`);
  }
  if (protocol !== WORKER_PROTOCOL_VERSION) {
    throw new PublicProposalContractError(
      "PP_WORKER_PROTOCOL_MISMATCH",
      `worker protocol ${WORKER_PROTOCOL_VERSION} is required, got ${protocol}.`,
    );
  }
  return WORKER_PROTOCOL_VERSION;
}

function defaultPackageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

async function verifyPackagedWorker(root: string): Promise<void> {
  const [pyproject, lock] = await Promise.all([
    readFile(join(root, "pyproject.toml"), "utf8"),
    readFile(join(root, "uv.lock"), "utf8"),
  ]);
  if (!pyproject.includes("kpp-docx-worker") || lock.trim().length === 0) {
    throw new PublicProposalContractError("PP_WORKER_PACKAGE_INVALID", "Packaged worker must include pyproject.toml and uv.lock.");
  }
}

function isAllowedWorkerSnapshotPath(root: string, path: string): boolean {
  const segment = relative(root, path);
  return !segment.split(sep).some((part) =>
    part === ".venv" ||
    part === ".pytest_cache" ||
    part === "__pycache__" ||
    part.endsWith(".pyc") ||
    part === ".DS_Store"
  );
}

function workerEnvironment(workerRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    UV_PROJECT_ENVIRONMENT: join(workerRoot, ".venv"),
    UV_CACHE_DIR: join(workerRoot, ".uv-cache"),
    UV_PYTHON_INSTALL_DIR: join(workerRoot, ".uv-python"),
  };
}

function workerWrapperScript(): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "WORKER_ROOT=$(CDPATH= cd -- \"$(dirname -- \"$0\")/..\" && pwd)",
    "export PYTHONPATH=\"$WORKER_ROOT/source/src${PYTHONPATH:+:$PYTHONPATH}\"",
    "exec \"$WORKER_ROOT/.venv/bin/python\" \"$@\"",
    "",
  ].join("\n");
}

async function readWorkerProtocol(executable: string, runner: ProcessRunner): Promise<string> {
  const workerRoot = dirname(dirname(executable));
  const result = await runner(executable, ["-c", PROTOCOL_PROBE], {
    cwd: join(workerRoot, "source"),
    env: workerEnvironment(workerRoot),
  });
  if (result.code !== 0) return "";
  return `${result.stdout}${result.stderr}`.trim();
}

async function sha256Text(contents: Buffer): Promise<string> {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

async function sha256File(path: string): Promise<string> {
  return sha256Text(await readFile(path));
}

async function updateManifestIfPresent(root: string, worker: WorkerInstallation): Promise<void> {
  const path = manifestPath(root);
  const raw = await readFile(path, "utf8").catch(() => undefined);
  if (raw === undefined) return;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.worker = worker;
  const temp = manifestTempPath(root);
  await writeFile(temp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

function candidateManifestPaths(input?: string): readonly string[] {
  if (input !== undefined) return [input];
  const candidates = [
    process.env.PUBLIC_PROPOSAL_INSTALLATION_MANIFEST,
    manifestPath(join(process.cwd(), ".public-proposal")),
  ];
  const home = process.env.HOME;
  if (home !== undefined) candidates.push(manifestPath(join(home, ".config", "public-proposal")));
  return candidates.filter((path): path is string => path !== undefined && path.length > 0);
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

function resolveManagedWorkerFromManifest(
  manifest: Record<string, unknown> | null,
  options: { verifyHashFormat: boolean },
): string | null {
  if (manifest === null) return null;
  if (
    manifest.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION ||
    manifest.kppVersion !== SUPPORTED_KPP_VERSION ||
    manifest.longtableVersion !== SUPPORTED_LONGTABLE_VERSION ||
    manifest.workerProtocol !== WORKER_PROTOCOL_VERSION
  ) {
    return null;
  }
  const installRoot = typeof manifest.installRoot === "string" ? resolve(manifest.installRoot) : null;
  const worker = manifest.worker;
  const ownedPaths = Array.isArray(manifest.ownedPaths) ? manifest.ownedPaths : [];
  if (installRoot === null || manifest.installRoot !== installRoot || worker === null || typeof worker !== "object" || Array.isArray(worker)) {
    return null;
  }
  const workerRecord = worker as Record<string, unknown>;
  const executable = typeof workerRecord.executable === "string" ? workerRecord.executable : "";
  if (
    workerRecord.protocolVersion !== WORKER_PROTOCOL_VERSION ||
    typeof workerRecord.sha256 !== "string" ||
    (options.verifyHashFormat ? !SHA256_PATTERN.test(workerRecord.sha256) : !workerRecord.sha256.startsWith("sha256:")) ||
    executable !== resolve(executable) ||
    !isAbsolute(executable) ||
    !isWithinOrEqual(join(installRoot, "worker"), executable)
  ) {
    return null;
  }
  const expectedOwned = new Set([
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
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

function workerManifestError(manifest: Record<string, unknown>): PublicProposalContractError {
  const workerProtocol = typeof manifest.workerProtocol === "string" ? manifest.workerProtocol : undefined;
  const worker = manifest.worker;
  const protocolVersion = worker !== null && typeof worker === "object" && !Array.isArray(worker)
    ? (worker as Record<string, unknown>).protocolVersion
    : undefined;
  if (
    (workerProtocol !== undefined && workerProtocol !== WORKER_PROTOCOL_VERSION) ||
    (protocolVersion !== undefined && protocolVersion !== WORKER_PROTOCOL_VERSION)
  ) {
    return new PublicProposalContractError(
      "PP_WORKER_PROTOCOL_MISMATCH",
      `worker protocol ${WORKER_PROTOCOL_VERSION} is required.`,
    );
  }
  return new PublicProposalContractError("PP_WORKER_PROTOCOL_MISSING", `worker protocol ${WORKER_PROTOCOL_VERSION} is required.`);
}

async function canonicalManagedExecutable(
  manifest: Record<string, unknown>,
  executable: string,
  dependencies: ManagedWorkerVerificationDependencies,
): Promise<string> {
  const resolvePath = dependencies.realpath ?? realpath;
  const installRoot = resolve(manifest.installRoot as string);
  const workerRoot = join(installRoot, "worker");
  const [canonicalInstallRoot, canonicalWorkerRoot, canonicalExecutable] = await Promise.all([
    resolvePath(installRoot).catch(() => undefined),
    resolvePath(workerRoot).catch(() => undefined),
    resolvePath(executable).catch(() => undefined),
  ]);
  if (canonicalInstallRoot === undefined || canonicalWorkerRoot === undefined || canonicalExecutable === undefined) {
    throw new PublicProposalContractError("PP_WORKER_PROTOCOL_MISSING", "Managed worker executable is missing.");
  }
  const expectedWorkerRoot = join(canonicalInstallRoot, "worker");
  if (canonicalWorkerRoot !== expectedWorkerRoot || !isWithinOrEqual(canonicalWorkerRoot, canonicalExecutable)) {
    throw new PublicProposalContractError("PP_WORKER_INTEGRITY_FAILED", "Managed worker executable resolves outside the owned worker root.");
  }
  return canonicalExecutable;
}

function isWithinOrEqual(parent: string, child: string): boolean {
  const segment = relative(parent, child);
  return segment.length === 0 || (segment !== ".." && !segment.startsWith(`..${sep}`) && !isAbsolute(segment));
}
