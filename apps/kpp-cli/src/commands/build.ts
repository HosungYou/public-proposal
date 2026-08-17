import { lstat, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KppError,
  advanceProject,
  executeFile,
  sha256File,
  verifyReceipt,
  verifyProjectState,
  writeReceipt,
} from "@kpp/core";
import { success, type CliEnvelope } from "../output.js";

const BUILDER_VERSION = "0.1.0";
const PYTHON_BRIDGE = [
  "import json,sys",
  "from kpp_docx.build import BUILDER_VERSION,BuildRequest,build_document",
  "request_path=sys.argv[1]",
  "with open(request_path,encoding='utf-8') as stream: raw=json.load(stream)",
  "request=BuildRequest.model_validate(raw)",
  "result=build_document(request)",
  "print(json.dumps({'builderVersion':BUILDER_VERSION,'docxPath':str(result.docx),'manifestPath':str(result.manifest),'publicationPath':str(result.publication),'generationPath':str(result.generation)},sort_keys=True))",
].join("\n");

export interface BuildProjectOptions {
  readonly requestPath: string;
  readonly pythonPath?: string;
}

export interface BuildProjectResult {
  readonly state: "BUILT";
  readonly docxPath: string;
  readonly manifestPath: string;
  readonly generationPath: string;
  readonly receiptPath: string;
  readonly pythonPath: string;
}

interface BuildRequestPaths {
  readonly docxPath: string;
  readonly manifestPath: string;
}

export async function buildCommand(
  rootInput: string,
  options: { readonly request?: string; readonly python?: string },
): Promise<CliEnvelope> {
  if (options.request === undefined || options.request.trim().length === 0) {
    throw new KppError("KPP_BUILD_REQUEST_REQUIRED", "잠긴 BuildRequest JSON 경로가 필요합니다.", {
      stage: "CONTENT_APPROVED",
    });
  }
  const result = await buildProject(rootInput, { requestPath: options.request, pythonPath: options.python });
  return success("잠긴 입력으로 Word-native 제안서를 생성했습니다.", result);
}

/** Build only from a locked request and publish a receipt after byte-level verification. */
export async function buildProject(
  rootInput: string,
  options: BuildProjectOptions,
): Promise<BuildProjectResult> {
  const root = await realpath(resolve(rootInput));
  const project = await verifyProjectState(root);
  if (project.state !== "CONTENT_APPROVED") {
    throw new KppError("KPP_BUILD_STATE", "CONTENT_APPROVED 상태에서만 문서를 생성할 수 있습니다.", {
      stage: project.state,
      expected: "CONTENT_APPROVED",
      actual: project.state,
    });
  }
  const requestPath = await regularFileWithin(root, options.requestPath, "KPP_BUILD_REQUEST_INVALID");
  const request = await readJsonObject(requestPath, "KPP_BUILD_REQUEST_INVALID");
  const outputs = await validateLockedBuildRequest(root, request);
  await validateApprovedContent(root, request);
  await validateManagedTemplate(request);
  await validateApprovedStructure(root, request);
  await validateLockedFigureSources(root, request);
  const receiptPath = join(root, "receipts", "build.json");
  if (await lstat(receiptPath).catch(() => undefined) !== undefined) {
    throw new KppError("KPP_BUILD_RECEIPT_EXISTS", "기존 BUILT 영수증을 덮어쓸 수 없습니다.", { path: receiptPath, stage: "CONTENT_APPROVED" });
  }

  const pythonPath = await resolveManagedPython(options.pythonPath);
  const generationsBefore = await existingGenerationPaths(root);
  let generationPath: string | undefined;
  let receiptCreated = false;
  try {
    const result = await executeFile(pythonPath, ["-c", PYTHON_BRIDGE, requestPath], {
      cwd: root,
      environment: pythonEnvironment(),
      timeoutMs: 120_000,
    });
    const worker = parseWorkerResult(result.stdout);
    if (worker.builderVersion !== BUILDER_VERSION) {
      throw new KppError("KPP_BUILD_WORKER_VERSION", "DOCX builder 버전이 잠긴 KPP 버전과 다릅니다.", {
        expected: BUILDER_VERSION,
        actual: worker.builderVersion,
        stage: "CONTENT_APPROVED",
      });
    }
    generationPath = await verifyCanonicalGeneration(root, worker, outputs);
    const canonicalDocx = join(generationPath, "document.docx");
    const canonicalManifest = join(generationPath, "manifest.json");
    await verifyBuildManifest(canonicalManifest, canonicalDocx, project.projectId);
    await writeReceipt({
      stage: "BUILT",
      files: [canonicalDocx, canonicalManifest],
      inputReceiptHashes: [await sha256File(join(root, "receipts", "content-approval.json"))],
      output: receiptPath,
      toolVersion: BUILDER_VERSION,
    });
    receiptCreated = true;
    await advanceProject(root, "BUILT");
    return {
      state: "BUILT",
      docxPath: canonicalDocx,
      manifestPath: canonicalManifest,
      generationPath,
      receiptPath,
      pythonPath,
    };
  } catch (error) {
    // The worker itself publishes atomically. Since the state has not advanced,
    // remove only the generation and compatibility aliases created by this call.
    const state = await verifyProjectState(root).catch(() => undefined);
    if (state?.state !== "BUILT") {
      await removeUnpublishedBuild(outputs, generationPath, generationsBefore);
      if (receiptCreated) await rm(receiptPath, { force: true });
    }
    throw error;
  }
}

