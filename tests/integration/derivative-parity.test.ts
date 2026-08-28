import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const AUDITOR = resolve("plugins/public-proposal/skills/korean-public-proposal/scripts/audit_derivative_parity.py");
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

test("blocks equal-content derivatives whose rendered page pixels drift", async () => {
  const fixture = await parityFixture({ primaryColor: "navy", derivativeColor: "white" });
  const result = await runAudit(fixture);

  expect(result.exitCode).not.toBe(0);
  expect(result.report.status).toBe("BLOCKED");
  expect(result.report.findings.map((finding: { code: string }) => finding.code))
    .toContain("KPP_DERIVATIVE_PAGE_VISUAL_DRIFT");
});

test("keeps an unrendered HWPX primary at review candidate", async () => {
  const fixture = await parityFixture({ primaryColor: "navy", derivativeColor: "navy", primaryRenderStatus: "unavailable" });
  const result = await runAudit(fixture);

  expect(result.exitCode).not.toBe(0);
  expect(result.report.status).toBe("REVIEW_CANDIDATE");
  expect(result.report.findings.map((finding: { code: string }) => finding.code))
    .toContain("KPP_DERIVATIVE_PRIMARY_RENDER_UNAVAILABLE");
});

test("passes hash-bound derivatives with the same authority, content, and rendered surface", async () => {
  const fixture = await parityFixture({ primaryColor: "navy", derivativeColor: "navy" });
  const result = await runAudit(fixture);

  expect(result.exitCode).toBe(0);
  expect(result.report).toMatchObject({
    status: "PASS",
    observations: { pageCount: 1, authorityId: "AUTH-R05", governedContentSha256: "c".repeat(64) },
  });
  expect(result.report.findings).toEqual([]);
});

async function parityFixture(input: {
  primaryColor: "navy" | "white";
  derivativeColor: "navy" | "white";
  primaryRenderStatus?: "available" | "unavailable";
}): Promise<{ root: string; authority: string; primary: string; derivative: string; output: string }> {
  const root = await mkdtemp(join(tmpdir(), "kpp-derivative-parity-"));
  roots.push(root);
  await mkdir(join(root, "pages"));
  const primaryPage = join(root, "pages", "primary-1.png");
  const derivativePage = join(root, "pages", "derivative-1.png");
  await Promise.all([
    makePng(primaryPage, input.primaryColor),
    makePng(derivativePage, input.derivativeColor),
  ]);
  const primaryArtifact = join(root, "primary.hwpx");
  const derivativeArtifact = join(root, "derivative.docx");
  await Promise.all([
    writeFile(primaryArtifact, "primary artifact\n"),
    writeFile(derivativeArtifact, "derivative artifact\n"),
  ]);
  const authority = join(root, "authority.json");
  const primary = join(root, "primary.json");
  const derivative = join(root, "derivative.json");
  const output = join(root, "parity.json");
  await writeJson(authority, {
    schemaVersion: "kpp-design-authority-1.0",
    authorityId: "AUTH-R05",
    maxPixelDifferenceRatio: 0.02,
    requiredFurniture: ["approval-box", "double-navy-rule", "roman-section-badge"],
    requiredFonts: ["AppleMyungjo"],
    minimumTableCount: 1,
    minimumFigureCount: 0,
  });
  const common = {
    schemaVersion: "kpp-derivative-artifact-1.0",
    designAuthorityId: "AUTH-R05",
    governedContentSha256: "c".repeat(64),
    surface: {
      pageWidthMm: 210,
      pageHeightMm: 297,
      fonts: ["AppleMyungjo"],
      tableCount: 1,
      figureCount: 0,
      furniture: ["approval-box", "double-navy-rule", "roman-section-badge"],
    },
  };
  await writeJson(primary, {
    ...common,
    format: "hwpx",
    artifact: { path: primaryArtifact, sha256: await sha256(primaryArtifact) },
    render: input.primaryRenderStatus === "unavailable"
      ? { status: "unavailable", pages: [] }
      : { status: "available", pages: [{ pageNumber: 1, path: primaryPage, sha256: await sha256(primaryPage) }] },
  });
  await writeJson(derivative, {
    ...common,
    format: "docx",
    artifact: { path: derivativeArtifact, sha256: await sha256(derivativeArtifact) },
    render: { status: "available", pages: [{ pageNumber: 1, path: derivativePage, sha256: await sha256(derivativePage) }] },
  });
  return { root, authority, primary, derivative, output };
}

async function makePng(path: string, color: "navy" | "white"): Promise<void> {
  const rgb = color === "navy" ? "(23, 50, 77)" : "(255, 255, 255)";
  await execFile("python3", ["-c", `from PIL import Image; Image.new('RGB', (20, 20), ${rgb}).save(r'${path}')`]);
}

async function runAudit(fixture: { authority: string; primary: string; derivative: string; output: string }): Promise<{ exitCode: number; report: any }> {
  try {
    await execFile("python3", [AUDITOR, fixture.authority, fixture.primary, fixture.derivative, "--out", fixture.output]);
    return { exitCode: 0, report: JSON.parse(await readFile(fixture.output, "utf8")) };
  } catch (error) {
    const failure = error as { code?: number };
    return { exitCode: failure.code ?? 2, report: JSON.parse(await readFile(fixture.output, "utf8")) };
  }
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
