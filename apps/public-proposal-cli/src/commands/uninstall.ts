import { join, resolve } from "node:path";
import { PublicProposalContractError, type InstallManifest, type ProcessRunner } from "../contracts.js";
import { readManifestJson, isProtectedPath } from "../installation-manifest.js";
import { manifestPath } from "../paths.js";
import { nodeFs } from "../process.js";

export interface UninstallDependencies {
  readonly readManifest?: (path: string) => Promise<InstallManifest & { ownedPaths: readonly string[] }>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly remove: (path: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly spawn?: ProcessRunner;
}

export async function runUninstall(
  installRoot: string,
  dependencies: UninstallDependencies = defaultUninstallDependencies(),
): Promise<{ removed: readonly string[]; preserved: readonly string[] }> {
  const manifest = dependencies.readManifest
    ? await dependencies.readManifest(manifestPath(installRoot))
    : readManifestJson(await dependencies.readFile?.(manifestPath(installRoot)) ?? "{}");
  const removed: string[] = [];
  const preserved: string[] = [];
  const requestedRoot = resolve(installRoot);
  if (resolve(manifest.installRoot) !== requestedRoot) {
    throw new PublicProposalContractError(
      "PP_INSTALL_MANIFEST_MISMATCH",
      `Installation receipt belongs to ${manifest.installRoot}, not ${installRoot}.`,
    );
  }
  const realpath = dependencies.realpath ?? ((path: string) => Promise.resolve(resolve(path)));
  const receiptPath = manifestPath(requestedRoot);
  const allowedRoots = installerOwnedRoots(
    requestedRoot,
    manifest.registrationOwnership?.longtable.ownership === "installer_owned",
  );
  const removablePaths = [...manifest.ownedPaths, receiptPath];
  const validatedPaths: string[] = [];

  for (const ownedPath of removablePaths) {
    if (isProtectedPath(ownedPath)) {
      preserved.push(ownedPath);
      continue;
    }
    const normalized = resolve(ownedPath);
    const allowed = isInstallerOwned(installRoot, ownedPath) && allowedRoots.includes(normalized);
    if (!allowed || normalized !== ownedPath) {
      throw new PublicProposalContractError(
        "PP_UNINSTALL_PATH_REJECTED",
        `Refusing to remove untrusted installer path: ${ownedPath}`,
      );
    }
    if (await dependencies.exists(normalized)) {
      const canonical = resolve(await realpath(normalized));
      if (canonical !== normalized) {
        throw new PublicProposalContractError(
          "PP_UNINSTALL_PATH_REJECTED",
          `Refusing to remove path that resolves outside its installer root: ${ownedPath}`,
        );
      }
      validatedPaths.push(normalized);
    }
  }

  const spawn = dependencies.spawn ?? nodeFs.spawn;
  const marketplacePath = resolve(await realpath(join(requestedRoot, "marketplace")).catch(() => join(requestedRoot, "marketplace")));
  const registrations = await resolveCodexRegistrationOwnership(manifest, marketplacePath, spawn);
  const deregistered = await deregisterCodexEntries(registrations, marketplacePath, spawn);

  for (const ownedPath of validatedPaths) {
    try {
      await dependencies.remove(ownedPath);
      removed.push(ownedPath);
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      const rollbackFailures = await restoreCodexEntries(deregistered, marketplacePath, spawn);
      if (rollbackFailures.length > 0) {
        throw new PublicProposalContractError(
          "PP_UNINSTALL_ROLLBACK_FAILED",
          `Installation cleanup failed at ${ownedPath}: ${failure}; registration recovery failed: ${rollbackFailures.join("; ")}`,
        );
      }
      throw new PublicProposalContractError(
        "PP_UNINSTALL_PARTIAL_FAILED",
        `Installation cleanup failed at ${ownedPath}: ${failure}; Codex registrations were restored and installation files were preserved for retry.`,
      );
    }
  }

  return { removed, preserved };
}

function defaultUninstallDependencies(): UninstallDependencies {
  return {
    exists: nodeFs.exists,
    readFile: nodeFs.readFile,
    realpath: nodeFs.realpath,
    remove: nodeFs.remove,
    spawn: nodeFs.spawn,
  };
}

interface CodexRegistrations {
  readonly pluginAdded: boolean;
  readonly marketplaceAdded: boolean;
  readonly longtablePluginAdded: boolean;
  readonly longtableMarketplaceAdded: boolean;
  readonly longtableMarketplaceSource?: string;
}

interface DeregisteredCodexEntries {
  readonly pluginRemoved: boolean;
  readonly marketplaceRemoved: boolean;
  readonly longtablePluginRemoved: boolean;
  readonly longtableMarketplaceRemoved: boolean;
}

async function resolveCodexRegistrationOwnership(
  manifest: InstallManifest,
  marketplacePath: string,
  spawn: ProcessRunner,
): Promise<CodexRegistrations> {
  const recorded = manifest.codexRegistrations;
  const longtable = manifest.registrationOwnership?.longtable;
  let longtableRegistration = {
    longtablePluginAdded: longtable?.pluginAdded ?? false,
    longtableMarketplaceAdded: longtable?.marketplaceAdded ?? false,
    ...(longtable ? { longtableMarketplaceSource: longtable.marketplaceSource } : {}),
  };
  if (recorded && !recorded.pluginAdded && !recorded.marketplaceAdded
    && !longtableRegistration.longtablePluginAdded && !longtableRegistration.longtableMarketplaceAdded) {
    return { ...recorded, ...longtableRegistration };
  }

  const marketplaceList = await spawn("codex", ["plugin", "marketplace", "list", "--json"]);
  const pluginList = await spawn("codex", ["plugin", "list", "--json"]);
  const source = marketplaceList.code === 0 ? marketplaceRegistrationSource(marketplaceList.stdout) : undefined;
  const pluginInstalled = pluginList.code === 0 && pluginListContains(pluginList.stdout);
  if (longtable && (longtable.pluginAdded || longtable.marketplaceAdded)) {
    const currentLongtableSource = marketplaceList.code === 0
      ? marketplaceRegistrationSourceNamed(marketplaceList.stdout, "longtable")
      : undefined;
    const longtableInstalled = pluginList.code === 0
      && pluginListContainsNamed(pluginList.stdout, "longtable@longtable", "longtable", "longtable");
    if (currentLongtableSource && currentLongtableSource !== longtable.marketplaceSource) {
      throw new PublicProposalContractError(
        "PP_UNINSTALL_REGISTRATION_CONFLICT",
        `Codex marketplace longtable now resolves to ${currentLongtableSource}, not ${longtable.marketplaceSource}. Installation files and registrations were preserved.`,
      );
    }
    longtableRegistration = {
      longtablePluginAdded: longtable.pluginAdded && longtableInstalled,
      longtableMarketplaceAdded: longtable.marketplaceAdded && currentLongtableSource === longtable.marketplaceSource,
      longtableMarketplaceSource: longtable.marketplaceSource,
    };
  }
  if (recorded && source && source !== marketplacePath) {
    throw new PublicProposalContractError(
      "PP_UNINSTALL_REGISTRATION_CONFLICT",
      `Codex marketplace public-proposal now resolves to ${source}, not ${marketplacePath}. Installation files and Codex registrations were preserved.`,
    );
  }
  if (source === undefined && !pluginInstalled && marketplaceList.code === 0 && pluginList.code === 0) {
    return { pluginAdded: false, marketplaceAdded: false, ...longtableRegistration };
  }
  if (source !== marketplacePath) {
    throw unknownOwnership(
      `Codex marketplace public-proposal does not resolve to ${marketplacePath}${source ? ` (current: ${source})` : ""}.`,
    );
  }

  if (recorded) {
    return {
      pluginAdded: recorded.pluginAdded && pluginInstalled,
      marketplaceAdded: recorded.marketplaceAdded,
      ...longtableRegistration,
    };
  }
  return {
    pluginAdded: pluginInstalled,
    marketplaceAdded: true,
    ...longtableRegistration,
  };
}

async function deregisterCodexEntries(
  registrations: CodexRegistrations,
  marketplacePath: string,
  spawn: ProcessRunner,
): Promise<DeregisteredCodexEntries> {
  let pluginRemoved = false;
  let marketplaceRemoved = false;
  let longtablePluginRemoved = false;
  let longtableMarketplaceRemoved = false;
  try {
    if (registrations.pluginAdded) {
      await runRequired(spawn, ["plugin", "remove", "public-proposal@public-proposal", "--json"]);
      pluginRemoved = true;
    }
    if (registrations.longtablePluginAdded) {
      await runRequired(spawn, ["plugin", "remove", "longtable@longtable", "--json"]);
      longtablePluginRemoved = true;
    }
    if (registrations.marketplaceAdded) {
      await runRequired(spawn, ["plugin", "marketplace", "remove", "public-proposal", "--json"]);
      marketplaceRemoved = true;
    }
    if (registrations.longtableMarketplaceAdded) {
      const current = await spawn("codex", ["plugin", "marketplace", "list", "--json"]);
      const source = current.code === 0 ? marketplaceRegistrationSourceNamed(current.stdout, "longtable") : undefined;
      if (source !== registrations.longtableMarketplaceSource) {
        throw new Error(`LongTable marketplace source changed to ${source ?? "unknown"}; expected ${registrations.longtableMarketplaceSource}.`);
      }
      await runRequired(spawn, ["plugin", "marketplace", "remove", "longtable", "--json"]);
      longtableMarketplaceRemoved = true;
    }
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    const rollbackFailures = await restoreCodexEntries({ pluginRemoved, marketplaceRemoved, longtablePluginRemoved, longtableMarketplaceRemoved }, marketplacePath, spawn, registrations.longtableMarketplaceSource);
    if (rollbackFailures.length > 0) {
      throw new PublicProposalContractError(
        "PP_UNINSTALL_ROLLBACK_FAILED",
        `${failure}; registration recovery failed: ${rollbackFailures.join("; ")}`,
      );
    }
    throw new PublicProposalContractError(
      "PP_UNINSTALL_DEREGISTRATION_FAILED",
      `${failure}; restored Codex registrations and preserved installation files.`,
    );
  }
  return { pluginRemoved, marketplaceRemoved, longtablePluginRemoved, longtableMarketplaceRemoved };
}

async function restoreCodexEntries(
  deregistered: DeregisteredCodexEntries,
  marketplacePath: string,
  spawn: ProcessRunner,
  longtableMarketplaceSource?: string,
): Promise<string[]> {
  const failures: string[] = [];
  if (deregistered.marketplaceRemoved) {
    await compensate(spawn, ["plugin", "marketplace", "add", marketplacePath], failures);
  }
  if (deregistered.longtableMarketplaceRemoved && longtableMarketplaceSource) {
    await compensate(spawn, ["plugin", "marketplace", "add", longtableMarketplaceSource], failures);
  }
  if (deregistered.pluginRemoved && failures.length === 0) {
    await compensate(spawn, ["plugin", "add", "public-proposal@public-proposal"], failures);
  }
  if (deregistered.longtablePluginRemoved && failures.length === 0) {
    await compensate(spawn, ["plugin", "add", "longtable@longtable"], failures);
  }
  return failures;
}

async function compensate(spawn: ProcessRunner, args: readonly string[], failures: string[]): Promise<void> {
  const result = await spawn("codex", args);
  if (result.code !== 0) failures.push(`codex ${args.join(" ")}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
}

async function runRequired(spawn: ProcessRunner, args: readonly string[]): Promise<void> {
  const result = await spawn("codex", args);
  if (result.code !== 0) {
    throw new Error(`codex ${args.join(" ")}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
}

function marketplaceRegistrationSource(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { marketplaces?: Array<{ name?: string; root?: string; path?: string; marketplaceSource?: { source?: string } }> };
    const entry = parsed.marketplaces?.find((candidate) => candidate.name === "public-proposal");
    if (!entry) return undefined;
    return entry.root ?? entry.path ?? entry.marketplaceSource?.source ?? "<unknown source>";
  } catch { return undefined; }
}

function marketplaceRegistrationSourceNamed(stdout: string, name: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { marketplaces?: Array<{ name?: string; root?: string; path?: string; marketplaceSource?: { source?: string } }> };
    const entry = parsed.marketplaces?.find((candidate) => candidate.name === name);
    return entry ? entry.root ?? entry.path ?? entry.marketplaceSource?.source ?? "<unknown source>" : undefined;
  } catch { return undefined; }
}