async function validateLockedBuildRequest(root: string, request: Record<string, unknown>): Promise<BuildRequestPaths> {
  if (request.projectId !== (await verifyProjectState(root)).projectId) {
    throw new KppError("KPP_BUILD_REQUEST_PROJECT", "BuildRequest의 projectId가 잠긴 프로젝트와 다릅니다.", {
      expected: (await verifyProjectState(root)).projectId,
      actual: request.projectId,
      stage: "CONTENT_APPROVED",
    });
  }
  for (const [key, expectedPath] of [
    ["pagePlan", join(root, "content", "page-plan.json")],
    ["evidenceLedger", join(root, "evidence", "evidence-ledger.json")],
    ["surfaceProfile", join(root, "figures", "design-profile.json")],
  ] as const) {
    const expected = await readJsonObject(expectedPath, "KPP_BUILD_LOCKED_INPUT");
    if (canonicalJson(request[key]) !== canonicalJson(expected)) {
      throw new KppError("KPP_BUILD_LOCKED_INPUT", "BuildRequest가 잠긴 입력 bytes와 일치하지 않습니다.", {
        path: expectedPath,
        expected: await sha256File(expectedPath),
        actual: canonicalJson(request[key]),
        stage: "CONTENT_APPROVED",
      });
    }
  }
  const output = objectAt(request, "output");
  if (typeof output?.docxPath !== "string" || typeof output.manifestPath !== "string") {
    throw new KppError("KPP_BUILD_REQUEST_INVALID", "BuildRequest output 경로가 필요합니다.", { path: root, stage: "CONTENT_APPROVED" });
  }
  const docxPath = await outputPathWithin(root, output.docxPath);
  const manifestPath = await outputPathWithin(root, output.manifestPath);
  if (docxPath === manifestPath || !docxPath.endsWith(".docx") || !manifestPath.endsWith(".json")) {
    throw new KppError("KPP_BUILD_REQUEST_INVALID", "DOCX와 manifest의 출력 경로가 올바르지 않습니다.", {
      actual: output,
      stage: "CONTENT_APPROVED",
    });
  }
  return { docxPath, manifestPath };
}

