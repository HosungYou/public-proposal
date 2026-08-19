import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { KppError } from "./errors.js";
import { initializeProject, persistProjectState, projectPath, readProject } from "./project-store.js";

const ADOPTION_SCHEMA = "kpp-adoption/v1";
const ADOPTION_RECEIPT = join("receipts", "adoption.json");
const LEDGER_NAMES = new Set(["claim-ledger.json", "evidence-ledger.json", "figure-ledger.json"]);
const SOURCE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".hwp", ".hwpx", ".xlsx", ".xls", ".csv", ".json", ".md", ".txt"]);
const CONTENT_EXTENSIONS = new Set([".doc", ".docx", ".hwp", ".hwpx", ".md", ".txt"]);

export interface AdoptionInput {
  readonly root: string;
  readonly outputRoot?: string;
  readonly source?: string;
  readonly master?: string;
}

export interface AdoptionBinding {
  readonly role: "rfp" | "source_packet" | "working_master" | "claim_ledger" | "evidence_ledger" | "figure_ledger" | "living_brief" | "longtable_run" | "provisional_content";
  readonly originalPath: string;
  readonly sha256: string;
  readonly importedPath?: string;
}

export interface ProvisionalContent {
  readonly originalPath: string;
  readonly sha256: string;
  readonly status: "provisional";
  readonly reason: "no_source_binding";
}

export interface LongTableRunLink {
  readonly path: string;
  readonly status: "legacy_readable";
}

export interface AdoptionReport {
  readonly schemaVersion: typeof ADOPTION_SCHEMA;
  readonly adoptionId: string;
  readonly state: "UNMANAGED_DRAFT";
  readonly projectRoot: string;
  readonly legacyRoot: string;
  readonly changed: boolean;
  readonly candidates: {
    readonly rfp: readonly string[];
    readonly sourcePacket: readonly string[];
    readonly workingMaster: string | null;
  };
  readonly imports: readonly AdoptionBinding[];
  readonly provisionalContent: readonly ProvisionalContent[];
  readonly longtableRuns: readonly LongTableRunLink[];
  readonly livingBrief?: {
    readonly candidatePath: string;
    readonly decisionDiffPath: string;
  };
}

interface AdoptionReceipt extends AdoptionReport {
  readonly inputs: readonly AdoptionBinding[];
  readonly outputs: readonly string[];
  readonly inputDigest: string;
}

