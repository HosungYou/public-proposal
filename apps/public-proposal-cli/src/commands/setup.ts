import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  INSTALL_MANIFEST_SCHEMA_VERSION,
  SUPPORTED_KPP_VERSION,
  SUPPORTED_LONGTABLE_VERSION,
  WORKER_PROTOCOL_VERSION,
  type DoctorCheck,
  type InstallManifest,
  type PackageVersionResolver,
  type ProcessRunner,
  type SetupOptions,
  type SetupResult,
  type WorkerInstallation,
} from "../contracts.js";
import { readManifestJson, serializeManifest } from "../installation-manifest.js";
import { readPackagedMarketplaceManifest } from "../marketplace.js";
import { manifestPath, manifestTempPath, installationRoot } from "../paths.js";
import { nodeFs } from "../process.js";
import { createPackageVersionResolver } from "../package-version.js";
import { installManagedWorker, type ManagedWorkerInstallOptions } from "../worker.js";
import { kppCheck, longtableCheck, runDoctor } from "./doctor.js";

export interface SetupDependencies {
  readonly packageRoot?: string;
  readonly packageVersion?: PackageVersionResolver;
  readonly spawn: ProcessRunner;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, contents: string, mode?: number) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly sha256: (path: string) => Promise<string>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly now: () => string;
  readonly exists?: (path: string) => Promise<boolean>;
  readonly copyDir?: (from: string, to: string) => Promise<void>;
  readonly remove?: (path: string) => Promise<void>;
  readonly installWorker?: (root: string, runner: ProcessRunner, options?: ManagedWorkerInstallOptions) => Promise<WorkerInstallation>;
}

const PLAN = [
  "public-proposal plugin",
  "longtable plugin (external compatible registration reused, otherwise installer-owned)",
  "@longtable/kpp-cli@0.2.1",
  "@longtable/cli@0.1.72",
  "managed worker protocol 1.0.0",
];