async function validateApprovedContent(root: string, request: Record<string, unknown>): Promise<void> {
  const receipt = await verifyReceipt(join(root, "receipts", "content-approval.json"));
  const responseRecord = receipt.receipt.files.find((file) => basename(file.path) === "authoring-response.json");
  const responsePath = responseRecord === undefined ? undefined : await realpath(responseRecord.path).catch(() => undefined);
  if (!receipt.valid || responsePath === undefined || !isWithin(root, responsePath)) {
    throw new KppError("KPP_BUILD_CONTENT_UNBOUND", "BuildRequest 본문은 CONTENT_APPROVED receipt의 authoring response에 결속되어야 합니다.", {
      path: join(root, "receipts", "content-approval.json"),
      stage: "CONTENT_APPROVED",
    });
  }
  const response = await readJsonObject(responsePath, "KPP_BUILD_CONTENT_UNBOUND");
  const responseBlocks = Array.isArray(response.blocks) ? response.blocks : undefined;
  const blocks = Array.isArray(request.contentBlocks) ? request.contentBlocks : undefined;
  if (responseBlocks === undefined || blocks === undefined || responseBlocks.length !== blocks.length) {
    throw new KppError("KPP_BUILD_CONTENT_UNBOUND", "BuildRequest 본문 블록이 승인된 authoring response와 일치하지 않습니다.", { path: responsePath, stage: "CONTENT_APPROVED" });
  }
  const byPage = new Map(responseBlocks.map((value) => {
    const block = asObject(value);
    return [typeof block?.pageId === "string" ? block.pageId : "", block] as const;
  }));
  if (byPage.size !== responseBlocks.length || byPage.has("")) {
    throw new KppError("KPP_BUILD_CONTENT_UNBOUND", "승인된 authoring response의 페이지 식별자가 올바르지 않습니다.", { path: responsePath, stage: "CONTENT_APPROVED" });
  }
  for (const value of blocks) {
    const block = asObject(value);
    const pageId = typeof block?.pageId === "string" ? block.pageId : undefined;
    const approved = pageId === undefined ? undefined : byPage.get(pageId);
    const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs.map(asObject) : undefined;
    if (block === undefined || approved === undefined || paragraphs === undefined) {
      throw new KppError("KPP_BUILD_CONTENT_UNBOUND", "BuildRequest 본문 block이 승인 응답과 일치하지 않습니다.", { path: responsePath, stage: "CONTENT_APPROVED" });
    }
    const approvedText = typeof approved.text === "string" ? approved.text : undefined;
    const approvedClaims = stringArray(approved.claimIds);
    const approvedEvidence = stringArray(approved.evidenceIds);
    const actualText = paragraphs.map((paragraph) => paragraph?.text).join("\n");
    const actualClaims = uniqueInOrder(paragraphs.flatMap((paragraph) => stringArray(paragraph?.claimIds) ?? []));
    const actualEvidence = uniqueInOrder(paragraphs.flatMap((paragraph) => stringArray(paragraph?.evidenceIds) ?? []));
    if (approvedText === undefined || approvedClaims === undefined || approvedEvidence === undefined
      || actualText !== approvedText || !sameOrdered(actualClaims, approvedClaims) || !sameOrdered(actualEvidence, approvedEvidence)) {
      throw new KppError("KPP_BUILD_CONTENT_UNBOUND", "BuildRequest 문단 text/claim/evidence가 승인된 authoring response와 다릅니다.", {
        path: responsePath,
        stage: "CONTENT_APPROVED",
      });
    }
  }
}

async function validateManagedTemplate(request: Record<string, unknown>): Promise<void> {
  const template = objectAt(request, "template");
  const expectedPath = await realpath(join(repositoryRoot(), "workers/docx-python/assets/Korean Public Proposal A4 v1.docx"));
  const requestedPath = typeof template?.path === "string" ? await realpath(template.path).catch(() => undefined) : undefined;
  const actualHash = await sha256File(expectedPath);
  if (template?.assetId !== "korean-public-proposal-a4-v1" || requestedPath !== expectedPath || template.sha256 !== actualHash) {
    throw new KppError("KPP_BUILD_TEMPLATE_UNBOUND", "BuildRequest template은 관리된 Korean Public Proposal A4 asset/hash와 일치해야 합니다.", {
      expected: { assetId: "korean-public-proposal-a4-v1", path: expectedPath, sha256: actualHash },
      actual: template,
      stage: "CONTENT_APPROVED",
    });
  }
}

async function validateLockedFigureSources(root: string, request: Record<string, unknown>): Promise<void> {
  const manifest = objectAt(request, "figureManifest");
  const figures = Array.isArray(manifest?.figures) ? manifest.figures.map(asObject) : undefined;
  if (figures === undefined || figures.some((figure) => figure === undefined)) {
    throw new KppError("KPP_BUILD_FIGURE_UNBOUND", "BuildRequest figureManifest 형식이 올바르지 않습니다.", { stage: "CONTENT_APPROVED" });
  }
  const locked = new Map<string, string>();
  for (const receiptPath of [join(root, "receipts", "design-lock.json"), join(root, "receipts", "content-approval.json")]) {
    const receipt = await verifyReceipt(receiptPath);
    if (!receipt.valid) continue;
    for (const file of receipt.receipt.files) {
      const canonical = await realpath(file.path).catch(() => undefined);
      if (canonical !== undefined) locked.set(canonical, file.sha256);
    }
  }
  for (const figure of figures) {
    const sourcePath = typeof figure?.path === "string" ? await realpath(figure.path).catch(() => undefined) : undefined;
    if (sourcePath === undefined || typeof figure?.sha256 !== "string" || locked.get(sourcePath) !== figure.sha256 || await sha256File(sourcePath) !== figure.sha256) {
      throw new KppError("KPP_BUILD_FIGURE_UNBOUND", "figure source bytes는 DESIGN_LOCKED 또는 CONTENT_APPROVED receipt에 결속되어야 합니다.", {
        actual: figure,
        stage: "CONTENT_APPROVED",
      });
    }
  }
}

