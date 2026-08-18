import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PackageVersionResolver } from "./contracts.js";

const require = createRequire(import.meta.url);

export function createPackageVersionResolver(
  packageRoot: string,
  readFile: (path: string) => Promise<string>,
): PackageVersionResolver {
  return async (packageName) => {
    const candidates = [
      join(packageRoot, "node_modules", packageName, "package.json"),
      join(packageRoot, "..", "..", "node_modules", packageName, "package.json"),
    ];
    for (const candidate of candidates) {
      const version = await readPackageJsonVersion(candidate, readFile);
      if (version !== null) return version;
    }

    try {
      const entry = require.resolve(packageName);
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