export async function adoptProject(input: AdoptionInput): Promise<AdoptionReport> {
  const legacyRoot = resolve(input.root);
  const projectRoot = resolve(input.outputRoot ?? input.root);
  await requireDirectory(legacyRoot);
  const receiptPath = join(projectRoot, ADOPTION_RECEIPT);
  const previous = await readAdoptionReceipt(receiptPath);
  const excludedOutputs = new Set(previous?.outputs.map((path) => resolve(path)) ?? []);
  const discovered = await discoverInputs(legacyRoot, projectRoot, input, excludedOutputs);
  const inputDigest = digestBindings(discovered.inputs);

  if (previous) {
    if (previous.inputDigest === inputDigest) {
      return { ...stripReceipt(previous), changed: false };
    }
    throw new KppError("KPP_ADOPTION_INPUT_CHANGED", "기존 adopt 입력이 변경되어 자동 덮어쓰기를 중단했습니다.", {
      path: receiptPath,
      expected: previous.inputDigest,
      actual: inputDigest,
      changed: changedBindings(previous.inputs, discovered.inputs),
    });
  }

  if (await pathExists(projectPath(projectRoot))) {
    throw new KppError("KPP_INPUT_PROJECT_EXISTS", "KPP 상태가 있는 프로젝트는 adopt로 덮어쓸 수 없습니다.", {
      path: projectPath(projectRoot),
    });
  }

  const outputs: string[] = [];
  const imports: AdoptionBinding[] = [];
  const project = await initializeProject(projectRoot, {
    projectId: safeProjectId(basename(projectRoot) || basename(legacyRoot)),
  });
  outputs.push(projectPath(projectRoot));
  await persistProjectState(projectRoot, { ...project, state: "UNMANAGED_DRAFT" });

  for (const binding of discovered.inputs) {
    const destination = importDestination(projectRoot, binding);
    if (destination === null) continue;
    await copyAtomically(binding.originalPath, destination);
    outputs.push(destination);
    imports.push({ ...binding, importedPath: destination });
  }

  const longtablePath = join(projectRoot, "evidence", "legacy-longtable-links.json");
  if (discovered.longtableRuns.length > 0) {
    await writeJsonAtomically(longtablePath, {
      schemaVersion: "legacy-longtable-links/v1",
      runs: discovered.longtableRuns,
    });
    outputs.push(longtablePath);
  }

  const provisionalPath = join(projectRoot, "content", "provisional-content.json");
  if (discovered.provisionalContent.length > 0) {
    await writeJsonAtomically(provisionalPath, {
      schemaVersion: "provisional-content/v1",
      entries: discovered.provisionalContent,
    });
    outputs.push(provisionalPath);
  }

  let livingBrief: AdoptionReport["livingBrief"];
  const briefBinding = discovered.inputs.find(({ role }) => role === "living_brief");
  if (briefBinding) {
    const candidatePath = join(projectRoot, "brief", "living-brief-candidate.json");
    const decisionDiffPath = join(projectRoot, "brief", "living-brief-decision-diff.json");
    if (!outputs.includes(candidatePath)) {
      await copyAtomically(briefBinding.originalPath, candidatePath);
      outputs.push(candidatePath);
    }
    const brief = await readLooseJson(briefBinding.originalPath);
    await writeJsonAtomically(decisionDiffPath, decisionDiff(brief));
    outputs.push(decisionDiffPath);
    livingBrief = { candidatePath, decisionDiffPath };
  }

  const report: AdoptionReport = {
    schemaVersion: ADOPTION_SCHEMA,
    adoptionId: randomUUID(),
    state: "UNMANAGED_DRAFT",
    projectRoot,
    legacyRoot,
    changed: true,
    candidates: discovered.candidates,
    imports,
    provisionalContent: discovered.provisionalContent,
    longtableRuns: discovered.longtableRuns,
    ...(livingBrief ? { livingBrief } : {}),
  };
  const receipt: AdoptionReceipt = {
    ...report,
    inputs: discovered.inputs,
    outputs: [...outputs, receiptPath],
    inputDigest,
  };
  await writeJsonAtomically(receiptPath, receipt);
  return report;
}

async function discoverInputs(
  legacyRoot: string,
  projectRoot: string,
  input: AdoptionInput,
  excludedOutputs: ReadonlySet<string>,
): Promise<{
  candidates: AdoptionReport["candidates"];
  inputs: AdoptionBinding[];
  provisionalContent: ProvisionalContent[];
  longtableRuns: LongTableRunLink[];
}> {
  const outputInsideLegacy = projectRoot !== legacyRoot && isWithin(legacyRoot, projectRoot);
  const files = (await walkFiles(legacyRoot)).filter((path) =>
    !excludedOutputs.has(resolve(path))
    && basename(path) !== "kpp.project.yaml"
    && !isTemporary(path)
    && !(outputInsideLegacy && isWithin(projectRoot, path))
  );
  const byBase = new Map(files.map((path) => [basename(path).toLowerCase(), path]));
  const explicitSourceFiles = input.source ? await expandReadableFiles(resolve(input.source)) : [];
  const sourcePacket = unique([
    ...explicitSourceFiles,
    ...files.filter((path) => isSourcePacketPath(legacyRoot, path)),
  ]).filter((path) => !LEDGER_NAMES.has(basename(path).toLowerCase()));
  const rfp = unique([
    ...sourcePacket.filter(isRfp),
    ...files.filter(isRfp),
  ]);
  const master = input.master
    ? await requireFile(resolve(input.master))
    : files.filter(isWorkingMaster).sort(compareCandidate)[0] ?? null;
  const ledgerBindings = ([
    ["claim-ledger.json", "claim_ledger"],
    ["evidence-ledger.json", "evidence_ledger"],
    ["figure-ledger.json", "figure_ledger"],
  ] as const).flatMap(([name, role]) => {
    const path = byBase.get(name);
    return path ? [{ role, path }] : [];
  });
  const briefPath = files.find((path) => basename(path).toLowerCase() === "living-brief.json");
  const longtableRuns = await discoverLongTableRuns(join(legacyRoot, ".longtable"));
  const selected = new Set([...rfp, ...sourcePacket, ...(master ? [master] : []), ...ledgerBindings.map(({ path }) => path), ...(briefPath ? [briefPath] : [])].map((path) => resolve(path)));
  const provisionalFiles = files.filter((path) =>
    CONTENT_EXTENSIONS.has(extname(path).toLowerCase())
    && !selected.has(resolve(path))
    && !isWithin(join(legacyRoot, ".longtable"), path)
  );

  const rawBindings: Array<{ role: AdoptionBinding["role"]; path: string }> = [
    ...rfp.map((path) => ({ role: "rfp" as const, path })),
    ...sourcePacket.filter((path) => !rfp.includes(path)).map((path) => ({ role: "source_packet" as const, path })),
    ...(master ? [{ role: "working_master" as const, path: master }] : []),
    ...ledgerBindings,
    ...(briefPath ? [{ role: "living_brief" as const, path: briefPath }] : []),
    ...longtableRuns.map(({ path }) => ({ role: "longtable_run" as const, path })),
    ...provisionalFiles.map((path) => ({ role: "provisional_content" as const, path })),
  ];
  const inputs = await Promise.all(rawBindings.map(async ({ role, path }) => ({
    role,
    originalPath: resolve(path),
    sha256: await hashPath(path),
  })));
  const provisionalContent = inputs
    .filter(({ role }) => role === "provisional_content")
    .map(({ originalPath, sha256 }) => ({ originalPath, sha256, status: "provisional" as const, reason: "no_source_binding" as const }));
  return {
    candidates: { rfp, sourcePacket, workingMaster: master },
    inputs: inputs.sort((a, b) => `${a.role}:${a.originalPath}`.localeCompare(`${b.role}:${b.originalPath}`)),
    provisionalContent,
    longtableRuns,
  };
}