async function validateApprovedStructure(root: string, request: Record<string, unknown>): Promise<void> {
  const requestBlocks = Array.isArray(request.contentBlocks) ? request.contentBlocks.map(asObject) : undefined;
  const pagePlan = objectAt(request, "pagePlan");
  const plannedPages = Array.isArray(pagePlan?.pages) ? pagePlan.pages.map(asObject) : undefined;
  const structure = await boundJson(root, join(root, "content", "build-structure.json"), ["content-approval.json"]);
  const approvedBlocks = Array.isArray(structure.blocks) ? structure.blocks.map(asObject) : undefined;
  if (requestBlocks === undefined || plannedPages === undefined || approvedBlocks === undefined
    || requestBlocks.some((block) => block === undefined) || plannedPages.some((page) => page === undefined) || approvedBlocks.some((block) => block === undefined)) {
    throw new KppError("KPP_BUILD_STRUCTURE_UNBOUND", "BuildRequest 구조·page plan·승인 구조 원장을 검증할 수 없습니다.", { stage: "CONTENT_APPROVED" });
  }
  const structuralProjection = requestBlocks.map((block) => ({
    pageId: block!.pageId,
    heading: block!.heading,
    tables: block!.tables,
    figureIds: block!.figureIds,
  }));
  const plannedPageIds = plannedPages.map((page) => typeof page!.pageId === "string" ? page!.pageId : "");
  const blockPageIds = structuralProjection.map((block) => typeof block.pageId === "string" ? block.pageId : "");
  if (!sameOrdered(blockPageIds, plannedPageIds) || canonicalJson({ blocks: structuralProjection }) !== canonicalJson({ blocks: approvedBlocks })) {
    throw new KppError("KPP_BUILD_STRUCTURE_UNBOUND", "heading/table/caption/figureIds는 CONTENT_APPROVED 구조 원장 및 잠긴 page plan과 일치해야 합니다.", {
      path: join(root, "content", "build-structure.json"),
      stage: "CONTENT_APPROVED",
    });
  }
  const figures = objectAt(request, "figureManifest");
  const figureEntries = Array.isArray(figures?.figures) ? figures.figures : undefined;
  if (figureEntries === undefined) {
    throw new KppError("KPP_BUILD_FIGURE_UNBOUND", "BuildRequest figureManifest 형식이 올바르지 않습니다.", { stage: "CONTENT_APPROVED" });
  }
  if (figureEntries.length > 0) {
    const approvedFigureManifest = await boundJson(root, join(root, "figures", "build-figure-manifest.json"), ["design-lock.json", "content-approval.json"]);
    if (canonicalJson(figures) !== canonicalJson(approvedFigureManifest)) {
      throw new KppError("KPP_BUILD_FIGURE_UNBOUND", "figure caption/source/renderer 원장은 승인된 build-figure-manifest와 일치해야 합니다.", {
        path: join(root, "figures", "build-figure-manifest.json"),
        stage: "CONTENT_APPROVED",
      });
    }
  }
}

async function boundJson(root: string, path: string, receiptNames: readonly string[]): Promise<Record<string, unknown>> {
  const canonical = await realpath(path).catch(() => undefined);
  if (canonical === undefined || !isWithin(root, canonical)) {
    throw new KppError("KPP_BUILD_STRUCTURE_UNBOUND", "승인된 구조 원장 파일이 없습니다.", { path, stage: "CONTENT_APPROVED" });
  }
  const hash = await sha256File(canonical);
  for (const name of receiptNames) {
    const receipt = await verifyReceipt(join(root, "receipts", name));
    if (!receipt.valid) continue;
    for (const file of receipt.receipt.files) {
      const receiptPath = await realpath(file.path).catch(() => undefined);
      if (receiptPath === canonical && file.sha256 === hash) return readJsonObject(canonical, "KPP_BUILD_STRUCTURE_UNBOUND");
    }
  }
  throw new KppError("KPP_BUILD_STRUCTURE_UNBOUND", "구조 원장이 DESIGN_LOCKED/CONTENT_APPROVED receipt에 결속되지 않았습니다.", { path: canonical, stage: "CONTENT_APPROVED" });
}

