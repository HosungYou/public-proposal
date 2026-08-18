import { join } from "node:path";
import type { InstallManifest } from "../contracts.js";
import { readManifestJson, isProtectedPath } from "../installation-manifest.js";
import { manifestPath } from "../paths.js";
import { nodeFs } from "../process.js";

export interface UninstallDependencies {
  readonly readManifest?: (path: string) => Promise<InstallManifest & { ownedPaths: readonly string[] }>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly remove: (path: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
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

  for (const ownedPath of manifest.ownedPaths) {
    if (!isInstallerOwned(installRoot, ownedPath) || isProtectedPath(ownedPath)) {
      preserved.push(ownedPath);
      continue;
    }
    if (await dependencies.exists(ownedPath)) {
      await dependencies.remove(ownedPath);
      removed.push(ownedPath);
    }
  }

  return { removed, preserved };
}

function defaultUninstallDependencies(): UninstallDependencies {
  return {
    exists: nodeFs.exists,
    readFile: nodeFs.readFile,
    remove: nodeFs.remove,
  };
}

function isInstallerOwned(installRoot: string, ownedPath: string): boolean {
  const allowedRoots = [
    join(installRoot, "plugin"),
    join(installRoot, "marketplace"),
    join(installRoot, "codex-skills"),
    join(installRoot, "worker"),
  ];
  return allowedRoots.some((root) => ownedPath === root || ownedPath.startsWith(`${root}/`));
}