function importDestination(root: string, binding: AdoptionBinding): string | null {
  const suffix = `${binding.sha256.slice(0, 12)}-${basename(binding.originalPath)}`;
  switch (binding.role) {
    case "rfp": return join(root, "sources", "adopted", "rfp", suffix);
    case "source_packet": return join(root, "sources", "adopted", "packet", suffix);
    case "working_master": return join(root, "content", `working-master${extname(binding.originalPath).toLowerCase() || ".bin"}`);
    case "claim_ledger": return join(root, "evidence", "claim-ledger.json");
    case "evidence_ledger": return join(root, "evidence", "evidence-ledger.json");
    case "figure_ledger": return join(root, "figures", "figure-ledger.json");
    case "living_brief": return join(root, "brief", "living-brief-candidate.json");
    case "provisional_content": return null;
    case "longtable_run": return null;
  }
}

async function discoverLongTableRuns(root: string): Promise<LongTableRunLink[]> {
  if (!(await pathExists(root))) return [];
  const runsRoot = (await pathExists(join(root, "runs"))) ? join(root, "runs") : root;
  const entries = await readdir(runsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()))
    .map((entry) => ({ path: join(runsRoot, entry.name), status: "legacy_readable" as const }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function decisionDiff(value: unknown): Record<string, unknown> {
  const object = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const ids = (field: string) => Array.isArray(object[field])
    ? (object[field] as unknown[]).flatMap((entry) => typeof entry === "object" && entry !== null && typeof (entry as { decisionId?: unknown }).decisionId === "string"
      ? [(entry as { decisionId: string }).decisionId]
      : [])
    : [];
  return {
    schemaVersion: "living-brief-adoption-diff/v1",
    confirmed: [],
    changed: ids("activeDecisions").sort(),
    stillOpen: ids("openDecisions").sort(),
    invalidatedDownstream: [],
    nextHumanGate: "review_adopted_living_brief",
  };
}

function changedBindings(previous: readonly AdoptionBinding[], current: readonly AdoptionBinding[]): unknown[] {
  const old = new Map(previous.map((binding) => [`${binding.role}:${binding.originalPath}`, binding.sha256]));
  const next = new Map(current.map((binding) => [`${binding.role}:${binding.originalPath}`, binding.sha256]));
  return unique([...old.keys(), ...next.keys()]).flatMap((key) => old.get(key) === next.get(key) ? [] : [{
    role: key.slice(0, key.indexOf(":")),
    path: key.slice(key.indexOf(":") + 1),
    previousSha256: old.get(key) ?? null,
    currentSha256: next.get(key) ?? null,
  }]);
}

function stripReceipt(receipt: AdoptionReceipt): AdoptionReport {
  const { inputs: _inputs, outputs: _outputs, inputDigest: _digest, ...report } = receipt;
  return report;
}

async function readAdoptionReceipt(path: string): Promise<AdoptionReceipt | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as AdoptionReceipt;
    if (value.schemaVersion !== ADOPTION_SCHEMA || !Array.isArray(value.inputs) || typeof value.inputDigest !== "string") {
      throw new Error("unsupported adoption receipt");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new KppError("KPP_INPUT_ADOPTION_RECEIPT_INVALID", "adoption 영수증을 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : String(error),
    });
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function expandReadableFiles(path: string): Promise<string[]> {
  const metadata = await stat(path).catch((error) => {
    throw new KppError("KPP_INPUT_SOURCE_READ", "source packet을 읽을 수 없습니다.", { path, actual: error instanceof Error ? error.message : String(error) });
  });
  if (metadata.isFile()) return [path];
  if (!metadata.isDirectory()) throw new KppError("KPP_INPUT_SOURCE_INVALID", "source packet은 파일 또는 디렉터리여야 합니다.", { path });
  return (await walkFiles(path)).filter((candidate) => SOURCE_EXTENSIONS.has(extname(candidate).toLowerCase()));
}

async function requireDirectory(path: string): Promise<void> {
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isDirectory()) throw new KppError("KPP_INPUT_ADOPTION_ROOT", "adopt root는 읽을 수 있는 디렉터리여야 합니다.", { path });
}

async function requireFile(path: string): Promise<string> {
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile()) throw new KppError("KPP_INPUT_MASTER_READ", "working master를 읽을 수 없습니다.", { path });
  return path;
}

