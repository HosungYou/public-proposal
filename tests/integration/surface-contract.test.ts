import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const repositoryRoot = process.cwd();
const fixtureBuilder = join(repositoryRoot, "tests", "integration", "fixtures", "complex_surface_fixture.py");
const validator = join(repositoryRoot, "plugins", "public-proposal", "skills", "korean-public-proposal", "scripts", "audit_surface_contract.py");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("bundled surface contract passes a complex research-service document", async () => {
  const result = await runAudit("valid");

  expect(result.exitCode).toBe(0);
  expect(result.report.status).toBe("PASS");
  expect(result.report.observations).toMatchObject({ tableCount: 3, svgCount: 4, pageCount: 4, bound: true });
});

test.each([
  ["missing_table_shading", "KPP_SURFACE_TABLE_HEADER_FILL"],
  ["outer_canvas_fill", "KPP_SURFACE_SVG_OUTER_CANVAS_FILL"],
  ["zebra_rows", "KPP_SURFACE_SVG_ZEBRA_FILL"],
  ["stale_figure_hash", "KPP_SURFACE_RENDER_HASH_MISMATCH"],
  ["missing_page", "KPP_SURFACE_RENDER_PAGE_MISSING"],
] as const)("bundled surface contract blocks %s", async (variant, expectedCode) => {
  const result = await runAudit(variant);

  expect(result.exitCode).not.toBe(0);
  expect(result.report.status).toBe("BLOCKED");
  expect(result.report.findings.map((finding: { code: string }) => finding.code)).toContain(expectedCode);
});

async function runAudit(variant: string): Promise<{ exitCode: number; report: any }> {
  const root = await mkdtemp(join(tmpdir(), "kpp-surface-contract-"));
  temporaryRoots.push(root);
  const fixture = JSON.parse((await execFile("python3", [fixtureBuilder, root, "--variant", variant])).stdout) as Record<string, string>;
  const output = join(root, "surface-audit.json");
  try {
    await execFile("python3", [
      validator,
      fixture.docx,
      "--contract",
      fixture.contract,
      "--svg-dir",
      fixture.svg_dir,
      "--render-manifest",
      fixture.manifest,
      "--out",
      output,
    ]);
    return { exitCode: 0, report: JSON.parse(await readFile(output, "utf8")) };
  } catch (error) {
    const report = JSON.parse(await readFile(output, "utf8"));
    return { exitCode: (error as { code?: number }).code ?? 2, report };
  }
}
