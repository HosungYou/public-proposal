import { join } from "node:path";

export interface PackagedMarketplaceManifest {
  readonly path: string;
  readonly contents: string;
}

export async function readPackagedMarketplaceManifest(
  packageRoot: string,
  readFile: (path: string) => Promise<string>,
): Promise<PackagedMarketplaceManifest> {
  let lastError: unknown;
  for (const path of packagedMarketplaceManifestPaths(packageRoot)) {
    try {
      return { path, contents: await readFile(path) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Packaged marketplace manifest is missing under ${packageRoot}.`);
}

export function packagedMarketplaceManifestPaths(packageRoot: string): readonly string[] {
  return [
    join(packageRoot, "marketplace", ".agents", "plugins", "marketplace.json"),
    join(packageRoot, "marketplace", "marketplace.json"),
  ];
}
