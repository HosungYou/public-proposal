import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const validatorPath = join(process.cwd(), "scripts", "validate_korean_skill_bundle.py");
const sourcePluginRoot = join(process.cwd(), "plugins", "public-proposal");
const packagedPluginRoot = join(process.cwd(), "apps", "public-proposal-cli", "plugin");
const packagedMarketplacePath = join(process.cwd(), "apps", "public-proposal-cli", "marketplace", "marketplace.json");
const tempDirectories: string[] = [];

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
      expect.objectContaining({ name: "public-proposal", source: { path: "../plugin" } }),
    ]),
  );

  const sourceManifest = await readBundleManifest(sourcePluginRoot);
  const packagedManifest = await readBundleManifest(packagedPluginRoot);
  expect(packagedManifest).toEqual(sourceManifest);

  for (const entry of sourceManifest.files) {
    const sourceFile = join(sourcePluginRoot, "skills", "korean-public-proposal", entry.path);
    const packagedFile = join(packagedPluginRoot, "skills", "korean-public-proposal", entry.path);
    const [sourcePayload, packagedPayload] = await Promise.all([readFile(sourceFile), readFile(packagedFile)]);
    expect(packagedPayload.equals(sourcePayload), `payload mismatch for ${entry.path}`).toBe(true);
    expect(sha256(packagedPayload)).toBe(entry.sha256);
    expect(packagedPayload.byteLength).toBe(entry.bytes);
  }
});

test("the bundle validator rejects generic absolute source path leaks in bundle payloads", async () => {
  const pluginRoot = await clonePluginRoot();
  const relativePath = "SKILL.md";
  const filePath = join(pluginRoot, "skills", "korean-public-proposal", relativePath);
  const original = await readFile(filePath, "utf8");
  const leaked = [
    original.trimEnd(),
    "",
    "Payload leak: /tmp/public-proposal/source.md",
    "Payload leak: /Users/example/source.md",
    "Payload leak: C:\\\\Users\\\\example\\\\source.md",
    "",
  ].join("\n");
  await writeFile(filePath, leaked, "utf8");
  await updateManifestEntry(pluginRoot, relativePath, leaked);

  await expect(runValidator(pluginRoot)).rejects.toThrow(/absolute source path/i);
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

function parseJson(source: string): unknown {
  return JSON.parse(source) as unknown;
}

function sha256(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

interface BundleManifest {
  files: BundleEntry[];
}

interface BundleEntry {
  path: string;
  bytes: number;
  sha256: string;
}