function pluginListContains(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { installed?: Array<{ pluginId?: string; installed?: boolean }>; plugins?: Array<{ name?: string; marketplace?: string }> };
    return (parsed.installed?.some((entry) => entry.pluginId === "public-proposal@public-proposal" && entry.installed === true) ?? false)
      || (parsed.plugins?.some((entry) => entry.name === "public-proposal" && entry.marketplace === "public-proposal") ?? false);
  } catch { return false; }
}

function pluginListContainsNamed(stdout: string, pluginId: string, name: string, marketplace: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { installed?: Array<{ pluginId?: string; installed?: boolean }>; plugins?: Array<{ name?: string; marketplace?: string }> };
    return (parsed.installed?.some((entry) => entry.pluginId === pluginId && entry.installed === true) ?? false)
      || (parsed.plugins?.some((entry) => entry.name === name && entry.marketplace === marketplace) ?? false);
  } catch { return false; }
}

function unknownOwnership(message: string): PublicProposalContractError {
  return new PublicProposalContractError(
    "PP_UNINSTALL_REGISTRATION_OWNERSHIP_UNKNOWN",
    `${message} Installation files were preserved. Resolve Codex marketplace ownership manually, then retry uninstall.`,
  );
}

function isInstallerOwned(installRoot: string, ownedPath: string): boolean {
  const normalized = resolve(ownedPath);
  return installerOwnedRoots(resolve(installRoot), true).includes(normalized);
}

function installerOwnedRoots(installRoot: string, includeLongtable = false): readonly string[] {
  return [
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "worker"),
    ...(includeLongtable ? [join(installRoot, "longtable-marketplace")] : []),
    manifestPath(installRoot),
  ].map((path) => resolve(path));
}