async function resolveManagedPython(input: string | undefined): Promise<string> {
  const repository = repositoryRoot();
  const expected = resolve(repository, "workers/docx-python/.venv/bin/python");
  const requested = input === undefined ? expected : resolve(input);
  if (requested !== expected) {
    throw new KppError("KPP_BUILD_PYTHON_UNMANAGED", "관리된 KPP DOCX Python만 사용할 수 있습니다.", {
      expected,
      actual: requested,
      stage: "CONTENT_APPROVED",
    });
  }
  const python = await realpath(requested).catch(() => undefined);
  if (python === undefined) {
    throw new KppError("KPP_BUILD_PYTHON_MISSING", "관리된 KPP DOCX Python을 찾을 수 없습니다.", { path: requested, stage: "CONTENT_APPROVED" });
  }
  const version = await executeFile(python, ["--version"], { environment: pythonEnvironment() });
  const observed = `${version.stdout}${version.stderr}`.trim();
  const match = /^Python\s+(\d+)\.(\d+)(?:\.\d+)?$/u.exec(observed);
  if (match?.[1] !== "3" || Number(match[2]) < 11 || Number(match[2]) >= 15) {
    throw new KppError("KPP_BUILD_PYTHON_VERSION", "DOCX worker는 Python >=3.11,<3.15가 필요합니다.", {
      path: python,
      actual: observed,
      stage: "CONTENT_APPROVED",
    });
  }
  return python;
}

function parseWorkerResult(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new KppError("KPP_BUILD_WORKER_OUTPUT", "DOCX worker 출력이 단일 JSON 결과가 아닙니다.", { actual: stdout });
  try {
    const parsed = JSON.parse(lines[0] ?? "");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new KppError("KPP_BUILD_WORKER_OUTPUT", "DOCX worker 출력 JSON을 검증할 수 없습니다.", { actual: stdout });
  }
}

async function verifyCanonicalGeneration(
  root: string,
  worker: Record<string, unknown>,
  outputs: BuildRequestPaths,
): Promise<string> {
  if (typeof worker.generationPath !== "string" || typeof worker.docxPath !== "string" || typeof worker.manifestPath !== "string") {
    throw new KppError("KPP_BUILD_WORKER_OUTPUT", "DOCX worker의 canonical generation 출력이 누락되었습니다.", { actual: worker });
  }
  const generationPath = await realpath(worker.generationPath).catch(() => undefined);
  const docx = await realpath(worker.docxPath).catch(() => undefined);
  const manifest = await realpath(worker.manifestPath).catch(() => undefined);
  if (generationPath === undefined || docx !== join(generationPath, "document.docx") || manifest !== join(generationPath, "manifest.json")
    || !isWithin(root, generationPath) || !(await stat(docx)).isFile() || !(await stat(manifest)).isFile()) {
    throw new KppError("KPP_BUILD_GENERATION_INVALID", "DOCX worker의 immutable generation을 검증할 수 없습니다.", {
      actual: worker,
      stage: "CONTENT_APPROVED",
    });
  }
  const members = (await readdir(generationPath)).sort();
  if (members.length !== 2 || members[0] !== "document.docx" || members[1] !== "manifest.json") {
    throw new KppError("KPP_BUILD_GENERATION_INVALID", "immutable generation의 member 구성이 올바르지 않습니다.", {
      path: generationPath,
      actual: members,
      stage: "CONTENT_APPROVED",
    });
  }
  const [compatibilityDocx, compatibilityManifest] = await Promise.all([
    realpath(outputs.docxPath).catch(() => undefined),
    realpath(outputs.manifestPath).catch(() => undefined),
  ]);
  if (compatibilityDocx !== docx || compatibilityManifest !== manifest) {
    throw new KppError("KPP_BUILD_GENERATION_INVALID", "worker compatibility path가 canonical generation과 일치하지 않습니다.", {
      actual: { compatibilityDocx, compatibilityManifest, docx, manifest },
      stage: "CONTENT_APPROVED",
    });
  }
  return generationPath;
}

