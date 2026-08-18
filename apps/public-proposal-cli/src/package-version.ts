import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PackageVersionResolver } from "./contracts.js";

export function createPackageVersionResolver(
  packageRoot: string,
  readFile: (path: string) => Promise<string>,
): PackageVersionResolver {
  const packageRequire = createRequire(join(packageRoot, "package.json"));
  return async (packageName) => {
    const candidates = [
      join(packageRoot, "node_modules", packageName, "package.json"),
      join(packageRoot, "..", "..", "node_modules", packageName, "package.json"),
      join(packageRoot, "..", "..", packageName, "package.json"),
    ];
    for (const candidate of candidates) {
      const version = await readPackageJsonVersion(candidate, readFile);
      if (version !== null) return version;
    }

    try {
      const packageJsonEntry = packageRequire.resolve(`${packageName}/package.json`);
      const version = await readPackageJsonVersion(packageJsonEntry, readFile);
      if (version !== null) return version;
    } catch {
      // Some packages do not export package.json; fall back to their executable entry.
    }

    try {
      const entry = packageRequire.resolve(packageName);
      let directory = dirname(entry);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const version = await readPackageJsonVersion(join(directory, "package.json"), readFile);
        if (version !== null) return version;
        directory = dirname(directory);
      }
    } catch {
      // The package may be available only as a command; the caller will report that separately.
    }
    return null;
  };
}

async function readPackageJsonVersion(
  path: string,
  readFile: (path: string) => Promise<string>,
): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(path)) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}