export async function runSetup(
  options: SetupOptions,
  dependencies: SetupDependencies = defaultSetupDependencies(),
): Promise<SetupResult> {
  const packageRoot = dependencies.packageRoot ?? defaultPackageRoot();
  const installRoot = resolve(options.installRoot ?? installationRoot(
    options.installScope ?? "user",
    options.cwd ?? process.cwd(),
    options.home ?? process.env.HOME ?? process.cwd(),
  ));
  const manifest = manifestPath(installRoot);
  const exists = dependencies.exists ?? defaultExists(dependencies);
  const copyDir = dependencies.copyDir ?? nodeFs.copyDir;
  const remove = dependencies.remove ?? nodeFs.remove;
  const installWorker = dependencies.installWorker ?? installManagedWorker;

  if (options.dryRun) {
    return { ok: true, plan: PLAN, writes: [], checks: [] };
  }

  const existingManifest = await readExistingManifest(dependencies, manifest);
  if (existingManifest) {
    const existingValidation = await validateExistingManifest(existingManifest, installRoot, exists, dependencies.sha256);
    if (existingValidation) {
      return failed(existingValidation.code, existingValidation.message, []);
    }
    if (!existingManifest.registrationOwnership) {
      return migrateCurrentManifest(existingManifest, installRoot, packageRoot, dependencies, exists, remove);
    }
    if (!existingManifest.codexRegistrations) {
      const reconciled = await reconcileUntrackedCodexRegistrations(installRoot, dependencies.spawn);
      if (reconciled.error) return failed(reconciled.error.code, reconciled.error.message, []);
      const upgradedManifest = { ...existingManifest, codexRegistrations: reconciled.registrations };
      const tempManifest = manifestTempPath(installRoot);
      try {
        await dependencies.writeFile(tempManifest, serializeManifest(upgradedManifest), 0o600);
        await dependencies.rename(tempManifest, manifest);
      } catch (error) {
        return failed("PP_SETUP_COMMAND_FAILED", error instanceof Error ? error.message : String(error), []);
      }
      return {
        ok: true,
        plan: PLAN,
        writes: [manifest],
        manifestPath: manifest,
        checks: [],
        manifest: upgradedManifest,
      };
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
  const legacyManifest = await readLegacyManifest(dependencies, manifest);
  if (legacyManifest) {
    return migrateLegacyManifest(legacyManifest, installRoot, packageRoot, dependencies, exists, remove, installWorker);
  }
  if (await exists(manifest)) {
    return failed("PP_INSTALL_MANIFEST_MISMATCH", "Existing installation receipt cannot be parsed or is unsupported.", []);
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

  const preflight = await preflightChecks(dependencies.spawn, dependencies.packageVersion);
  const blocker = preflight.find((check) => check.status === "blocker");
  if (blocker) {
    return { ok: false, plan: PLAN, writes: [], checks: preflight, error: { code: blocker.code ?? "PP_PREFLIGHT_BLOCKED", message: blocker.message } };
  }

  const writes: string[] = [];
  let doctorChecks: readonly DoctorCheck[] = [];
  const ownedPaths: string[] = [
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "worker"),
  ];
  let marketplaceAdded = false;
  let pluginAdded = false;
  let longtableRegistration: RegistrationOwnership["longtable"] | undefined;

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
    await copyDir(join(packageRoot, "plugin"), join(ownedPaths[1], "plugin"));
    writes.push(ownedPaths[1]);
    await mirrorPackagedMarketplaceManifest(packageRoot, ownedPaths[1], dependencies);
    await copyDir(join(ownedPaths[0], "skills"), join(ownedPaths[1], "plugin", "skills"));
    marketplaceAdded = await ensureMarketplaceRegistered(
      dependencies.spawn,
      await canonicalPath(join(installRoot, "marketplace"), dependencies.realpath),
    );
    pluginAdded = await ensurePluginInstalled(dependencies.spawn);

    longtableRegistration = await ensureLongTableRegistered(installRoot, dependencies, exists);
    if (longtableRegistration.ownership === "installer_owned") {
      ownedPaths.push(join(installRoot, "longtable-marketplace"));
    }

    const worker = await installWorker(installRoot, dependencies.spawn);
    writes.push(ownedPaths[2]);

    const installManifest = await buildManifest(
      packageRoot,
      installRoot,
      ownedPaths,
      worker,
      { pluginAdded, marketplaceAdded },
      {
        publicProposal: {
          ownership: pluginAdded || marketplaceAdded ? "installer_owned" : "externally_owned",
          pluginId: "public-proposal@public-proposal",
          marketplaceName: "public-proposal",
          marketplaceSource: await canonicalPath(join(installRoot, "marketplace"), dependencies.realpath),
          pluginAdded,
          marketplaceAdded,
        },
        longtable: longtableRegistration,
      },
      undefined,
      dependencies,
    );
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
        packageVersion: dependencies.packageVersion,
        spawn: dependencies.spawn,
        readFile: async (path) => (path === manifest ? manifestContents : dependencies.readFile(path)),
        exists,
        realpath: dependencies.realpath,
        sha256: dependencies.sha256,
      },
    );
    doctorChecks = doctor.checks;
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
    const rollbackFailures: string[] = [];
    if (pluginAdded) {
      await compensate(dependencies.spawn, "codex", ["plugin", "remove", "public-proposal@public-proposal", "--json"], rollbackFailures);
    }
    if (marketplaceAdded) {
      await compensate(dependencies.spawn, "codex", ["plugin", "marketplace", "remove", "public-proposal", "--json"], rollbackFailures);
    }
    if (longtableRegistration?.pluginAdded) {
      await compensate(dependencies.spawn, "codex", ["plugin", "remove", "longtable@longtable", "--json"], rollbackFailures);
    }
    if (longtableRegistration?.marketplaceAdded) {
      await compensate(dependencies.spawn, "codex", ["plugin", "marketplace", "remove", "longtable", "--json"], rollbackFailures);
    }
    for (const path of [...ownedPaths].reverse()) {
      try { await remove(path); } catch (rollbackError) {
        rollbackFailures.push(`remove ${path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    const code = error instanceof SetupCommandError ? error.code : "PP_SETUP_COMMAND_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    return rollbackFailures.length === 0
      ? failed(code, message, writes, doctorChecks)
      : failed("PP_SETUP_ROLLBACK_FAILED", `${message}; rollback failed: ${rollbackFailures.join("; ")}`, writes, doctorChecks);
  }
}

async function migrateCurrentManifest(
  existingManifest: InstallManifest,
  installRoot: string,
  packageRoot: string,
  dependencies: SetupDependencies,
  exists: (path: string) => Promise<boolean>,
  remove: (path: string) => Promise<void>,
): Promise<SetupResult> {
  const manifest = manifestPath(installRoot);
  const publicReconciliation = await reconcileUntrackedCodexRegistrations(installRoot, dependencies.spawn, dependencies.realpath);
  if (publicReconciliation.error) return failed(publicReconciliation.error.code, publicReconciliation.error.message, []);
  const snapshot = await snapshotMigrationState(existingManifest, manifest, dependencies);
  let longtable: RegistrationOwnership["longtable"] | undefined;
  const removedLegacy: Array<{ directory: string; skillPath: string; contents: string }> = [];
  try {
    longtable = await ensureLongTableRegistered(installRoot, dependencies, exists);
    const ownedPaths = [...installerOwnedRoots(installRoot, longtable.ownership === "installer_owned")];
    const registrationOwnership: RegistrationOwnership = {
      publicProposal: {
        ownership: publicReconciliation.registrations.pluginAdded || publicReconciliation.registrations.marketplaceAdded
          ? "installer_owned"
          : "externally_owned",
        pluginId: "public-proposal@public-proposal",
        marketplaceName: "public-proposal",
        marketplaceSource: await canonicalPath(join(installRoot, "marketplace"), dependencies.realpath),
        ...publicReconciliation.registrations,
      },
      longtable,
    };
    const candidate = await buildManifest(
      packageRoot,
      installRoot,
      ownedPaths,
      existingManifest.worker,
      publicReconciliation.registrations,
      registrationOwnership,
      snapshot,
      dependencies,
    );
    const manifestContents = serializeManifest(candidate);
    const doctor = await runDoctor(
      {
        installRoot,
        expectedKppVersion: SUPPORTED_KPP_VERSION,
        expectedLongtableVersion: SUPPORTED_LONGTABLE_VERSION,
        expectedWorkerProtocol: WORKER_PROTOCOL_VERSION,
      },
      {
        packageRoot,
        packageVersion: dependencies.packageVersion,
        spawn: dependencies.spawn,
        readFile: async (path) => path === manifest ? manifestContents : dependencies.readFile(path),
        exists,
        realpath: dependencies.realpath,
        sha256: dependencies.sha256,
      },
    );
    if (!doctor.ok) {
      const blocker = doctor.checks.find((check) => check.status === "blocker") ?? doctor.checks[0];
      throw new SetupCommandError(blocker.code ?? "PP_DOCTOR_BLOCKED", blocker.message);
    }
    for (const directory of legacyRoleDirectories(installRoot)) {
      const skillPath = join(directory, "SKILL.md");
      if (!(await exists(skillPath))) continue;
      removedLegacy.push({ directory, skillPath, contents: await dependencies.readFile(skillPath) });
      await remove(directory);
    }
    const temp = manifestTempPath(installRoot);
    await dependencies.writeFile(temp, manifestContents, 0o600);
    await dependencies.rename(temp, manifest);
    return {
      ok: true,
      plan: PLAN,
      writes: [manifest],
      manifestPath: manifest,
      checks: doctor.checks,
      manifest: candidate,
    };
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const legacy of removedLegacy) {
      try { await dependencies.writeFile(legacy.skillPath, legacy.contents); } catch (restoreError) {
        rollbackFailures.push(`restore ${legacy.skillPath}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    }
    if (longtable?.pluginAdded) await compensate(dependencies.spawn, "codex", ["plugin", "remove", "longtable@longtable", "--json"], rollbackFailures);
    if (longtable?.marketplaceAdded) await compensate(dependencies.spawn, "codex", ["plugin", "marketplace", "remove", "longtable", "--json"], rollbackFailures);
    if (longtable?.marketplaceAdded) {
      try { await remove(join(installRoot, "longtable-marketplace")); } catch (removeError) {
        rollbackFailures.push(`remove ${join(installRoot, "longtable-marketplace")}: ${removeError instanceof Error ? removeError.message : String(removeError)}`);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return rollbackFailures.length > 0
      ? failed("PP_SETUP_ROLLBACK_FAILED", `${message}; rollback failed: ${rollbackFailures.join("; ")}`, [])
      : failed(error instanceof SetupCommandError ? error.code : "PP_SETUP_COMMAND_FAILED", message, []);
  }
}

async function snapshotMigrationState(
  manifest: InstallManifest,
  manifestFile: string,
  dependencies: SetupDependencies,
): Promise<MigrationSnapshot> {
  const [marketplaces, plugins] = await Promise.all([
    dependencies.spawn("codex", ["plugin", "marketplace", "list", "--json"]),
    dependencies.spawn("codex", ["plugin", "list", "--json"]),
  ]);
  if (marketplaces.code !== 0 || plugins.code !== 0) {
    throw new SetupCommandError("PP_MIGRATION_SNAPSHOT_FAILED", "Codex registration snapshot failed before migration.");
  }
  const corePaths = [
    join(manifest.installRoot, "plugin", ".codex-plugin", "plugin.json"),
    join(manifest.installRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json"),
    manifest.worker.executable,
  ];
  const ownedFileHashes = Object.fromEntries(await Promise.all(corePaths.map(async (path) => [path, await dependencies.sha256(path)])));
  return {
    previousReceiptSha256: await dependencies.sha256(manifestFile),
    registrations: [
      {
        pluginId: "public-proposal@public-proposal",
        installed: pluginListContainsId(plugins.stdout, "public-proposal@public-proposal", "public-proposal", "public-proposal"),
        marketplaceName: "public-proposal",
        marketplaceSource: marketplaceSourceByName(marketplaces.stdout, "public-proposal") ?? null,
      },
      {
        pluginId: "longtable@longtable",
        installed: pluginListContainsId(plugins.stdout, "longtable@longtable", "longtable", "longtable"),
        marketplaceName: "longtable",
        marketplaceSource: marketplaceSourceByName(marketplaces.stdout, "longtable") ?? null,
      },
    ],
    ownedFileHashes,
  };
}

function legacyRoleDirectories(installRoot: string): readonly string[] {
  return ["longtable", "longtable-research", "scholar-research"].flatMap((name) => [
    join(installRoot, "plugin", "skills", name),
    join(installRoot, "marketplace", "plugin", "skills", name),
  ]);
}

function defaultPackageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

export function defaultSetupDependencies(): SetupDependencies {
  const packageRoot = defaultPackageRoot();
  return {
    ...nodeFs,
    packageRoot,
    packageVersion: createPackageVersionResolver(packageRoot, nodeFs.readFile),
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

interface LegacyInstallManifest {
  readonly schemaVersion: "1.0.0";
  readonly packageVersion: string;
  readonly kppVersion: typeof SUPPORTED_KPP_VERSION;
  readonly longtableVersion: typeof SUPPORTED_LONGTABLE_VERSION;
  readonly pluginVersion: string;
  readonly workerProtocol: typeof WORKER_PROTOCOL_VERSION;
  readonly installRoot: string;
  readonly pluginManifestSha256: string;
  readonly bundleManifestSha256: string;
  readonly ownedPaths: readonly string[];
  readonly createdAt: string;
}

async function readLegacyManifest(
  dependencies: Pick<SetupDependencies, "readFile">,
  path: string,
): Promise<LegacyInstallManifest | null> {
  try {
    const parsed = JSON.parse(await dependencies.readFile(path)) as Record<string, unknown>;
    if (
      parsed.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION ||
      parsed.kppVersion !== SUPPORTED_KPP_VERSION ||
      parsed.longtableVersion !== SUPPORTED_LONGTABLE_VERSION ||
      parsed.workerProtocol !== WORKER_PROTOCOL_VERSION ||
      typeof parsed.packageVersion !== "string" ||
      typeof parsed.pluginVersion !== "string" ||
      typeof parsed.installRoot !== "string" ||
      typeof parsed.pluginManifestSha256 !== "string" ||
      typeof parsed.bundleManifestSha256 !== "string" ||
      typeof parsed.createdAt !== "string" ||
      "worker" in parsed ||
      !Array.isArray(parsed.ownedPaths) ||
      !parsed.ownedPaths.every((ownedPath) => typeof ownedPath === "string")
    ) {
      return null;
    }
    return parsed as unknown as LegacyInstallManifest;
  } catch {
    return null;
  }
}

async function findConflict(installRoot: string, exists: (path: string) => Promise<boolean>): Promise<string | null> {
  for (const path of [
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "worker"),
    join(installRoot, "longtable-marketplace"),
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
  sha256: (path: string) => Promise<string>,
): Promise<{ code: string; message: string } | null> {
  const requestedRoot = resolve(installRoot);
  if (resolve(existingManifest.installRoot) !== requestedRoot) {
    return {
      code: "PP_INSTALL_MANIFEST_MISMATCH",
      message: `Existing installation receipt belongs to ${existingManifest.installRoot}, not ${installRoot}.`,
    };
  }
  const expectedOwnedPaths = installerOwnedRoots(
    requestedRoot,
    existingManifest.registrationOwnership?.longtable.ownership === "installer_owned",
  );
  const normalizedOwnedPaths = existingManifest.ownedPaths.map((ownedPath) => resolve(ownedPath));
  const uniqueOwnedPaths = new Set(normalizedOwnedPaths);
  if (
    existingManifest.ownedPaths.length === 0 ||
    uniqueOwnedPaths.size !== existingManifest.ownedPaths.length ||
    uniqueOwnedPaths.size !== expectedOwnedPaths.length ||
    !expectedOwnedPaths.every((expectedPath) => uniqueOwnedPaths.has(expectedPath)) ||
    existingManifest.ownedPaths.some((ownedPath) => ownedPath !== resolve(ownedPath))
  ) {
    return {
      code: "PP_INSTALL_MANIFEST_MISMATCH",
      message: "Existing installation receipt does not match the installer-owned path set.",
    };
  }
  for (const ownedPath of expectedOwnedPaths) {
    if (!(await exists(ownedPath))) {
      return {
        code: "PP_INSTALL_MANIFEST_STALE",
        message: `Existing installation receipt references missing path: ${ownedPath}`,
      };
    }
  }
  for (const [path, expectedHash] of Object.entries(existingManifest.ownedFileHashes ?? {})) {
    const normalized = resolve(path);
    if (normalized !== path || !expectedOwnedPaths.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
      return { code: "PP_INSTALL_MANIFEST_MISMATCH", message: `Owned-file hash path is outside the receipted installation roots: ${path}` };
    }
    const actualHash = await sha256(path).catch(() => null);
    if (actualHash !== expectedHash) {
      return { code: "PP_INSTALL_OWNED_FILE_DRIFT", message: `Installer-owned file changed since the receipt was written: ${path}` };
    }
  }
  return null;
}

async function migrateLegacyManifest(
  legacyManifest: LegacyInstallManifest,
  installRoot: string,
  packageRoot: string,
  dependencies: SetupDependencies,
  exists: (path: string) => Promise<boolean>,
  remove: (path: string) => Promise<void>,
  installWorker: (root: string, runner: ProcessRunner, options?: ManagedWorkerInstallOptions) => Promise<WorkerInstallation>,
): Promise<SetupResult> {
  const requestedRoot = resolve(installRoot);
  const manifest = manifestPath(requestedRoot);
  const expectedLegacyPaths = [
    join(requestedRoot, "plugin"),
    join(requestedRoot, "marketplace"),
    join(requestedRoot, "codex-skills"),
  ].map((path) => resolve(path));
  const normalizedOwnedPaths = legacyManifest.ownedPaths.map((ownedPath) => resolve(ownedPath));
  const uniqueOwnedPaths = new Set(normalizedOwnedPaths);
  if (
    resolve(legacyManifest.installRoot) !== requestedRoot ||
    uniqueOwnedPaths.size !== expectedLegacyPaths.length ||
    !expectedLegacyPaths.every((expectedPath) => uniqueOwnedPaths.has(expectedPath)) ||
    legacyManifest.ownedPaths.some((ownedPath) => ownedPath !== resolve(ownedPath))
  ) {
    return failed("PP_INSTALL_MANIFEST_MISMATCH", "Existing legacy installation receipt does not match the installer-owned path set.", []);
  }
  for (const ownedPath of expectedLegacyPaths) {
    if (!(await exists(ownedPath))) {
      return failed("PP_INSTALL_MANIFEST_STALE", `Existing legacy installation receipt references missing path: ${ownedPath}`, []);
    }
  }
  const workerRoot = join(requestedRoot, "worker");
  if (await exists(workerRoot)) {
    return failed("PP_INSTALL_TARGET_CONFLICT", `Existing path is not owned by Public Proposal: ${workerRoot}`, []);
  }

  const integrity = await packageIntegrity(packageRoot, dependencies);
  if (integrity.status !== "pass") {
    return { ok: false, plan: PLAN, writes: [], checks: [integrity], error: { code: integrity.code ?? "PP_PLUGIN_INTEGRITY_FAILED", message: integrity.message } };
  }
  const preflight = await preflightChecks(dependencies.spawn, dependencies.packageVersion);
  const blocker = preflight.find((check) => check.status === "blocker");
  if (blocker) {
    return { ok: false, plan: PLAN, writes: [], checks: preflight, error: { code: blocker.code ?? "PP_PREFLIGHT_BLOCKED", message: blocker.message } };
  }

  const registrationReconciliation = await reconcileUntrackedCodexRegistrations(
    requestedRoot,
    dependencies.spawn,
    dependencies.realpath,
  );
  if (registrationReconciliation.error) {
    return failed(registrationReconciliation.error.code, registrationReconciliation.error.message, []);
  }

  const writes: string[] = [];
  try {
    const worker = await installWorker(requestedRoot, dependencies.spawn, { updateManifest: false });
    writes.push(workerRoot);
    await runRequired(dependencies.spawn, "longtable", [
      "codex", "install-skills", "--surface", "compact", "--dir", join(requestedRoot, "plugin", "skills"),
    ]);
    await ensureLongTableResearchSkill(join(requestedRoot, "plugin", "skills"), dependencies, exists);
    await dependencies.copyDir?.(
      join(requestedRoot, "plugin", "skills"),
      join(requestedRoot, "marketplace", "plugin", "skills"),
    );
    const ownedPaths = installerOwnedRoots(requestedRoot);
    const installManifest = await buildManifest(
      packageRoot,
      requestedRoot,
      ownedPaths,
      worker,
      registrationReconciliation.registrations,
      undefined,
      undefined,
      dependencies,
    );
    const manifestContents = serializeManifest(installManifest);
    const doctor = await runDoctor(
      {
        installRoot: requestedRoot,
        expectedKppVersion: SUPPORTED_KPP_VERSION,
        expectedLongtableVersion: SUPPORTED_LONGTABLE_VERSION,
        expectedWorkerProtocol: WORKER_PROTOCOL_VERSION,
      },
      {
        packageRoot,
        packageVersion: dependencies.packageVersion,
        spawn: dependencies.spawn,
        readFile: async (path) => (path === manifest ? manifestContents : dependencies.readFile(path)),
        exists,
        realpath: dependencies.realpath,
        sha256: dependencies.sha256,
      },
    );
    if (!doctor.ok) {
      const failedCheck = doctor.checks.find((check) => check.status === "blocker") ?? doctor.checks[0];
      throw new SetupCommandError(failedCheck.code ?? "PP_DOCTOR_BLOCKED", failedCheck.message);
    }
    const tempManifest = manifestTempPath(requestedRoot);
    await dependencies.writeFile(tempManifest, manifestContents, 0o600);
    writes.push(tempManifest);
    await dependencies.rename(tempManifest, manifest);
    return {
      ok: true,
      plan: PLAN,
      writes: [workerRoot, manifest],
      manifestPath: manifest,
      checks: doctor.checks,
      manifest: installManifest,
    };
  } catch (error) {
    await Promise.all([manifestTempPath(requestedRoot), workerRoot].map(async (path) => {
      if (await exists(path)) await remove(path);
    }));
    const code = error instanceof SetupCommandError ? error.code : "PP_SETUP_COMMAND_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    return failed(code, message, writes);
  }
}

function installerOwnedRoots(installRoot: string, includeLongtable = false): readonly string[] {
  return [
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "worker"),
    ...(includeLongtable ? [join(installRoot, "longtable-marketplace")] : []),
  ].map((path) => resolve(path));
}

async function packageIntegrity(packageRoot: string, dependencies: SetupDependencies): Promise<DoctorCheck> {
  const pluginManifestPath = join(packageRoot, "plugin", ".codex-plugin", "plugin.json");
  const bundleManifestPath = join(packageRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const workerProjectPath = join(packageRoot, "worker", "pyproject.toml");
  const workerLockPath = join(packageRoot, "worker", "uv.lock");
  try {
    const [pluginRaw, marketplaceManifest, bundleRaw, workerProject, workerLock] = await Promise.all([
      dependencies.readFile(pluginManifestPath),
      readPackagedMarketplaceManifest(packageRoot, dependencies.readFile),
      dependencies.readFile(bundleManifestPath),
      dependencies.readFile(workerProjectPath),
      dependencies.readFile(workerLockPath),
    ]);
    const marketplaceRaw = marketplaceManifest.contents;
    const plugin = JSON.parse(pluginRaw) as { name?: string };
    const marketplace = JSON.parse(marketplaceRaw) as {
      plugins?: Array<{ name?: string; source?: { source?: string; path?: string } }>;
    };
    JSON.parse(bundleRaw);
    const entry = marketplace.plugins?.find((pluginEntry) => pluginEntry.name === "public-proposal");
    if (
      plugin.name !== "public-proposal" ||
      entry?.source?.source !== "local" ||
      entry.source.path !== "./plugin" ||
      !workerProject.includes("kpp-docx-worker") ||
      workerLock.trim().length === 0
    ) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
        detected: {
          pluginName: plugin.name,
          marketplaceSource: entry?.source?.path,
          marketplaceSourceType: entry?.source?.source,
          workerProject: workerProject.includes("kpp-docx-worker"),
        },
        message: "Packaged plugin, marketplace entry, and managed worker snapshot must be valid.",
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

async function mirrorPackagedMarketplaceManifest(
  packageRoot: string,
  installMarketplaceRoot: string,
  dependencies: SetupDependencies,
): Promise<void> {
  const packaged = await readPackagedMarketplaceManifest(packageRoot, dependencies.readFile);
  const relative = packaged.path.slice(join(packageRoot, "marketplace").length + 1);
  await dependencies.writeFile(join(installMarketplaceRoot, relative), packaged.contents);
}

async function preflightChecks(spawn: ProcessRunner, packageVersion?: PackageVersionResolver): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(await requireCommand(spawn, "node", ["--version"], "node"));
  checks.push(await requireCommand(spawn, "npm", ["--version"], "npm"));
  checks.push(await requireCommand(spawn, "codex", ["--version"], "codex"));
  checks.push(await requireCommand(spawn, "python3", ["--version"], "python"));
  checks.push(await requireCommand(spawn, "soffice", ["--version"], "libreoffice"));
  checks.push(await requireCommand(spawn, "fc-match", ["NotoSansCJKkr-Regular"], "fonts"));
  checks.push(await kppCheck(spawn, SUPPORTED_KPP_VERSION, packageVersion));
  checks.push(await longtableCheck(spawn, SUPPORTED_LONGTABLE_VERSION, undefined, packageVersion, true));
  checks.push(await requireCommand(spawn, "longtable", ["scholar-research", "doctor", "--json"], "scholarResearch"));
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

async function runRequired(spawn: ProcessRunner, command: string, args: readonly string[]): Promise<void> {
  const result = await spawn(command, args);
  if (result.code !== 0) {
    throw new SetupCommandError("PP_SETUP_COMMAND_FAILED", result.stderr || result.stdout || `${command} failed`);
  }
}

async function canonicalPath(path: string, realpath?: (path: string) => Promise<string>): Promise<string> {
  if (realpath === undefined) return path;
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

async function ensureMarketplaceRegistered(spawn: ProcessRunner, marketplacePath: string): Promise<boolean> {
  const list = await spawn("codex", ["plugin", "marketplace", "list", "--json"]);
  if (list.code === 0) {
    const registeredSource = marketplaceRegistrationSource(list.stdout);
    if (registeredSource !== undefined) {
      if (registeredSource === marketplacePath) return false;
      throw new SetupCommandError(
        "PP_MARKETPLACE_CONFLICT",
        `Codex marketplace public-proposal is already registered at ${registeredSource}; it cannot be redirected to ${marketplacePath}.`,
      );
    }
  }
  await runRequired(spawn, "codex", ["plugin", "marketplace", "add", marketplacePath]);
  return true;
}

async function ensurePluginInstalled(spawn: ProcessRunner): Promise<boolean> {
  const list = await spawn("codex", ["plugin", "list", "--json"]);
  if (list.code === 0 && pluginListContains(list.stdout)) {
    return false;
  }
  await runRequired(spawn, "codex", ["plugin", "add", "public-proposal@public-proposal"]);
  return true;
}

function marketplaceRegistrationSource(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { marketplaces?: Array<{ name?: string; root?: string; path?: string; marketplaceSource?: { source?: string } }> };
    const entry = parsed.marketplaces?.find((candidate) => candidate.name === "public-proposal");
    if (!entry) return undefined;
    return entry.root ?? entry.path ?? entry.marketplaceSource?.source ?? "<unknown source>";
  } catch { return undefined; }
}

function pluginListContains(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { installed?: Array<{ pluginId?: string; installed?: boolean }>; plugins?: Array<{ name?: string; marketplace?: string }> };
    return (parsed.installed?.some((entry) => entry.pluginId === "public-proposal@public-proposal" && entry.installed === true) ?? false)
      || (parsed.plugins?.some((entry) => entry.name === "public-proposal" && entry.marketplace === "public-proposal") ?? false);
  } catch { return false; }
}

async function reconcileUntrackedCodexRegistrations(
  installRoot: string,
  spawn: ProcessRunner,
  realpath?: (path: string) => Promise<string>,
): Promise<
  | { registrations: { pluginAdded: boolean; marketplaceAdded: boolean }; error?: undefined }
  | { registrations?: undefined; error: { code: string; message: string } }
> {
  const marketplacePath = await canonicalPath(join(resolve(installRoot), "marketplace"), realpath);
  const marketplaceList = await spawn("codex", ["plugin", "marketplace", "list", "--json"]);
  const pluginList = await spawn("codex", ["plugin", "list", "--json"]);
  const source = marketplaceList.code === 0 ? marketplaceRegistrationSource(marketplaceList.stdout) : undefined;
  const pluginInstalled = pluginList.code === 0 && pluginListContains(pluginList.stdout);

  if (source && source !== marketplacePath) {
    return {
      error: {
        code: "PP_MARKETPLACE_CONFLICT",
        message: `Codex marketplace public-proposal is already registered at ${source}; it cannot be reconciled with ${marketplacePath}.`,
      },
    };
  }
  if (source === undefined && !pluginInstalled && marketplaceList.code === 0 && pluginList.code === 0) {
    return { registrations: { pluginAdded: false, marketplaceAdded: false } };
  }
  if (source !== marketplacePath) {
    return {
      error: {
        code: "PP_INSTALL_REGISTRATION_OWNERSHIP_UNKNOWN",
        message: "Codex plugin state cannot be attributed to this installation; resolve marketplace ownership before retrying setup.",
      },
    };
  }
  return { registrations: { pluginAdded: pluginInstalled, marketplaceAdded: true } };
}

async function compensate(
  spawn: ProcessRunner,
  command: string,
  args: readonly string[],
  failures: string[],
): Promise<void> {
  const result = await spawn(command, args);
  if (result.code !== 0) failures.push(`${command} ${args.join(" ")}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
}

async function buildManifest(
  packageRoot: string,
  installRoot: string,
  ownedPaths: readonly string[],
  worker: WorkerInstallation,
  codexRegistrations: { pluginAdded: boolean; marketplaceAdded: boolean } | undefined,
  registrationOwnership: RegistrationOwnership | undefined,
  migrationSnapshot: MigrationSnapshot | undefined,
  dependencies: SetupDependencies,
): Promise<InstallManifest> {
  const pluginManifestPath = join(installRoot, "plugin", ".codex-plugin", "plugin.json");
  const bundleManifestPath = join(installRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const plugin = JSON.parse(await dependencies.readFile(pluginManifestPath)) as { version?: string };
  let packageVersion = "0.1.0";
  try {
    const packageMetadata = JSON.parse(await dependencies.readFile(join(packageRoot, "package.json"))) as { version?: unknown };
    if (typeof packageMetadata.version === "string") packageVersion = packageMetadata.version;
  } catch {
    // Test doubles and legacy package snapshots may not carry package metadata.
  }
  const ownedFileHashes = await knownOwnedFileHashes(installRoot, worker, registrationOwnership, dependencies);
  return {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    packageVersion,
    kppVersion: SUPPORTED_KPP_VERSION,
    longtableVersion: SUPPORTED_LONGTABLE_VERSION,
    pluginVersion: plugin.version ?? "0.1.0",
    workerProtocol: WORKER_PROTOCOL_VERSION,
    installRoot,
    pluginManifestSha256: await dependencies.sha256(pluginManifestPath),
    bundleManifestSha256: await dependencies.sha256(bundleManifestPath),
    worker,
    ...(codexRegistrations ? { codexRegistrations } : {}),
    ...(registrationOwnership ? { registrationOwnership } : {}),
    ownedFileHashes,
    ...(migrationSnapshot ? { migrationSnapshot } : {}),
    ownedPaths,
    createdAt: dependencies.now(),
  };
}

type RegistrationOwnership = NonNullable<InstallManifest["registrationOwnership"]>;
type MigrationSnapshot = NonNullable<InstallManifest["migrationSnapshot"]>;

async function knownOwnedFileHashes(
  installRoot: string,
  worker: WorkerInstallation,
  registrationOwnership: RegistrationOwnership | undefined,
  dependencies: Pick<SetupDependencies, "sha256">,
): Promise<Record<string, string>> {
  const paths = [
    join(installRoot, "plugin", ".codex-plugin", "plugin.json"),
    join(installRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json"),
    worker.executable,
  ];
  if (registrationOwnership?.longtable.ownership === "installer_owned") {
    paths.push(
      join(installRoot, "longtable-marketplace", ".agents", "plugins", "marketplace.json"),
      join(installRoot, "longtable-marketplace", "plugin", ".codex-plugin", "plugin.json"),
    );
  }
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await dependencies.sha256(path)])));
}

async function mirrorPackagedFile(from: string, to: string, dependencies: SetupDependencies): Promise<void> {
  await dependencies.writeFile(to, await dependencies.readFile(from));
}

async function ensureLongTableRegistered(
  installRoot: string,
  dependencies: SetupDependencies,
  exists: (path: string) => Promise<boolean>,
): Promise<RegistrationOwnership["longtable"]> {
  const marketplaceRoot = join(installRoot, "longtable-marketplace");
  const canonicalManagedRoot = await canonicalPath(marketplaceRoot, dependencies.realpath);
  const [marketplaces, plugins] = await Promise.all([
    dependencies.spawn("codex", ["plugin", "marketplace", "list", "--json"]),
    dependencies.spawn("codex", ["plugin", "list", "--json"]),
  ]);
  if (marketplaces.code !== 0 || plugins.code !== 0) {
    throw new SetupCommandError("PP_LONGTABLE_REGISTRATION_READ", "Codex LongTable registration state could not be read safely.");
  }
  const source = marketplaceSourceByName(marketplaces.stdout, "longtable");
  const installed = pluginListContainsId(plugins.stdout, "longtable@longtable", "longtable", "longtable");
  if (installed && source === undefined) {
    throw new SetupCommandError(
      "PP_LONGTABLE_REGISTRATION_OWNERSHIP_UNKNOWN",
      "LongTable plugin is installed but its marketplace source cannot be attributed safely.",
    );
  }
  if (source !== undefined && source !== canonicalManagedRoot) {
    let pluginAdded = false;
    if (!installed) {
      await runRequired(dependencies.spawn, "codex", ["plugin", "add", "longtable@longtable"]);
      pluginAdded = true;
    }
    await runRequired(dependencies.spawn, "longtable", ["scholar-research", "doctor", "--json"]);
    return {
      ownership: "externally_owned",
      pluginId: "longtable@longtable",
      marketplaceName: "longtable",
      marketplaceSource: source,
      pluginAdded,
      marketplaceAdded: false,
    };
  }
  if (source === canonicalManagedRoot && !(await exists(marketplaceRoot))) {
    throw new SetupCommandError(
      "PP_LONGTABLE_REGISTRATION_STALE",
      `Codex LongTable marketplace points to a missing installer path: ${marketplaceRoot}`,
    );
  }

  let marketplaceAdded = false;
  let pluginAdded = false;
  let managedSource = canonicalManagedRoot;
  const createdNow = source === undefined && !(await exists(marketplaceRoot));
  try {
    if (source === undefined) {
      if (!createdNow) {
        throw new SetupCommandError("PP_LONGTABLE_MARKETPLACE_CONFLICT", `Unreceipted LongTable marketplace path already exists: ${marketplaceRoot}`);
      }
      await dependencies.mkdir(join(marketplaceRoot, ".agents", "plugins"));
      await dependencies.mkdir(join(marketplaceRoot, "plugin", ".codex-plugin"));
      await dependencies.writeFile(join(marketplaceRoot, ".agents", "plugins", "marketplace.json"), `${JSON.stringify({
        name: "longtable",
        plugins: [{ name: "longtable", source: { source: "local", path: "./plugin" } }],
      }, null, 2)}\n`);
      await dependencies.writeFile(join(marketplaceRoot, "plugin", ".codex-plugin", "plugin.json"), `${JSON.stringify({
        name: "longtable",
        version: SUPPORTED_LONGTABLE_VERSION,
        description: "LongTable research plugin managed by the Public Proposal installer.",
        skills: "./skills/",
      }, null, 2)}\n`);
      await runRequired(dependencies.spawn, "longtable", [
        "codex", "install-skills", "--surface", "compact", "--dir", join(marketplaceRoot, "plugin", "skills"),
      ]);
      await ensureLongTableResearchSkill(join(marketplaceRoot, "plugin", "skills"), dependencies, exists);
      managedSource = await canonicalPath(marketplaceRoot, dependencies.realpath);
      await runRequired(dependencies.spawn, "codex", ["plugin", "marketplace", "add", managedSource]);
      marketplaceAdded = true;
    }
    if (!installed) {
      await runRequired(dependencies.spawn, "codex", ["plugin", "add", "longtable@longtable"]);
      pluginAdded = true;
    }
    await runRequired(dependencies.spawn, "longtable", ["scholar-research", "doctor", "--json"]);
    return {
      ownership: "installer_owned",
      pluginId: "longtable@longtable",
      marketplaceName: "longtable",
      marketplaceSource: managedSource,
      pluginAdded,
      marketplaceAdded,
    };
  } catch (error) {
    const rollbackFailures: string[] = [];
    if (pluginAdded) await compensate(dependencies.spawn, "codex", ["plugin", "remove", "longtable@longtable", "--json"], rollbackFailures);
    if (marketplaceAdded) await compensate(dependencies.spawn, "codex", ["plugin", "marketplace", "remove", "longtable", "--json"], rollbackFailures);
    if (createdNow) {
      try { await (dependencies.remove ?? nodeFs.remove)(marketplaceRoot); } catch (rollbackError) {
        rollbackFailures.push(`remove ${marketplaceRoot}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new SetupCommandError("PP_SETUP_ROLLBACK_FAILED", `${error instanceof Error ? error.message : String(error)}; rollback failed: ${rollbackFailures.join("; ")}`);
    }
    throw error;
  }
}

function marketplaceSourceByName(stdout: string, name: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { marketplaces?: Array<{ name?: string; root?: string; path?: string; marketplaceSource?: { source?: string } }> };
    const entry = parsed.marketplaces?.find((candidate) => candidate.name === name);
    return entry ? entry.root ?? entry.path ?? entry.marketplaceSource?.source ?? "<unknown source>" : undefined;
  } catch {
    return undefined;
  }
}

function pluginListContainsId(stdout: string, pluginId: string, name: string, marketplace: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { installed?: Array<{ pluginId?: string; installed?: boolean }>; plugins?: Array<{ name?: string; marketplace?: string }> };
    return (parsed.installed?.some((entry) => entry.pluginId === pluginId && entry.installed === true) ?? false)
      || (parsed.plugins?.some((entry) => entry.name === name && entry.marketplace === marketplace) ?? false);
  } catch {
    return false;
  }
}

async function ensureLongTableResearchSkill(
  skillsRoot: string,
  dependencies: Pick<SetupDependencies, "readFile" | "writeFile">,
  exists: (path: string) => Promise<boolean>,
): Promise<void> {
  const canonicalPath = join(skillsRoot, "longtable-research", "SKILL.md");
  if (await exists(canonicalPath)) return;
  const compatibilityPath = join(skillsRoot, "scholar-research", "SKILL.md");
  let compatibilitySkill: string;
  try {
    compatibilitySkill = await dependencies.readFile(compatibilityPath);
  } catch {
    throw new SetupCommandError(
      "PP_LONGTABLE_REQUIRED",
      "Pinned LongTable CLI did not install the required longtable-research skill surface.",
    );
  }
  const canonicalSkill = compatibilitySkill
    .replace(/^name:\s*scholar-research\s*$/mu, "name: longtable-research")
    .replace(/^#\s+scholar-research\s*$/mu, "# longtable-research");
  await dependencies.writeFile(canonicalPath, canonicalSkill);
}

function failed(code: string, message: string, writes: readonly string[], checks: readonly DoctorCheck[] = []): SetupResult {
  return {
    ok: false,
    plan: PLAN,
    writes,
    checks,
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
