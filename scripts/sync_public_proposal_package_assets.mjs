import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const validatorPath = join(scriptDirectory, "validate_korean_skill_bundle.py");
const sourcePluginRoot = join(repositoryRoot, "plugins", "public-proposal");
const packagedPluginRoot = join(repositoryRoot, "apps", "public-proposal-cli", "plugin");
const packagedMarketplaceRoot = join(repositoryRoot, "apps", "public-proposal-cli", "marketplace");
const packagedMarketplacePath = join(packagedMarketplaceRoot, ".agents", "plugins", "marketplace.json");
const uriTokenPattern = /[A-Za-z][A-Za-z0-9+.-]*:[^\s"'`<>|]+/g;
const windowsDriveTokenPattern = /(?:(?<=^)|(?<=[\s"'`(=,\[]))[A-Za-z]:[\\/][^\s"'`<>|]+/g;
const uncTokenPattern = /(?:(?<=^)|(?<=[\s"'`(=,\[]))\\\\[^\s"'`<>|]+/g;
const posixTokenPattern = /(?:(?<=^)|(?<=[\s"'`(=,\[]))\/(?!\/)[^\s"'`<>|]+/g;
const knownPosixRoots = new Set([
  "/bin",
  "/etc",
  "/home",
  "/Library",
  "/opt",
  "/private",
  "/sbin",
  "/tmp",
  "/Users",
  "/usr",
  "/var",
  "/Volumes",
]);

runValidator(sourcePluginRoot);
replaceDirectory(sourcePluginRoot, packagedPluginRoot);
runValidator(packagedPluginRoot);

rmSync(packagedMarketplaceRoot, { force: true, recursive: true });
mkdirSync(dirname(packagedMarketplacePath), { recursive: true });
writeFileSync(packagedMarketplacePath, `${JSON.stringify(buildMarketplace("./plugin"), null, 2)}\n`, "utf8");
assertNoAbsoluteSourceMarkers(packagedMarketplacePath);
assertRelativePluginSource(packagedMarketplacePath, "./plugin");

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
    interface: {
      displayName: "Public Proposal",
    },
    plugins: [
      {
        name: "public-proposal",
        source: {
          source: "local",
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
  if (!isTextFilePath(filePath)) {
    return;
  }
  const payload = readFileSync(filePath);
  const text = payload.toString("utf8");
  for (const token of extractAbsolutePathTokens(text)) {
    throw new Error(`Absolute source path ${token} found in ${filePath}`);
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

function isAbsolutePathLike(value) {
  if (!value) {
    return false;
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return true;
  }
  if (value.startsWith("\\\\")) {
    return true;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  return !value.startsWith("//");
}

function isTextFilePath(filePath) {
  return new Set([".css", ".json", ".md", ".mjs", ".py", ".txt"]).has(extname(filePath));
}

function extractAbsolutePathTokens(text) {
  const matches = [];
  for (const pattern of [uriTokenPattern, windowsDriveTokenPattern, uncTokenPattern, posixTokenPattern]) {
    const candidates = text.match(pattern) ?? [];
    for (const candidate of candidates) {
      if (isAbsolutePathReference(candidate)) {
        matches.push(candidate);
      }
    }
  }
  return [...new Set(matches)];
}

function isAbsolutePathReference(value) {
  if (!value) {
    return false;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return false;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      const separatorIndex = value.indexOf(":");
      return isFilesystemAbsolutePath(value.slice(separatorIndex + 1));
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return false;
    }
    if (parsed.protocol === "file:") {
      if (parsed.host && parsed.pathname) {
        return isFilesystemAbsolutePath(`//${parsed.host}${decodeURIComponent(parsed.pathname)}`);
      }
      return isFilesystemAbsolutePath(decodeURIComponent(parsed.pathname || parsed.host));
    }
    return isFilesystemAbsolutePath(value.slice(value.indexOf(":") + 1));
  }
  return isFilesystemAbsolutePath(value);
}

function isFilesystemAbsolutePath(value) {
  if (!value) {
    return false;
  }
  if (value.startsWith("\\\\")) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return true;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  if (value.startsWith("//")) {
    return true;
  }
  const normalized = value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value;
  return knownPosixRoots.has(normalized) || normalized.includes("/", 1);
}
