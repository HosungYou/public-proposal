import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const repositoryRoot = process.cwd();
const workerSyncScript = join(repositoryRoot, "scripts", "sync_public_proposal_worker.mjs");
const sourceWorkerRoot = join(repositoryRoot, "workers", "docx-python");
const packagedWorkerRoot = join(repositoryRoot, "apps", "public-proposal-cli", "worker");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("worker snapshot check rejects generated package drift without repairing it", async () => {
  const fixture = await createWorkerFixture();
  const packagedLock = join(fixture.packagedWorkerRoot, "uv.lock");
  await writeFile(packagedLock, "stale generated lock\n", "utf8");

  await expect(runWorkerSync(fixture.repoRoot, "--check")).rejects.toThrow(/Worker snapshot drift/i);
  await expect(readFile(packagedLock, "utf8")).resolves.toBe("stale generated lock\n");
});

test("worker sync rebuilds every managed worker payload and check verifies bytes", async () => {
  const fixture = await createWorkerFixture();
  await writeFile(join(fixture.sourceWorkerRoot, "src", "kpp_docx", "protocol.py"), "SOURCE DRIFT\n", "utf8");

  await expect(runWorkerSync(fixture.repoRoot, "--check")).rejects.toThrow(/Worker snapshot drift/i);
  await expect(runWorkerSync(fixture.repoRoot)).resolves.toContain("Worker snapshot synchronized and parity verified");
  await expect(runWorkerSync(fixture.repoRoot, "--check")).resolves.toContain("Worker snapshot parity verified");

  const sourceFiles = await listManagedWorkerFiles(fixture.sourceWorkerRoot);
  const packagedFiles = await listManagedWorkerFiles(fixture.packagedWorkerRoot);
  expect(packagedFiles.filter((path) => path !== "README.md")).toEqual(sourceFiles);
  expect(packagedFiles).toContain("README.md");

  for (const relativePath of sourceFiles) {
    const [source, packaged] = await Promise.all([
      readFile(join(fixture.sourceWorkerRoot, relativePath)),
      readFile(join(fixture.packagedWorkerRoot, relativePath)),
    ]);
    expect(packaged.equals(source), `worker payload mismatch for ${relativePath}`).toBe(true);
  }

  for (const relativePath of ["uv.lock", "assets/PROVENANCE.md"]) {
    const [source, packaged] = await Promise.all([
      readFile(join(fixture.sourceWorkerRoot, relativePath)),
      readFile(join(fixture.packagedWorkerRoot, relativePath)),
    ]);
    expect(packaged.equals(source), `generated snapshot must retain ${relativePath}`).toBe(true);
  }
});

async function createWorkerFixture(): Promise<{ repoRoot: string; sourceWorkerRoot: string; packagedWorkerRoot: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "public-proposal-worker-snapshot-"));
  temporaryRoots.push(repoRoot);
  const sourceRoot = join(repoRoot, "workers", "docx-python");
  const packageRoot = join(repoRoot, "apps", "public-proposal-cli", "worker");
  await Promise.all([
    mkdir(join(repoRoot, "scripts"), { recursive: true }),
    mkdir(join(repoRoot, "workers"), { recursive: true }),
    mkdir(join(repoRoot, "apps", "public-proposal-cli"), { recursive: true }),
  ]);
  await Promise.all([
    cp(workerSyncScript, join(repoRoot, "scripts", "sync_public_proposal_worker.mjs")),
    cp(sourceWorkerRoot, sourceRoot, { recursive: true }),
    cp(packagedWorkerRoot, packageRoot, { recursive: true }),
  ]);
  return { repoRoot, sourceWorkerRoot: sourceRoot, packagedWorkerRoot: packageRoot };
}

async function runWorkerSync(repoRoot: string, ...arguments_: string[]): Promise<string> {
  try {
    const result = await execFile("node", [join(repoRoot, "scripts", "sync_public_proposal_worker.mjs"), ...arguments_], {
      cwd: repoRoot,
    });
    return `${result.stdout}${result.stderr}`;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(`${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim());
  }
}

async function listManagedWorkerFiles(root: string, relativeRoot = ""): Promise<string[]> {
  const currentRoot = relativeRoot ? join(root, relativeRoot) : root;
  const entries = await readdir(currentRoot, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (isExcludedWorkerPath(relativePath)) return [];
    if (entry.isDirectory()) return listManagedWorkerFiles(root, relativePath);
    return entry.isFile() ? [relativePath] : [];
  }));
  return paths.flat().sort();
}

function isExcludedWorkerPath(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => (
    segment === ".venv" ||
    segment === ".pytest_cache" ||
    segment === "__pycache__" ||
    segment === ".DS_Store" ||
    segment === "tests" ||
    segment.endsWith(".pyc")
  ));
}
