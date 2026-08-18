import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  INSTALL_MANIFEST_SCHEMA_VERSION,
  SUPPORTED_KPP_VERSION,
  SUPPORTED_LONGTABLE_VERSION,
  WORKER_PROTOCOL_VERSION,
  type DoctorCheck,
  type InstallManifest,
  type ProcessRunner,
  type SetupOptions,
  type SetupResult,
} from "../contracts.js";
import { readManifestJson, serializeManifest } from "../installation-manifest.js";
import { manifestPath, manifestTempPath, installationRoot } from "../paths.js";
import { nodeFs } from "../process.js";
import { runDoctor } from "./doctor.js";

export interface SetupDependencies {
  readonly packageRoot?: string;
  readonly spawn: ProcessRunner;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, contents: string, mode?: number) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly sha256: (path: string) => Promise<string>;
  readonly now: () => string;
  readonly exists?: (path: string) => Promise<boolean>;
  readonly copyDir?: (from: string, to: string) => Promise<void>;
  readonly remove?: (path: string) => Promise<void>;
}

const PLAN = [
  "public-proposal plugin",
  "@longtable/kpp-cli@0.2.1",
  "@longtable/cli@0.1.72",
  "managed worker protocol 1.0.0",
];

export async function runSetup(
  options: SetupOptions,
  dependencies: SetupDependencies = defaultSetupDependencies(),
): Promise<SetupResult> {
  const packageRoot = dependencies.packageRoot ?? defaultPackageRoot();
  const installRoot = options.installRoot ?? installationRoot(
    options.installScope ?? "user",
    options.cwd ?? process.cwd(),
    options.home ?? process.env.HOME ?? process.cwd(),
  );
  const manifest = manifestPath(installRoot);
  const exists = dependencies.exists ?? defaultExists(dependencies);
  const copyDir = dependencies.copyDir ?? nodeFs.copyDir;
  const remove = dependencies.remove ?? nodeFs.remove;

  if (options.dryRun) {
    return { ok: true, plan: PLAN, writes: [], checks: [] };
  }

  const existingManifest = await readExistingManifest(dependencies, manifest);
  if (existingManifest) {
    const existingValidation = await validateExistingManifest(existingManifest, installRoot, exists);
    if (existingValidation) {
      return failed(existingValidation.code, existingValidation.message, []);
    }
    return {
      ok: true,
      plan: PLAN,
      writes: [],
      manifestPath: manifest,
      checks: [],
      manifest: existingManifest,
    };
  }

  const conflict = await findConflict(installRoot, exists);
  if (conflict) {
    const code = conflict.includes("/marketplace") ? "PP_MARKETPLACE_CONFLICT" : "PP_INSTALL_TARGET_CONFLICT";
    return failed(code, `Existing path is not owned by Public Proposal: ${conflict}`, []);
  }

  const integrity = await packageIntegrity(packageRoot, dependencies);
  if (integrity.status !== "pass") {
    return { ok: false, plan: PLAN, writes: [], checks: [integrity], error: { code: integrity.code ?? "PP_PLUGIN_INTEGRITY_FAILED", message: integrity.message } };
  }

  const preflight = await preflightChecks(dependencies.spawn);
  const blocker = preflight.find((check) => check.status === "blocker");
  if (blocker) {
    return { ok: false, plan: PLAN, writes: [], checks: preflight, error: { code: blocker.code ?? "PP_PREFLIGHT_BLOCKED", message: blocker.message } };
  }

  const writes: string[] = [];
  const ownedPaths = [
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "codex-skills"),
  ];

  try {
    await dependencies.mkdir(installRoot);
    await copyDir(join(packageRoot, "plugin"), ownedPaths[0]);
    writes.push(ownedPaths[0]);
    await mirrorPackagedFile(
      join(packageRoot, "plugin", ".codex-plugin", "plugin.json"),
      join(ownedPaths[0], ".codex-plugin", "plugin.json"),
      dependencies,
    );
    await mirrorPackagedFile(
      join(packageRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json"),
      join(ownedPaths[0], "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json"),
      dependencies,
    );
    await copyDir(join(packageRoot, "marketplace"), ownedPaths[1]);
    writes.push(ownedPaths[1]);
    await mirrorPackagedFile(
      join(packageRoot, "marketplace", "marketplace.json"),
      join(ownedPaths[1], "marketplace.json"),
      dependencies,
    );
    await dependencies.mkdir(ownedPaths[2]);
    writes.push(ownedPaths[2]);

    await runRequired(dependencies.spawn, "longtable", [
      "codex",
      "install-skills",
      "--surface",
      "compact",
      "--dir",
      ownedPaths[2],
    ]);
    await ensureMarketplaceRegistered(dependencies.spawn, join(installRoot, "marketplace"));
    await ensurePluginInstalled(dependencies.spawn);

    const installManifest = await buildManifest(installRoot, ownedPaths, dependencies);
    const manifestContents = serializeManifest(installManifest);
    const doctor = await runDoctor(
      {
        installRoot,
        expectedKppVersion: SUPPORTED_KPP_VERSION,
        expectedLongtableVersion: SUPPORTED_LONGTABLE_VERSION,
        expectedWorkerProtocol: WORKER_PROTOCOL_VERSION,
      },
      {
        packageRoot,
        spawn: dependencies.spawn,
        readFile: async (path) => (path === manifest ? manifestContents : dependencies.readFile(path)),
        exists,
        sha256: dependencies.sha256,
      },
    );
    if (!doctor.ok) {
      const failedCheck = doctor.checks.find((check) => check.status === "blocker") ?? doctor.checks[0];
      throw new SetupCommandError(failedCheck.code ?? "PP_DOCTOR_BLOCKED", failedCheck.message);
    }

    const tempManifest = manifestTempPath(installRoot);
    await dependencies.writeFile(tempManifest, manifestContents, 0o600);
    writes.push(tempManifest);
    await dependencies.rename(tempManifest, manifest);
    return {
      ok: true,
      plan: PLAN,
      writes: [...writes.filter((path) => path !== tempManifest), manifest],
      manifestPath: manifest,
      checks: doctor.checks,
      manifest: installManifest,
    };
  } catch (error) {
    await Promise.all([...ownedPaths].reverse().map((path) => remove(path)));
    const code = error instanceof SetupCommandError ? error.code : "PP_SETUP_COMMAND_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    return failed(code, message, writes);
  }
}

function defaultPackageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

export function defaultSetupDependencies(): SetupDependencies {
  return {
    ...nodeFs,
    packageRoot: defaultPackageRoot(),
    now: () => new Date().toISOString(),
  };
}

function defaultExists(dependencies: Pick<SetupDependencies, "readFile">): (path: string) => Promise<boolean> {
  return async (path: string) => {
    try {
      await dependencies.readFile(path);
      return true;
    } catch {
      return false;
    }
  };
}

async function readExistingManifest(
  dependencies: Pick<SetupDependencies, "readFile">,
  path: string,
): Promise<InstallManifest | null> {
  try {
    return readManifestJson(await dependencies.readFile(path));
  } catch {
    return null;
  }
}

async function findConflict(installRoot: string, exists: (path: string) => Promise<boolean>): Promise<string | null> {
  for (const path of [
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "codex-skills"),
    join(installRoot, "worker"),
  ]) {
    if (await exists(path)) {
      return path;
    }
  }
  return null;
}

async function validateExistingManifest(
  existingManifest: InstallManifest,
  installRoot: string,
  exists: (path: string) => Promise<boolean>,
): Promise<{ code: string; message: string } | null> {
  if (existingManifest.installRoot !== installRoot) {
    return {
      code: "PP_INSTALL_MANIFEST_MISMATCH",
      message: `Existing installation receipt belongs to ${existingManifest.installRoot}, not ${installRoot}.`,
    };
  }
  for (const ownedPath of existingManifest.ownedPaths) {
    if (!(await exists(ownedPath))) {
      return {
        code: "PP_INSTALL_MANIFEST_STALE",
        message: `Existing installation receipt references missing path: ${ownedPath}`,
      };
    }
  }
  return null;
}

async function packageIntegrity(packageRoot: string, dependencies: SetupDependencies): Promise<DoctorCheck> {
  const pluginManifestPath = join(packageRoot, "plugin", ".codex-plugin", "plugin.json");
  const marketplacePath = join(packageRoot, "marketplace", "marketplace.json");
  const bundleManifestPath = join(packageRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  try {
    const [pluginRaw, marketplaceRaw, bundleRaw] = await Promise.all([
      dependencies.readFile(pluginManifestPath),
      dependencies.readFile(marketplacePath),
      dependencies.readFile(bundleManifestPath),
    ]);
    const plugin = JSON.parse(pluginRaw) as { name?: string };
    const marketplace = JSON.parse(marketplaceRaw) as {
      plugins?: Array<{ name?: string; source?: { path?: string } }>;
    };
    JSON.parse(bundleRaw);
    const entry = marketplace.plugins?.find((pluginEntry) => pluginEntry.name === "public-proposal");
    if (plugin.name !== "public-proposal" || entry?.source?.path !== "../plugin") {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
        detected: { pluginName: plugin.name, marketplaceSource: entry?.source?.path },
        message: "Packaged plugin and marketplace entry must reference public-proposal via ../plugin.",
      };
    }
    return {
      name: "plugin",
      status: "pass",
      detected: { pluginName: plugin.name, marketplaceSource: entry.source.path },
      message: "Packaged plugin and marketplace entry are valid.",
    };
  } catch (error) {
    return {
      name: "plugin",
      status: "blocker",
      code: "PP_PLUGIN_INTEGRITY_FAILED",
      detected: error instanceof Error ? error.message : String(error),
      message: "Packaged plugin or marketplace entry cannot be read.",
    };
  }
}