function isRfp(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) && /(rfp|제안요청|공고|입찰)/iu.test(basename(path));
}

function isWorkingMaster(path: string): boolean {
  return CONTENT_EXTENSIONS.has(extname(path).toLowerCase()) && /(working[-_ ]?master|master|제안서|proposal|draft)/iu.test(basename(path));
}

function isSourcePacketPath(root: string, path: string): boolean {
  if (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) return false;
  return relative(root, dirname(path)).split(sep).some((part) => /^(sources?|source[-_ ]?packet|materials?|자료)$/iu.test(part));
}

function compareCandidate(left: string, right: string): number {
  const finalRank = (path: string) => /(final|최종)/iu.test(basename(path)) ? 0 : 1;
  return finalRank(left) - finalRank(right) || left.localeCompare(right);
}

function isTemporary(path: string): boolean {
  const name = basename(path);
  return name.startsWith(".") && (name.endsWith(".tmp") || name.includes(".tmp."));
}

function isWithin(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== "..");
}

function safeProjectId(value: string): string {
  return value.trim() || `adopted-${randomUUID()}`;
}

function digestBindings(bindings: readonly AdoptionBinding[]): string {
  return createHash("sha256").update(JSON.stringify(bindings.map(({ role, originalPath, sha256 }) => ({ role, originalPath, sha256 })))).digest("hex");
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function hashPath(path: string): Promise<string> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new KppError("KPP_INPUT_ADOPTION_SYMLINK", "adopt 입력은 심볼릭 링크일 수 없습니다.", { path });
  }
  if (metadata.isFile()) return hashFile(path);
  if (!metadata.isDirectory()) throw new KppError("KPP_INPUT_ADOPTION_PATH", "adopt 입력은 일반 파일 또는 디렉터리여야 합니다.", { path });
  const files = await walkFiles(path);
  const entries = await Promise.all(files.map(async (file) => ({
    path: relative(path, file),
    sha256: await hashFile(file),
  })));
  return createHash("sha256").update(JSON.stringify(entries.sort((a, b) => a.path.localeCompare(b.path)))).digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyAtomically(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

async function readLooseJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new KppError("KPP_INPUT_BRIEF_INVALID", "legacy Living Brief JSON을 읽을 수 없습니다.", { path, actual: error instanceof Error ? error.message : String(error) });
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
