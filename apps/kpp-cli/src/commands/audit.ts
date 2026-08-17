import { lstat, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KppError,
  advanceProject,
  executeFile,
  sha256File,
  verifyProjectState,
  writeReceipt,
} from "@kpp/core";
import { auditProposal, type FigureAuditInput, type ProposalAuditReport } from "@kpp/audits";
import { success, type CliEnvelope } from "../output.js";

export interface AuditProjectOptions {
  readonly docxPath: string;
  readonly buildManifestPath: string;
  readonly renderManifestPath: string;
  readonly figures: readonly FigureAuditInput[];
  readonly trustedPdftotextPath?: string;
}

export interface AuditProjectResult {
  readonly state: "AUDITED" | "RENDERED";
  readonly auditPath: string;
  readonly geometryPath: string;
  readonly report: ProposalAuditReport;
}

export async function auditCommand(
  rootInput: string,
  options: {
    readonly docx?: string;
    readonly buildManifest?: string;
    readonly renderManifest?: string;
    readonly figure?: readonly string[];
  },
): Promise<CliEnvelope> {
  if (options.docx === undefined || options.buildManifest === undefined || options.renderManifest === undefined) {
    throw new KppError("KPP_AUDIT_INPUT_REQUIRED", "DOCX, build manifest, render manifest 경로가 모두 필요합니다.", { stage: "RENDERED" });
  }
  const figures = (options.figure ?? []).map(parseFigureOption);
  const result = await auditProject(rootInput, {
    docxPath: options.docx,
    buildManifestPath: options.buildManifest,
    renderManifestPath: options.renderManifest,
    figures,
  });
  return success(result.report.status === "PASS" ? "제출 기술감사를 통과했습니다." : "제출 기술감사가 차단되었습니다.", result);
}

/** Run the technical gate. A PASS is recorded but never substitutes for human approval. */
export async function auditProject(rootInput: string, options: AuditProjectOptions): Promise<AuditProjectResult> {
  const root = await realProjectRoot(rootInput);
  const project = await verifyProjectState(root);
  if (project.state !== "RENDERED") {
    throw new KppError("KPP_AUDIT_STATE", "RENDERED 상태에서만 제안서를 감사할 수 있습니다.", {
      stage: project.state,
      expected: "RENDERED",
      actual: project.state,
    });
  }
  const [docxPath, buildManifestPath, renderManifestPath] = await Promise.all([
    regularFile(root, options.docxPath, "KPP_AUDIT_DOCX_INVALID"),
    regularFile(root, options.buildManifestPath, "KPP_AUDIT_BUILD_MANIFEST_INVALID"),
    regularFile(root, options.renderManifestPath, "KPP_AUDIT_RENDER_MANIFEST_INVALID"),
  ]);
  const auditPath = join(root, "audit", "audit.json");
  const geometryPath = join(root, "audit", "docx-geometry.json");
  if (await lstat(auditPath).catch(() => undefined) !== undefined) {
    throw new KppError("KPP_AUDIT_EXISTS", "기존 audit 결과를 덮어쓸 수 없습니다.", { path: auditPath, stage: "RENDERED" });
  }
  const profileSha256 = await profileSha256From(buildManifestPath);
  try {
    await writeGeometryReport(docxPath, profileSha256, geometryPath);
    const report = await auditProposal({
      root,
      docx: { docxPath, buildManifestPath, geometryReportPath: geometryPath },
      renderManifestPath,
      trustedPdftotextPath: options.trustedPdftotextPath,
      figures: await Promise.all(options.figures.map(async (figure) => ({
        specPath: await regularFile(root, figure.specPath, "KPP_AUDIT_FIGURE_INVALID"),
        svgPath: await regularFile(root, figure.svgPath, "KPP_AUDIT_FIGURE_INVALID"),
        manifestPath: await regularFile(root, figure.manifestPath, "KPP_AUDIT_FIGURE_INVALID"),
      }))),
      outputPath: auditPath,
    });
    if (report.status !== "PASS") {
      return { state: "RENDERED", auditPath, geometryPath, report };
    }
    const receiptPath = join(root, "receipts", "audit.json");
    await writeReceipt({
      stage: "AUDITED",
      files: [auditPath, geometryPath],
      inputReceiptHashes: [await sha256File(join(root, "receipts", "render.json"))],
      output: receiptPath,
    });
    await advanceProject(root, "AUDITED");
    return { state: "AUDITED", auditPath, geometryPath, report };
  } catch (error) {
    const state = await verifyProjectState(root).catch(() => undefined);
    if (state?.state !== "AUDITED") {
      await Promise.all([rm(auditPath, { force: true }), rm(geometryPath, { force: true })]);
      await rm(join(root, "receipts", "audit.json"), { force: true });
    }
    throw error;
  }
}

