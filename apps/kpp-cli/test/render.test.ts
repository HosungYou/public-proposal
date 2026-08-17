import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  advanceProject,
  initializeProject,
  readProject,
  sha256File,
  writeReceipt,
} from "@kpp/core";
import { afterEach, describe, expect, it } from "vitest";
import { renderProject } from "../src/commands/render.js";

const TEMPLATE = resolve(
  "workers/docx-python/assets/Korean Public Proposal A4 v1.docx",
);

describe("proposal PDF rendering", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it("renders a searchable PDF and one numbered image per page", async () => {
    const fixture = await createBuiltProject(temporaryDirectories);

    const result = await renderProject(fixture.root, {
      docxPath: fixture.docxPath,
    });

    expect(result.state).toBe("RENDERED");
    expect(result.pdfPages).toBeGreaterThan(0);
    expect(result.pageImages).toHaveLength(result.pdfPages);
    expect(result.pageImages.map((page) => page.path)).toEqual(
      result.pageImages.map((_, index) =>
        join(result.generationPath, `page-${String(index + 1).padStart(4, "0")}.png`),
      ),
    );
    expect(result.searchableText).toContain("기관 AX 중장기 로드맵");
    expect(result.executables.soffice.path).toMatch(/soffice|LibreOffice/iu);
    expect(result.executables.soffice.version).toContain("LibreOffice");
    await expect(readProject(fixture.root)).resolves.toMatchObject({ state: "RENDERED" });

    const current = await realpath(join(fixture.root, "rendered", "current"));
    expect(current).toBe(result.generationPath);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      input: { docx: { path: string; sha256: string } };
      output: { pdf: { path: string; sha256: string }; pages: unknown[] };
    };
    expect(manifest.input.docx).toEqual({
      path: await realpath(fixture.docxPath),
      sha256: await sha256File(fixture.docxPath),
    });
    expect(manifest.output.pdf).toMatchObject({
      path: result.pdfPath,
      sha256: await sha256File(result.pdfPath),
    });
    expect(manifest.output.pages).toHaveLength(result.pdfPages);
    for (const page of result.pageImages) {
      expect(page.sha256).toBe(await sha256File(page.path));
      expect(page.bytes).toBeGreaterThan(0);
    }
    await expect(stat(join(fixture.root, "receipts", "render.json")))
      .resolves.toMatchObject({ size: expect.any(Number) });
    await expect(access(join(dirname(fixture.docxPath), "shell-disabled.docx")))
      .rejects.toBeDefined();
  }, 30_000);

  it("does not publish a receipt or mutate BUILT when searchable Korean text is absent", async () => {
    const fixture = await createBuiltProject(temporaryDirectories);
    const fakeTextExtractor = join(fixture.root, "english-only-pdftotext");
    await writeFile(fakeTextExtractor, [
      "#!/bin/sh",
      "if [ \"$1\" = \"-v\" ]; then",
      "  printf 'pdftotext fake 1.0\\n' >&2",
      "else",
      "  printf 'English only text\\n'",
      "fi",
      "",
    ].join("\n"));
    await chmod(fakeTextExtractor, 0o755);

    await expect(renderProject(fixture.root, {
      docxPath: fixture.docxPath,
      tools: { pdftotext: fakeTextExtractor },
    })).rejects.toMatchObject({ code: "KPP_RENDER_KOREAN_TEXT_MISSING" });

    await expect(readProject(fixture.root)).resolves.toMatchObject({ state: "BUILT" });
    await expect(access(join(fixture.root, "receipts", "render.json")))
      .rejects.toBeDefined();
    await expect(access(join(fixture.root, "rendered", "current")))
      .rejects.toBeDefined();
    expect((await readdirSafe(join(fixture.root, "rendered", "generations")))
      .filter((name) => name.startsWith(".staging-"))).toEqual([]);
  }, 30_000);

  it("refuses to overwrite an existing current pointer", async () => {
    const fixture = await createBuiltProject(temporaryDirectories);
    await mkdir(join(fixture.root, "rendered", "current"));

    await expect(renderProject(fixture.root, { docxPath: fixture.docxPath }))
      .rejects.toMatchObject({ code: "KPP_RENDER_CURRENT_EXISTS" });

    await expect(readProject(fixture.root)).resolves.toMatchObject({ state: "BUILT" });
    await expect(access(join(fixture.root, "receipts", "render.json")))
      .rejects.toBeDefined();
  });

  it("rejects a compatibility symlink instead of rendering it as the canonical DOCX", async () => {
    const fixture = await createBuiltProject(temporaryDirectories);
    const compatibilityPath = join(fixture.root, "proposal.docx");
    await symlink(fixture.docxPath, compatibilityPath);

    await expect(renderProject(fixture.root, { docxPath: compatibilityPath }))
      .rejects.toMatchObject({ code: "KPP_RENDER_DOCX_NOT_CANONICAL" });

    await expect(readProject(fixture.root)).resolves.toMatchObject({ state: "BUILT" });
    await expect(access(join(fixture.root, "receipts", "render.json")))
      .rejects.toBeDefined();
  });

  it.each(["rendered", "rendered/generations"])(
    "rejects a pre-existing %s symlink without publishing outside the project",
    async (symlinkTarget) => {
      const fixture = await createBuiltProject(temporaryDirectories);
      const outside = await mkdtemp(join(tmpdir(), "kpp-render-outside-"));
      temporaryDirectories.push(outside);
      const sentinel = join(outside, "sentinel.txt");
      await writeFile(sentinel, "unchanged\n");

      if (symlinkTarget === "rendered/generations") {
        await rm(join(fixture.root, "rendered", "generations"), {
          force: true,
          recursive: true,
        });
        await symlink(outside, join(fixture.root, "rendered", "generations"));
      } else {
        await rm(join(fixture.root, "rendered"), { force: true, recursive: true });
        await symlink(outside, join(fixture.root, "rendered"));
      }

      await expect(renderProject(fixture.root, { docxPath: fixture.docxPath }))
        .rejects.toMatchObject({ code: "KPP_RENDER_PUBLICATION_ROOT" });

      await expect(readFile(sentinel, "utf8")).resolves.toBe("unchanged\n");
      expect(await readdir(outside)).toEqual(["sentinel.txt"]);
      await expect(readProject(fixture.root)).resolves.toMatchObject({ state: "BUILT" });
      await expect(access(join(fixture.root, "receipts", "render.json")))
        .rejects.toBeDefined();
      await expect(access(join(fixture.root, "rendered", "current")))
        .rejects.toBeDefined();
    },
  );
});

