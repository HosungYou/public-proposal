import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const validatorPath = join(scriptDirectory, "validate_korean_skill_bundle.py");
const sourcePluginRoot = join(repositoryRoot, "plugins", "public-proposal");
const packagedPluginRoot = join(repositoryRoot, "apps", "public-proposal-cli", "plugin");
const packagedMarketplaceRoot = join(repositoryRoot, "apps", "public-proposal-cli", "marketplace");
const packagedMarketplacePath = join(packagedMarketplaceRoot, "marketplace.json");
const absoluteSourceMarkers = [
  "/Users/hosung/.codex/skills/korean-public-proposal",
  "/Users/hosung/.codex/skills",
];

runValidator(sourcePluginRoot);
replaceDirectory(sourcePluginRoot, packagedPluginRoot);
runValidator(packagedPluginRoot);

rmSync(packagedMarketplaceRoot, { force: true, recursive: true });
mkdirSync(packagedMarketplaceRoot, { recursive: true });
writeFileSync(packagedMarketplacePath, `${JSON.stringify(buildMarketplace("../plugin"), null, 2)}\n`, "utf8");
assertNoAbsoluteSourceMarkers(packagedMarketplacePath);
assertRelativePluginSource(packagedMarketplacePath, "../plugin");

console.log(`Packaged public-proposal plugin copied to ${packagedPluginRoot}`);
console.log(`Packaged marketplace manifest written to ${packagedMarketplacePath}`);

function runValidator(pluginRoot) {
  const result = spawnSync("python3", [validatorPath, pluginRoot], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Bundle validation failed for ${pluginRoot}`);
  }

  process.stdout.write(result.stdout ?? "");
}

function replaceDirectory(source, target) {
  rmSync(target, { force: true, recursive: true });
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(target, entry), { recursive: true });
  }
  walkFiles(target, assertNoAbsoluteSourceMarkers);
}

function buildMarketplace(pluginPath) {
  return {
    name: "public-proposal",
    plugins: [
      {
        name: "public-proposal",
        source: {
          path: pluginPath,
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL",
        },
        category: "Productivity",
      },
    ],
  };
}

function assertRelativePluginSource(marketplacePath, expectedPath) {
  const manifest = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const entry = manifest.plugins?.find((plugin) => plugin?.name === "public-proposal");
  if (entry?.source?.path !== expectedPath) {
    throw new Error(`Packaged marketplace source path must equal ${expectedPath}`);
  }
}

function assertNoAbsoluteSourceMarkers(filePath) {
  const payload = readFileSync(filePath);
  for (const marker of absoluteSourceMarkers) {
    if (payload.includes(marker)) {
      throw new Error(`Absolute source path marker ${marker} found in ${filePath}`);
    }
  }
}

function walkFiles(root, visit) {
  for (const entry of readdirSync(root)) {
    const entryPath = join(root, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      walkFiles(entryPath, visit);
      continue;
    }
    if (stats.isFile()) {
      visit(entryPath);
    }
  }
}
