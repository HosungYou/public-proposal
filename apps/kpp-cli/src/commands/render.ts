import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  KppError,
  advanceProject,
  executeFile,
  readProject,
  resolveVerifiedExecutable,
  sha256File,
  verifyProjectState,
  verifyReceipt,
  writeReceipt,
  type ExecutableIdentity,
} from "@kpp/core";
import { success, type CliEnvelope } from "../output.js";

const RENDER_SCHEMA_VERSION = "1.0.0";
const RENDER_TOOL_VERSION = "0.1.0";
const PAGE_DPI = 200;

interface RenderToolPaths {
  readonly soffice?: string;
  readonly pdfinfo?: string;
  readonly pdftotext?: string;
  readonly pdftoppm?: string;
}

export interface RenderProjectOptions {
  readonly docxPath: string;
  readonly tools?: RenderToolPaths;
}

interface PageImageArtifact {
  readonly page: number;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

interface RenderExecutables {
  readonly soffice: ExecutableIdentity;
  readonly pdfinfo: ExecutableIdentity;
  readonly pdftotext: ExecutableIdentity;
  readonly pdftoppm: ExecutableIdentity;
}

export interface RenderProjectResult {
  readonly state: "RENDERED";
  readonly generationPath: string;
  readonly manifestPath: string;
  readonly pdfPath: string;
  readonly pdfPages: number;
  readonly pageImages: readonly PageImageArtifact[];
  readonly searchableText: string;
  readonly executables: RenderExecutables;
}

export async function renderCommand(
  rootInput: string,
  options: { readonly docx?: string },
): Promise<CliEnvelope> {
  if (options.docx === undefined || options.docx.trim().length === 0) {
    throw new KppError("KPP_RENDER_DOCX_REQUIRED", "렌더링할 canonical DOCX 경로가 필요합니다.", {
      stage: "BUILT",
    });
  }
  const result = await renderProject(rootInput, { docxPath: options.docx });
  return success("검색 가능한 PDF와 페이지 이미지를 생성했습니다.", result);
}

export async function renderProject(
  rootInput: string,
  options: RenderProjectOptions,
): Promise<RenderProjectResult> {
  const root = await realpath(resolve(rootInput));
  const project = await verifyProjectState(root);
  if (project.state !== "BUILT") {
    throw new KppError("KPP_RENDER_STATE", "BUILT 상태에서만 문서를 렌더링할 수 있습니다.", {
      actual: project.state,
      expected: "BUILT",
      stage: project.state,
    });
  }

  const buildReceiptPath = join(root, "receipts", "build.json");
  const buildReceiptVerification = await verifyReceipt(buildReceiptPath);
  if (!buildReceiptVerification.valid || buildReceiptVerification.receipt.stage !== "BUILT") {
    throw new KppError("KPP_RENDER_BUILD_RECEIPT", "BUILT 영수증이 유효하지 않습니다.", {
      path: buildReceiptPath,
      actual: buildReceiptVerification,
      stage: "BUILT",
    });
  }

  const canonicalDocx = await canonicalBuiltDocx(root, options.docxPath);
  const docxHash = await sha256File(canonicalDocx);
  const receiptDocx = await findReceiptFile(
    buildReceiptVerification.receipt.files,
    canonicalDocx,
  );
  if (receiptDocx === undefined || receiptDocx.sha256 !== docxHash) {
    throw new KppError("KPP_RENDER_DOCX_STALE", "DOCX가 BUILT 영수증과 일치하지 않습니다.", {
      path: canonicalDocx,
      expected: receiptDocx?.sha256,
      actual: docxHash,
      stage: "BUILT",
    });
  }

  const renderReceiptPath = join(root, "receipts", "render.json");
  const currentPath = join(root, "rendered", "current");
  await assertAbsent(renderReceiptPath, "KPP_RENDER_RECEIPT_EXISTS");
  await assertAbsent(currentPath, "KPP_RENDER_CURRENT_EXISTS");

  const executables = await resolveRenderExecutables(options.tools);
  const generationsRoot = join(root, "rendered", "generations");
  await mkdir(generationsRoot, { recursive: true });
  const staging = await mkdtemp(join(generationsRoot, ".staging-"));
  let publishedGeneration: string | undefined;
  let currentPublished = false;
  let currentTemporary: string | undefined;
  let receiptWritten = false;

  try {
    const profile = join(staging, "libreoffice-profile");
    await mkdir(profile, { recursive: true });
    await executeFile(executables.soffice.path, [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      staging,
      canonicalDocx,
    ], { timeoutMs: 120_000 });

    const convertedPdf = join(
      staging,
      `${basename(canonicalDocx, extname(canonicalDocx))}.pdf`,
    );
    await assertNonemptyFile(convertedPdf, "KPP_RENDER_PDF_MISSING");
    const stagedPdf = join(staging, "proposal.pdf");
    await rename(convertedPdf, stagedPdf);

    const info = await executeFile(executables.pdfinfo.path, [stagedPdf]);
    const pdfPages = parsePageCount(info.stdout);
    const text = await executeFile(executables.pdftotext.path, [stagedPdf, "-"]);
    const searchableText = text.stdout.normalize("NFC").trim();
    const hangulCodePointCount = [...searchableText]
      .filter((character) => /[\uAC00-\uD7A3]/u.test(character)).length;
    if (hangulCodePointCount === 0) {
      throw new KppError(
        "KPP_RENDER_KOREAN_TEXT_MISSING",
        "PDF에서 검색 가능한 한글 텍스트를 추출하지 못했습니다.",
        { path: stagedPdf, stage: "BUILT" },
      );
    }

    const rawPagePrefix = join(staging, "raw-page");
    await executeFile(executables.pdftoppm.path, [
      "-png",
      "-r",
      String(PAGE_DPI),
      stagedPdf,
      rawPagePrefix,
    ], { timeoutMs: 120_000 });
    const rawPages = (await readdir(staging))
      .map((name) => ({ name, match: /^raw-page-(\d+)\.png$/.exec(name) }))
      .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
      .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
    if (rawPages.length !== pdfPages) {
      throw new KppError("KPP_RENDER_PAGE_COUNT_MISMATCH", "PDF와 페이지 이미지 수가 다릅니다.", {
        expected: pdfPages,
        actual: rawPages.length,
        stage: "BUILT",
      });
    }

    for (let index = 0; index < rawPages.length; index += 1) {
      const rawPage = rawPages[index];
      if (rawPage === undefined) {
        continue;
      }
      const pageName = `page-${String(index + 1).padStart(4, "0")}.png`;
      await rename(join(staging, rawPage.name), join(staging, pageName));
      await assertNonemptyFile(join(staging, pageName), "KPP_RENDER_PAGE_IMAGE_MISSING");
    }

    await rm(profile, { force: true, recursive: true });
    const generationId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
    const generationPath = join(generationsRoot, generationId);
    const pdfPath = join(generationPath, "proposal.pdf");
    const pageImages = await Promise.all(
      Array.from({ length: pdfPages }, async (_, index): Promise<PageImageArtifact> => {
        const page = index + 1;
        const filename = `page-${String(page).padStart(4, "0")}.png`;
        const stagedPath = join(staging, filename);
        const metadata = await stat(stagedPath);
        return {
          page,
          path: join(generationPath, filename),
          sha256: await sha256File(stagedPath),
          bytes: metadata.size,
        };
      }),
    );
    const pdfHash = await sha256File(stagedPdf);
    const manifestPath = join(generationPath, "render.json");
    const manifest = {
      schemaVersion: RENDER_SCHEMA_VERSION,
      rendererVersion: RENDER_TOOL_VERSION,
      input: { docx: { path: canonicalDocx, sha256: docxHash } },
      output: {
        pdf: {
          path: pdfPath,
          sha256: pdfHash,
          bytes: (await stat(stagedPdf)).size,
          pages: pdfPages,
        },
        pages: pageImages,
      },
      executables,
      raster: { dpi: PAGE_DPI, format: "png" },
      searchableTextProof: {
        extractor: executables.pdftotext,
        textSha256: sha256Text(searchableText),
        nonWhitespaceCodePointCount: [...searchableText].filter((character) => !/\s/u.test(character)).length,
        hangulCodePointCount,
      },
    } as const;
    await writeSyncedFile(join(staging, "render.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await syncDirectory(staging);
    await rename(staging, generationPath);
    publishedGeneration = generationPath;
    await syncDirectory(generationsRoot);

    currentTemporary = join(root, "rendered", `.current.${randomUUID()}.tmp`);
    await symlink(join("generations", generationId), currentTemporary, "dir");
    await rename(currentTemporary, currentPath);
    currentPublished = true;
    await syncDirectory(join(root, "rendered"));

    await assertPublishedArtifacts(manifestPath, pdfPath, pageImages, docxHash, pdfHash);
    await writeReceipt({
      stage: "RENDERED",
      files: [canonicalDocx, manifestPath, pdfPath, ...pageImages.map((page) => page.path)],
      inputReceiptHashes: [await sha256File(buildReceiptPath)],
      output: renderReceiptPath,
      toolVersion: RENDER_TOOL_VERSION,
    });
    receiptWritten = true;
    const receiptVerification = await verifyReceipt(renderReceiptPath);
    if (!receiptVerification.valid) {
      throw new KppError("KPP_RENDER_RECEIPT_INVALID", "RENDERED 영수증 검증에 실패했습니다.", {
        path: renderReceiptPath,
        actual: receiptVerification.mismatches,
        stage: "RENDERED",
      });
    }
    await advanceProject(root, "RENDERED");

    return {
      state: "RENDERED",
      generationPath,
      manifestPath,
      pdfPath,
      pdfPages,
      pageImages,
      searchableText,
      executables,
    };
  } catch (error) {
    const state = await readProject(root).catch(() => undefined);
    if (state?.state !== "RENDERED" && receiptWritten) {
      await rm(renderReceiptPath, { force: true });
    }
    if (state?.state !== "RENDERED" && currentPublished) {
      await rm(currentPath, { force: true });
    }
    if (currentTemporary !== undefined) {
      await rm(currentTemporary, { force: true });
    }
    throw error;
  } finally {
    if (publishedGeneration === undefined) {
      await rm(staging, { force: true, recursive: true });
    }
  }
}

async function resolveRenderExecutables(
  tools: RenderToolPaths = {},
): Promise<RenderExecutables> {
  const sofficeCandidates = compact([
    tools.soffice,
    process.env.KPP_SOFFICE_PATH,
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "soffice",
    "libreoffice",
  ]);
  const popplerCandidates = (explicit: string | undefined, name: string): string[] => compact([
    explicit,
    process.env[`KPP_${name.toUpperCase()}_PATH`],
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    name,
  ]);
  const [soffice, pdfinfo, pdftotext, pdftoppm] = await Promise.all([
    resolveVerifiedExecutable({ name: "soffice", candidates: sofficeCandidates, versionArgs: ["--version"] }),
    resolveVerifiedExecutable({ name: "pdfinfo", candidates: popplerCandidates(tools.pdfinfo, "pdfinfo"), versionArgs: ["-v"] }),
    resolveVerifiedExecutable({ name: "pdftotext", candidates: popplerCandidates(tools.pdftotext, "pdftotext"), versionArgs: ["-v"] }),
    resolveVerifiedExecutable({ name: "pdftoppm", candidates: popplerCandidates(tools.pdftoppm, "pdftoppm"), versionArgs: ["-v"] }),
  ]);
  return { soffice, pdfinfo, pdftotext, pdftoppm };
}

async function canonicalBuiltDocx(root: string, inputPath: string): Promise<string> {
  const requested = resolve(inputPath);
  const requestedMetadata = await lstat(requested).catch(() => undefined);
  if (requestedMetadata?.isSymbolicLink() === true) {
    throw new KppError("KPP_RENDER_DOCX_NOT_CANONICAL", "DOCX symlink는 canonical 입력으로 사용할 수 없습니다.", {
      path: requested,
      stage: "BUILT",
    });
  }
  const canonical = await realpath(requested).catch(() => undefined);
  if (canonical === undefined || extname(canonical).toLowerCase() !== ".docx") {
    throw new KppError("KPP_RENDER_DOCX_MISSING", "canonical DOCX를 찾을 수 없습니다.", {
      path: resolve(inputPath),
      stage: "BUILT",
    });
  }
  const generationsRoot = await realpath(join(root, "build", "generations")).catch(() => undefined);
  if (generationsRoot === undefined || !isWithin(generationsRoot, canonical)) {
    throw new KppError("KPP_RENDER_DOCX_NOT_CANONICAL", "DOCX가 immutable BUILT generation에 있지 않습니다.", {
      path: canonical,
      expected: generationsRoot,
      stage: "BUILT",
    });
  }
  await assertNonemptyFile(canonical, "KPP_RENDER_DOCX_MISSING");
  return canonical;
}

async function findReceiptFile(
  files: readonly { readonly path: string; readonly sha256: string }[],
  canonicalPath: string,
): Promise<{ readonly path: string; readonly sha256: string } | undefined> {
  for (const file of files) {
    const path = await realpath(file.path).catch(() => undefined);
    if (path === canonicalPath) {
      return file;
    }
  }
  return undefined;
}

function parsePageCount(output: string): number {
  const match = /^Pages:\s+(\d+)\s*$/mu.exec(output);
  const pages = Number.parseInt(match?.[1] ?? "", 10);
  if (!Number.isInteger(pages) || pages < 1) {
    throw new KppError("KPP_RENDER_PAGE_COUNT", "PDF 페이지 수를 확인할 수 없습니다.", {
      actual: output,
      stage: "BUILT",
    });
  }
  return pages;
}

async function assertPublishedArtifacts(
  manifestPath: string,
  pdfPath: string,
  pageImages: readonly PageImageArtifact[],
  expectedDocxHash: string,
  expectedPdfHash: string,
): Promise<void> {
  await assertNonemptyFile(manifestPath, "KPP_RENDER_MANIFEST_MISSING");
  await assertNonemptyFile(pdfPath, "KPP_RENDER_PDF_MISSING");
  if (await sha256File(pdfPath) !== expectedPdfHash) {
    throw new KppError("KPP_RENDER_PDF_STALE", "published PDF 해시가 manifest와 다릅니다.", {
      path: pdfPath,
      expected: expectedPdfHash,
      actual: await sha256File(pdfPath),
      stage: "BUILT",
    });
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    input?: { docx?: { sha256?: string } };
    output?: { pdf?: { sha256?: string } };
  };
  if (manifest.input?.docx?.sha256 !== expectedDocxHash ||
      manifest.output?.pdf?.sha256 !== expectedPdfHash) {
    throw new KppError("KPP_RENDER_MANIFEST_STALE", "render manifest 해시가 산출물과 다릅니다.", {
      path: manifestPath,
      actual: manifest,
      stage: "BUILT",
    });
  }
  for (const page of pageImages) {
    await assertNonemptyFile(page.path, "KPP_RENDER_PAGE_IMAGE_MISSING");
    if (await sha256File(page.path) !== page.sha256) {
      throw new KppError("KPP_RENDER_PAGE_IMAGE_STALE", "페이지 이미지 해시가 manifest와 다릅니다.", {
        path: page.path,
        expected: page.sha256,
        actual: await sha256File(page.path),
        stage: "BUILT",
      });
    }
  }
}

async function assertNonemptyFile(path: string, code: string): Promise<void> {
  const metadata = await stat(path).catch(() => undefined);
  if (metadata === undefined || !metadata.isFile() || metadata.size < 1) {
    throw new KppError(code, "필수 렌더링 산출물이 없거나 비어 있습니다.", {
      path,
      stage: "BUILT",
    });
  }
}

async function assertAbsent(path: string, code: string): Promise<void> {
  const metadata = await lstat(path).catch(() => undefined);
  if (metadata !== undefined) {
    throw new KppError(code, "기존 canonical 렌더링 산출물을 덮어쓸 수 없습니다.", {
      path,
      stage: "BUILT",
    });
  }
}

async function writeSyncedFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function compact(values: readonly (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined && value.length > 0);
}

function isWithin(parent: string, child: string): boolean {
  const segment = relative(parent, child);
  return segment.length > 0 && segment !== ".." &&
    !segment.startsWith(`..${sep}`) && !isAbsolute(segment);
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
