import { join, resolve } from "node:path";
import { PublicProposalContractError, type InstallManifest } from "../contracts.js";
import { readManifestJson, isProtectedPath } from "../installation-manifest.js";
import { manifestPath } from "../paths.js";
import { nodeFs } from "../process.js";

export interface UninstallDependencies {
  readonly readManifest?: (path: string) => Promise<InstallManifest & { ownedPaths: readonly string[] }>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly remove: (path: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly realpath?: (path: string) => Promise<string>;
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
      await dependencies.remove(normalized);
      removed.push(normalized);
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
  };
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
