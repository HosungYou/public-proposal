import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(repositoryRoot, "workers", "docx-python");
const packageRoot = join(repositoryRoot, "apps", "public-proposal-cli", "worker");

const required = [
  "pyproject.toml",
  "uv.lock",
  join("src", "kpp_docx", "protocol.py"),
  join("src", "kpp_docx", "build.py"),
  join("assets", "Korean Public Proposal A4 v1.docx"),
];

await verifySource();
await rm(packageRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });
await cp(sourceRoot, packageRoot, {
  recursive: true,
  force: false,
  filter: (path) => includePath(path),
});
await writeFile(
  join(packageRoot, "README.md"),
  [
    "# Managed KPP DOCX Worker Snapshot",
    "",
    "This directory is generated from `workers/docx-python` during package build.",
    "It intentionally excludes virtual environments, caches, test bytecode, and local machine paths.",
    "",
  ].join("\n"),
  "utf8",
);

async function verifySource() {
  for (const path of required) {
    const fullPath = join(sourceRoot, path);
    const metadata = await stat(fullPath).catch(() => undefined);
    if (metadata === undefined) {
      throw new Error(`Missing worker source file: ${path}`);
    }
  }
  const pyproject = await readFile(join(sourceRoot, "pyproject.toml"), "utf8");
  const lock = await readFile(join(sourceRoot, "uv.lock"), "utf8");
  if (!pyproject.includes("kpp-docx-worker") || lock.trim().length === 0) {
    throw new Error("Worker snapshot requires kpp-docx-worker pyproject.toml and uv.lock.");
  }
}

function includePath(path) {
  const segment = relative(sourceRoot, path);
  if (segment.length === 0) return true;
  const parts = segment.split(sep);
  if (parts.some((part) => (
    part === ".venv" ||
    part === ".pytest_cache" ||
    part === "__pycache__" ||
    part === ".DS_Store" ||
    part.endsWith(".pyc")
  ))) {
    return false;
  }
  if (parts[0] === "tests") return false;
  return true;
}

await assertNoExcludedArtifacts(packageRoot);

async function assertNoExcludedArtifacts(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (
      entry.name === ".venv" ||
      entry.name === ".pytest_cache" ||
      entry.name === "__pycache__" ||
      entry.name.endsWith(".pyc")
    ) {
      throw new Error(`Excluded worker artifact copied: ${path}`);
    }
    if (entry.isDirectory()) await assertNoExcludedArtifacts(path);
  }
}
