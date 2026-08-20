import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(repositoryRoot, "workers", "docx-python");
const packageRoot = join(repositoryRoot, "apps", "public-proposal-cli", "worker");
const checkOnly = process.argv.slice(2).includes("--check");
const unsupportedArguments = process.argv.slice(2).filter((argument) => argument !== "--check");
const generatedReadme = [
  "# Managed KPP DOCX Worker Snapshot",
  "",
  "This directory is generated from `workers/docx-python` during package build.",
  "It intentionally excludes virtual environments, caches, test bytecode, and local machine paths.",
  "",
].join("\n");

const required = [
  "pyproject.toml",
  "uv.lock",
  join("src", "kpp_docx", "protocol.py"),
  join("src", "kpp_docx", "build.py"),
  join("assets", "Korean Public Proposal A4 v1.docx"),
];

if (unsupportedArguments.length > 0) {
  throw new Error(`Unsupported worker snapshot arguments: ${unsupportedArguments.join(", ")}`);
}

await verifySource();
if (checkOnly) {
  await assertSnapshotParity();
  console.log("Worker snapshot parity verified.");
} else {
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  await cp(sourceRoot, packageRoot, {
    recursive: true,
    force: false,
    filter: (path) => includePath(path),
  });
  await writeFile(join(packageRoot, "README.md"), generatedReadme, "utf8");
  await assertSnapshotParity();
  console.log("Worker snapshot synchronized and parity verified.");
}

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
  return !isExcludedRelativePath(segment);
}

async function assertSnapshotParity() {
  await assertNoExcludedArtifacts(packageRoot);
  const sourceFiles = await listIncludedFiles(sourceRoot);
  const packageFiles = await listIncludedFiles(packageRoot);
  const expectedPackageFiles = [...sourceFiles, "README.md"].sort();
  if (!samePaths(expectedPackageFiles, packageFiles)) {
    const missing = expectedPackageFiles.filter((path) => !packageFiles.includes(path));
    const unexpected = packageFiles.filter((path) => !expectedPackageFiles.includes(path));
    throw new Error(`Worker snapshot drift: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`);
  }

  for (const path of sourceFiles) {
    const [source, snapshot] = await Promise.all([
      readFile(join(sourceRoot, path)),
      readFile(join(packageRoot, path)),
    ]);
    if (!source.equals(snapshot)) {
      throw new Error(`Worker snapshot drift: byte mismatch for ${path}`);
    }
  }

  const snapshotReadme = await readFile(join(packageRoot, "README.md"), "utf8");
  if (snapshotReadme !== generatedReadme) {
    throw new Error("Worker snapshot drift: generated README.md does not match the managed provenance.");
  }
}

async function listIncludedFiles(root, relativeRoot = "") {
  const currentRoot = relativeRoot.length > 0 ? join(root, relativeRoot) : root;
  const entries = await readdir(currentRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(`Worker snapshot drift: missing snapshot directory ${root}`);
    }
    throw error;
  });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = relativeRoot.length > 0 ? join(relativeRoot, entry.name) : entry.name;
    if (isExcludedRelativePath(path)) return [];
    if (entry.isDirectory()) return listIncludedFiles(root, path);
    return entry.isFile() ? [path] : [];
  }));
  return paths.flat().sort();
}

function samePaths(left, right) {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function isExcludedRelativePath(path) {
  const parts = path.split(sep);
  return parts.some((part) => (
    part === ".venv" ||
    part === ".pytest_cache" ||
    part === "__pycache__" ||
    part === ".DS_Store" ||
    part === "tests" ||
    part.endsWith(".pyc")
  ));
}

async function assertNoExcludedArtifacts(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (
      entry.name === ".venv" ||
      entry.name === ".pytest_cache" ||
      entry.name === "__pycache__" ||
      entry.name === ".DS_Store" ||
      entry.name === "tests" ||
      entry.name.endsWith(".pyc")
    ) {
      throw new Error(`Excluded worker artifact copied: ${path}`);
    }
    if (entry.isDirectory()) await assertNoExcludedArtifacts(path);
  }
}
