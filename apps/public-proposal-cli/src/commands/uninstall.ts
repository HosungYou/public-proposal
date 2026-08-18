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
  const allowedRoots = installerOwnedRoots(requestedRoot);
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

  await deregisterCodexEntries(manifest, dependencies.spawn ?? nodeFs.spawn);

  for (const ownedPath of validatedPaths) {
    try {
      await dependencies.remove(ownedPath);
      removed.push(ownedPath);
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      throw new PublicProposalContractError(
        "PP_UNINSTALL_PARTIAL_FAILED",
        `Codex deregistration completed but installation cleanup failed at ${ownedPath}: ${failure}`,
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

async function deregisterCodexEntries(manifest: InstallManifest, spawn: ProcessRunner): Promise<void> {
  const registrations = manifest.codexRegistrations;
  if (!registrations) return;

  let pluginRemoved = false;
  try {
    if (registrations.pluginAdded) {
      await runRequired(spawn, ["plugin", "remove", "public-proposal@public-proposal", "--json"]);
      pluginRemoved = true;
    }
    if (registrations.marketplaceAdded) {
      await runRequired(spawn, ["plugin", "marketplace", "remove", "public-proposal", "--json"]);
    }
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    if (!pluginRemoved) {
      throw new PublicProposalContractError("PP_UNINSTALL_DEREGISTRATION_FAILED", failure);
    }

    const restore = await spawn("codex", ["plugin", "add", "public-proposal@public-proposal"]);
    if (restore.code !== 0) {
      throw new PublicProposalContractError(
        "PP_UNINSTALL_ROLLBACK_FAILED",
        `${failure}; failed to restore Codex plugin registration: ${restore.stderr || restore.stdout || `exit ${restore.code}`}`,
      );
    }
    throw new PublicProposalContractError(
      "PP_UNINSTALL_DEREGISTRATION_FAILED",
      `${failure}; restored Codex plugin registration and preserved installation files.`,
    );
  }
}

async function runRequired(spawn: ProcessRunner, args: readonly string[]): Promise<void> {
  const result = await spawn("codex", args);
  if (result.code !== 0) {
    throw new Error(`codex ${args.join(" ")}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
}

function isInstallerOwned(installRoot: string, ownedPath: string): boolean {
  const normalized = resolve(ownedPath);
  return installerOwnedRoots(resolve(installRoot)).includes(normalized);
}

function installerOwnedRoots(installRoot: string): readonly string[] {
  return [
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "worker"),
    manifestPath(installRoot),
  ].map((path) => resolve(path));
}