function parseFigureOption(value: string): FigureAuditInput {
  const parts = value.split(":");
  if (parts.length !== 3 || parts.some((part) => part.trim().length === 0)) {
    throw new KppError("KPP_AUDIT_FIGURE_INVALID", "figure 옵션은 spec:svg:manifest 형식이어야 합니다.", { actual: value, stage: "RENDERED" });
  }
  return { specPath: parts[0]!, svgPath: parts[1]!, manifestPath: parts[2]! };
}

async function writeGeometryReport(docxPath: string, profileSha256: string, outputPath: string): Promise<void> {
  const repository = repositoryRoot();
  const python = resolve(repository, "workers/docx-python/.venv/bin/python");
  const worker = resolve(repository, "workers/docx-python/src/kpp_docx/audit_geometry.py");
  const version = await executeFile(python, ["--version"], { environment: pythonEnvironment() });
  const observed = `${version.stdout}${version.stderr}`.trim();
  const match = /^Python\s+3\.(\d+)(?:\.\d+)?$/u.exec(observed);
  if (match === null || Number(match[1]) < 11 || Number(match[1]) >= 15) {
    throw new KppError("KPP_AUDIT_PYTHON_VERSION", "DOCX geometry 검사는 Python >=3.11,<3.15가 필요합니다.", { actual: observed, stage: "RENDERED" });
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await executeFile(python, [worker, docxPath, "--profile-sha256", profileSha256, "--output", outputPath], {
    environment: pythonEnvironment(),
  });
  const metadata = await stat(outputPath).catch(() => undefined);
  if (metadata === undefined || !metadata.isFile() || metadata.size === 0) {
    throw new KppError("KPP_AUDIT_GEOMETRY_MISSING", "DOCX geometry report를 생성하지 못했습니다.", { path: outputPath, stage: "RENDERED" });
  }
  await syncFileAndDirectory(outputPath);
}

async function profileSha256From(path: string): Promise<string> {
  const manifest = await readJsonObject(path, "KPP_AUDIT_BUILD_MANIFEST_INVALID");
  const profile = objectAt(manifest, "profile");
  if (typeof profile?.sha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(profile.sha256)) {
    throw new KppError("KPP_AUDIT_BUILD_MANIFEST_INVALID", "build manifest의 locked profile hash가 없습니다.", { path, stage: "RENDERED" });
  }
  return profile.sha256;
}

async function realProjectRoot(rootInput: string): Promise<string> {
  const root = await import("node:fs/promises").then(({ realpath }) => realpath(resolve(rootInput))).catch(() => undefined);
  if (root === undefined) throw new KppError("KPP_AUDIT_PROJECT_MISSING", "프로젝트 경로를 찾을 수 없습니다.", { path: resolve(rootInput) });
  return root;
}

async function regularFile(root: string, input: string, code: string): Promise<string> {
  const candidate = resolve(input);
  const metadata = await lstat(candidate).catch(() => undefined);
  const canonical = metadata?.isSymbolicLink() ? undefined : await import("node:fs/promises").then(({ realpath }) => realpath(candidate)).catch(() => undefined);
  if (canonical === undefined || !isWithin(root, canonical) || !(await stat(canonical)).isFile()) {
    throw new KppError(code, "프로젝트 안의 일반 파일이 필요합니다.", { path: candidate, stage: "RENDERED" });
  }
  return canonical;
}

async function readJsonObject(path: string, code: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new KppError(code, "JSON 입력을 읽을 수 없습니다.", { path, actual: error instanceof Error ? error.message : error, stage: "RENDERED" });
  }
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

async function syncFileAndDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
  const directory = await open(dirname(path), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function pythonEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONPATH: [join(repositoryRoot(), "workers/docx-python/src"), process.env.PYTHONPATH].filter(Boolean).join(":") };
}

function isWithin(parent: string, child: string): boolean {
  const segment = relative(parent, child);
  return segment.length > 0 && segment !== ".." && !segment.startsWith(`..${sep}`) && !isAbsolute(segment);
}