async function createBuiltProject(temporaryDirectories: string[]): Promise<{
  readonly root: string;
  readonly docxPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "kpp-render-"));
  temporaryDirectories.push(root);
  await initializeProject(root, { projectId: "render-fixture" });

  let predecessorReceipt: string | undefined;
  for (const stage of [
    "SOURCE_LOCKED",
    "REQUIREMENTS_LOCKED",
    "EVIDENCE_LOCKED",
    "DESIGN_LOCKED",
    "CONTENT_APPROVED",
  ] as const) {
    const artifact = join(root, stage.toLowerCase(), "artifact.txt");
    await mkdir(join(root, stage.toLowerCase()), { recursive: true });
    await writeFile(artifact, `${stage}\n`);
    const receiptPath = stageReceiptPath(root, stage);
    await writeReceipt({
      stage,
      files: [artifact],
      inputReceiptHashes: predecessorReceipt === undefined
        ? []
        : [await sha256File(predecessorReceipt)],
      output: receiptPath,
    });
    await advanceProject(root, stage);
    predecessorReceipt = receiptPath;
  }

  const bundleRoot = join(root, ".kpp-build-0123456789abcdef");
  const generation = join(bundleRoot, "generations", "fixture-generation");
  await mkdir(generation, { recursive: true });
  const docxPath = join(generation, "document.docx");
  await copyFile(TEMPLATE, docxPath);
  const buildManifest = join(generation, "manifest.json");
  await writeFile(buildManifest, `${JSON.stringify({
    schemaVersion: "1.0.0",
    artifacts: {
      docx: { path: docxPath, sha256: await sha256File(docxPath) },
    },
  }, null, 2)}\n`);
  await symlink(join("generations", "fixture-generation"), join(bundleRoot, "current"));
  const buildReceipt = stageReceiptPath(root, "BUILT");
  await writeReceipt({
    stage: "BUILT",
    files: [docxPath, buildManifest],
    inputReceiptHashes: predecessorReceipt === undefined
      ? []
      : [await sha256File(predecessorReceipt)],
    output: buildReceipt,
  });
  await advanceProject(root, "BUILT");
  return { root, docxPath: join(bundleRoot, "current", "document.docx") };
}

async function readdirSafe(path: string): Promise<string[]> {
  return readdir(path).catch(() => []);
}

function stageReceiptPath(
  root: string,
  stage: "SOURCE_LOCKED" | "REQUIREMENTS_LOCKED" | "EVIDENCE_LOCKED" |
    "DESIGN_LOCKED" | "CONTENT_APPROVED" | "BUILT",
): string {
  const filenames = {
    SOURCE_LOCKED: "source-lock.json",
    REQUIREMENTS_LOCKED: "requirements-lock.json",
    EVIDENCE_LOCKED: "evidence-lock.json",
    DESIGN_LOCKED: "design-lock.json",
    CONTENT_APPROVED: "content-approval.json",
    BUILT: "build.json",
  } as const;
  return join(root, "receipts", filenames[stage]);
}
