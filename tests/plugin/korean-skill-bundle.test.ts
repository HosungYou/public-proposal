import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const validatorPath = join(process.cwd(), "scripts", "validate_korean_skill_bundle.py");
const syncScriptPath = join(process.cwd(), "scripts", "sync_public_proposal_package_assets.mjs");
const sourcePluginRoot = join(process.cwd(), "plugins", "public-proposal");
const packagedPluginRoot = join(process.cwd(), "apps", "public-proposal-cli", "plugin");
const packagedMarketplacePath = join(
  process.cwd(),
  "apps",
  "public-proposal-cli",
  "marketplace",
  ".agents",
  "plugins",
  "marketplace.json",
);
const tempDirectories: string[] = [];
const absoluteLeakFixtures = [
  "Payload leak: source:/tmp/public-proposal/source.md",
  "Payload leak: file:///tmp/public-proposal/source.md",
  "Payload leak: /tmp",
];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

test("the public proposal plugin ships a validated package copy and rewrites the packaged marketplace source", async () => {
  await expect(runValidator(sourcePluginRoot)).resolves.toContain("validation passed");
  await expect(runValidator(packagedPluginRoot)).resolves.toContain("validation passed");

  const sourceMarketplace = parseJson(await readFile(".agents/plugins/marketplace.json", "utf8")) as {
    plugins: Array<{ name: string; source: { path: string } }>;
  };
  const packagedMarketplace = parseJson(await readFile(packagedMarketplacePath, "utf8")) as {
    plugins: Array<{ name: string; source: { path: string } }>;
  };
  expect(sourceMarketplace.plugins).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "public-proposal", source: { path: "./plugins/public-proposal" } }),
    ]),
  );
  expect(packagedMarketplace.plugins).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "public-proposal", source: { source: "local", path: "./plugin" } }),
    ]),
  );

  const sourceManifest = await readBundleManifest(sourcePluginRoot);
  const packagedManifest = await readBundleManifest(packagedPluginRoot);
  expect(packagedManifest).toEqual(sourceManifest);

  const sourceFiles = await listFilesRecursive(sourcePluginRoot);
  const packagedFiles = await listFilesRecursive(packagedPluginRoot);
  expect(packagedFiles).toEqual(sourceFiles);

  for (const relativePath of sourceFiles) {
    const [sourcePayload, packagedPayload] = await Promise.all([
      readFile(join(sourcePluginRoot, relativePath)),
      readFile(join(packagedPluginRoot, relativePath)),
    ]);
    expect(packagedPayload.equals(sourcePayload), `payload mismatch for ${relativePath}`).toBe(true);
  }

  for (const entry of sourceManifest.files) {
    const packagedFile = join(packagedPluginRoot, "skills", "korean-public-proposal", entry.path);
    const packagedPayload = await readFile(packagedFile);
    expect(sha256(packagedPayload)).toBe(entry.sha256);
    expect(packagedPayload.byteLength).toBe(entry.bytes);
  }
});

test("the bundle validator rejects generic absolute source path leaks in bundle payloads", async () => {
  const pluginRoot = await clonePluginRoot();
  const relativePath = "SKILL.md";
  const filePath = join(pluginRoot, "skills", "korean-public-proposal", relativePath);
  const original = await readFile(filePath, "utf8");
  const leaked = [original.trimEnd(), "", ...absoluteLeakFixtures, ""].join("\n");
  await writeFile(filePath, leaked, "utf8");
  await updateManifestEntry(pluginRoot, relativePath, leaked);

  await expect(runValidator(pluginRoot)).rejects.toThrow(/absolute source path/i);
});

test("the package sync rejects generic absolute source path leaks outside the bundled Korean skill", async () => {
  const repoRoot = await cloneSyncFixtureRepo();
  const publicSkillPath = join(repoRoot, "plugins", "public-proposal", "skills", "public-proposal", "SKILL.md");
  const original = await readFile(publicSkillPath, "utf8");
  const leaked = [original.trimEnd(), "", ...absoluteLeakFixtures, ""].join("\n");
  await writeFile(publicSkillPath, leaked, "utf8");

  await expect(runSync(repoRoot)).rejects.toThrow(/absolute source path/i);
});