async function preflightChecks(spawn: ProcessRunner): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(await requireCommand(spawn, "node", ["--version"], "node"));
  checks.push(await requireCommand(spawn, "npm", ["--version"], "npm"));
  checks.push(await requireCommand(spawn, "codex", ["--version"], "codex"));
  checks.push(await requireCommand(spawn, "python3", ["--version"], "python"));
  checks.push(await requireCommand(spawn, "soffice", ["--version"], "libreoffice"));
  checks.push(await requireCommand(spawn, "fc-match", ["NotoSansCJKkr-Regular"], "fonts"));
  checks.push(await exactVersion(spawn, "kpp", ["--version"], "kpp", SUPPORTED_KPP_VERSION, "PP_KPP_VERSION_MISMATCH"));
  checks.push(
    await exactVersion(
      spawn,
      "longtable",
      ["--version"],
      "longtable",
      SUPPORTED_LONGTABLE_VERSION,
      "PP_LONGTABLE_VERSION_MISMATCH",
    ),
  );
  checks.push(await requireCommand(spawn, "longtable", ["scholar-research", "doctor", "--json"], "scholarResearch"));
  checks.push(await workerProtocolCheck(spawn));
  return checks;
}

async function requireCommand(
  spawn: ProcessRunner,
  command: string,
  args: readonly string[],
  name: DoctorCheck["name"],
): Promise<DoctorCheck> {
  const result = await spawn(command, args);
  if (result.code !== 0) {
    return {
      name,
      status: "blocker",
      detected: result.stderr || null,
      message: `${command} is required.`,
    };
  }
  return { name, status: "pass", detected: result.stdout.trim(), message: `${command} is available.` };
}

async function exactVersion(
  spawn: ProcessRunner,
  command: string,
  args: readonly string[],
  name: DoctorCheck["name"],
  expected: string,
  code: string,
): Promise<DoctorCheck> {
  const result = await spawn(command, args);
  const detected = result.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? "";
  if (result.code !== 0 || detected !== expected) {
    return { name, status: "blocker", code, detected: detected || null, message: `${command} must be ${expected}.` };
  }
  return { name, status: "pass", detected, message: `${command} version is pinned.` };
}

async function workerProtocolCheck(spawn: ProcessRunner): Promise<DoctorCheck> {
  const result = await spawn("kpp", ["worker", "doctor", "--json"]);
  let protocol = "";
  try {
    protocol = (JSON.parse(result.stdout) as { protocol?: string }).protocol ?? "";
  } catch {
    protocol = "";
  }
  if (result.code !== 0 || protocol !== WORKER_PROTOCOL_VERSION) {
    return {
      name: "worker",
      status: "blocker",
      code: "PP_WORKER_PROTOCOL_MISSING",
      detected: protocol || null,
      message: `worker protocol ${WORKER_PROTOCOL_VERSION} is required.`,
    };
  }
  return { name: "worker", status: "pass", detected: protocol, message: "worker protocol is pinned." };
}

async function runRequired(spawn: ProcessRunner, command: string, args: readonly string[]): Promise<void> {
  const result = await spawn(command, args);
  if (result.code !== 0) {
    throw new SetupCommandError("PP_SETUP_COMMAND_FAILED", result.stderr || result.stdout || `${command} failed`);
  }
}

async function ensureMarketplaceRegistered(spawn: ProcessRunner, marketplacePath: string): Promise<void> {
  const list = await spawn("codex", ["plugin", "marketplace", "list", "--json"]);
  if (list.code === 0 && list.stdout.includes(marketplacePath)) {
    return;
  }
  await runRequired(spawn, "codex", ["plugin", "marketplace", "add", marketplacePath]);
}

async function ensurePluginInstalled(spawn: ProcessRunner): Promise<void> {
  const list = await spawn("codex", ["plugin", "list", "--json"]);
  if (list.code === 0 && list.stdout.includes("public-proposal")) {
    return;
  }
  await runRequired(spawn, "codex", ["plugin", "add", "public-proposal@public-proposal"]);
}

async function buildManifest(
  installRoot: string,
  ownedPaths: readonly string[],
  dependencies: SetupDependencies,
): Promise<InstallManifest> {
  const pluginManifestPath = join(installRoot, "plugin", ".codex-plugin", "plugin.json");
  const bundleManifestPath = join(installRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const plugin = JSON.parse(await dependencies.readFile(pluginManifestPath)) as { version?: string };
  return {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    packageVersion: "0.1.0",
    kppVersion: SUPPORTED_KPP_VERSION,
    longtableVersion: SUPPORTED_LONGTABLE_VERSION,
    pluginVersion: plugin.version ?? "0.1.0",
    workerProtocol: WORKER_PROTOCOL_VERSION,
    installRoot,
    pluginManifestSha256: await dependencies.sha256(pluginManifestPath),
    bundleManifestSha256: await dependencies.sha256(bundleManifestPath),
    ownedPaths,
    createdAt: dependencies.now(),
  };
}

async function mirrorPackagedFile(from: string, to: string, dependencies: SetupDependencies): Promise<void> {
  await dependencies.writeFile(to, await dependencies.readFile(from));
}

function failed(code: string, message: string, writes: readonly string[]): SetupResult {
  return {
    ok: false,
    plan: PLAN,
    writes,
    checks: [],
    error: { code, message },
  };
}

class SetupCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SetupCommandError";
  }
}