async function verifyBuildManifest(path: string, docxPath: string, projectId: string): Promise<void> {
  const manifest = await readJsonObject(path, "KPP_BUILD_MANIFEST_INVALID");
  const artifact = objectAt(manifest, "artifacts", "docx");
  if (manifest.builderVersion !== BUILDER_VERSION || manifest.projectId !== projectId
    || artifact?.path !== docxPath || artifact.sha256 !== await sha256File(docxPath)) {
    throw new KppError("KPP_BUILD_MANIFEST_INVALID", "build manifest가 canonical DOCX bytes와 일치하지 않습니다.", {
      path,
      stage: "CONTENT_APPROVED",
    });
  }
}

async function regularFileWithin(root: string, input: string, code: string): Promise<string> {
  const candidate = resolve(input);
  const metadata = await lstat(candidate).catch(() => undefined);
  const canonical = metadata?.isSymbolicLink() ? undefined : await realpath(candidate).catch(() => undefined);
  if (canonical === undefined || !isWithin(root, canonical) || !(await stat(canonical)).isFile()) {
    throw new KppError(code, "프로젝트 안의 일반 파일을 읽을 수 없습니다.", { path: candidate, stage: "CONTENT_APPROVED" });
  }
  return canonical;
}

async function outputPathWithin(root: string, input: string): Promise<string> {
  const lexical = isAbsolute(input) ? resolve(input) : resolve(root, input);
  const parent = await realpath(dirname(lexical)).catch(() => undefined);
  const path = parent === undefined ? lexical : join(parent, basename(lexical));
  if (!isWithin(root, path)) {
    throw new KppError("KPP_BUILD_OUTPUT_OUTSIDE", "Build output은 프로젝트 안에 있어야 합니다.", { path, stage: "CONTENT_APPROVED" });
  }
  const metadata = await lstat(path).catch(() => undefined);
  if (metadata?.isSymbolicLink()) {
    throw new KppError("KPP_BUILD_OUTPUT_SYMLINK", "Build output symlink는 허용되지 않습니다.", { path, stage: "CONTENT_APPROVED" });
  }
  if (metadata !== undefined) {
    throw new KppError("KPP_BUILD_OUTPUT_EXISTS", "Build output은 이번 실행 전 비어 있는 compiler-owned 경로여야 합니다.", {
      path,
      stage: "CONTENT_APPROVED",
    });
  }
  const outputRoot = await realpath(join(root, "build")).catch(() => undefined);
  if (outputRoot === undefined || parent !== outputRoot) {
    throw new KppError("KPP_BUILD_OUTPUT_RESERVED", "Build output은 프로젝트의 compiler-owned build 디렉터리에 있어야 합니다.", {
      expected: join(root, "build"),
      actual: parent ?? dirname(path),
      stage: "CONTENT_APPROVED",
    });
  }
  return path;
}

async function existingGenerationPaths(root: string): Promise<ReadonlySet<string>> {
  const outputRoot = join(root, "build");
  const result = new Set<string>();
  for (const bundle of await readdir(outputRoot, { withFileTypes: true })) {
    if (!bundle.isDirectory() || !/^\.kpp-build-[a-f0-9]{16}$/u.test(bundle.name)) continue;
    const generations = join(outputRoot, bundle.name, "generations");
    for (const generation of await readdir(generations, { withFileTypes: true }).catch(() => [])) {
      if (generation.isDirectory()) result.add(join(generations, generation.name));
    }
  }
  return result;
}

async function removeUnpublishedBuild(
  outputs: BuildRequestPaths,
  generationPath: string | undefined,
  generationsBefore: ReadonlySet<string>,
): Promise<void> {
  await Promise.all([
    rm(outputs.docxPath, { force: true }),
    rm(outputs.manifestPath, { force: true }),
    ...(generationPath === undefined || generationsBefore.has(generationPath)
      ? []
      : [rm(generationPath, { recursive: true, force: true })]),
  ]);
}

function objectAt(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current !== null && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : undefined;
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameOrdered(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function readJsonObject(path: string, code: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON root must be an object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new KppError(code, "JSON 입력을 검증할 수 없습니다.", { path, actual: error instanceof Error ? error.message : error, stage: "CONTENT_APPROVED" });
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function pythonEnvironment(): NodeJS.ProcessEnv {
  const workerSource = join(repositoryRoot(), "workers/docx-python/src");
  return { ...process.env, PYTHONPATH: [workerSource, process.env.PYTHONPATH].filter(Boolean).join(":") };
}

function isWithin(parent: string, child: string): boolean {
  const segment = relative(parent, child);
  return segment.length > 0 && segment !== ".." && !segment.startsWith(`..${sep}`) && !isAbsolute(segment);
}