test("the bundle validator rejects windows-style absolute manifest paths even when the file exists", async () => {
  const pluginRoot = await clonePluginRoot();
  const bundleRoot = join(pluginRoot, "skills", "korean-public-proposal");
  const originalPath = "references/page-contract.md";
  const absoluteLookingPath = "C:\\Users\\example\\page-contract.md";

  await rename(join(bundleRoot, originalPath), join(bundleRoot, absoluteLookingPath));
  await rewriteManifestPath(pluginRoot, originalPath, absoluteLookingPath);

  await expect(runValidator(pluginRoot)).rejects.toThrow(/absolute source path|relative path inside the bundle/i);
});

async function clonePluginRoot(): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "public-proposal-plugin-"));
  tempDirectories.push(tempRoot);
  const pluginRoot = join(tempRoot, "public-proposal");
  await cp(sourcePluginRoot, pluginRoot, { recursive: true });
  return pluginRoot;
}

async function cloneSyncFixtureRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "public-proposal-sync-"));
  tempDirectories.push(repoRoot);
  await Promise.all([
    mkdir(join(repoRoot, "scripts"), { recursive: true }),
    mkdir(join(repoRoot, "plugins"), { recursive: true }),
    mkdir(join(repoRoot, "apps", "public-proposal-cli", "plugin"), { recursive: true }),
    mkdir(join(repoRoot, "apps", "public-proposal-cli", "marketplace"), { recursive: true }),
  ]);
  await Promise.all([
    cp(sourcePluginRoot, join(repoRoot, "plugins", "public-proposal"), { recursive: true }),
    cp(validatorPath, join(repoRoot, "scripts", "validate_korean_skill_bundle.py")),
    cp(syncScriptPath, join(repoRoot, "scripts", "sync_public_proposal_package_assets.mjs")),
  ]);
  return repoRoot;
}

async function readBundleManifest(pluginRoot: string): Promise<BundleManifest> {
  const manifestPath = join(pluginRoot, "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  return parseJson(await readFile(manifestPath, "utf8")) as BundleManifest;
}

async function updateManifestEntry(pluginRoot: string, relativePath: string, contents: string): Promise<void> {
  const manifestPath = join(pluginRoot, "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const manifest = await readBundleManifest(pluginRoot);
  const entry = manifest.files.find((candidate) => candidate.path === relativePath);
  if (!entry) {
    throw new Error(`missing manifest entry for ${relativePath}`);
  }
  const payload = Buffer.from(contents, "utf8");
  entry.bytes = payload.byteLength;
  entry.sha256 = sha256(payload);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function rewriteManifestPath(pluginRoot: string, originalPath: string, replacementPath: string): Promise<void> {
  const manifestPath = join(pluginRoot, "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const manifest = await readBundleManifest(pluginRoot);
  const entry = manifest.files.find((candidate) => candidate.path === originalPath);
  if (!entry) {
    throw new Error(`missing manifest entry for ${originalPath}`);
  }
  entry.path = replacementPath;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function runValidator(pluginRoot: string): Promise<string> {
  try {
    const result = await execFile("python3", [validatorPath, pluginRoot], { cwd: process.cwd() });
    return `${result.stdout}${result.stderr}`;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(`${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim());
  }
}

async function runSync(repoRoot: string): Promise<string> {
  try {
    const result = await execFile("node", [join(repoRoot, "scripts", "sync_public_proposal_package_assets.mjs")], {
      cwd: repoRoot,
    });
    return `${result.stdout}${result.stderr}`;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(`${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim());
  }
}

function parseJson(source: string): unknown {
  return JSON.parse(source) as unknown;
}

function sha256(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

async function listFilesRecursive(root: string, baseRoot: string = root): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(path, baseRoot);
      }
      if (entry.isFile()) {
        return [path.slice(baseRoot.length + 1)];
      }
      return [];
    }),
  );
  return files.flat().sort();
}

interface BundleManifest {
  files: BundleEntry[];
}

interface BundleEntry {
  path: string;
  bytes: number;
  sha256: string;
}
