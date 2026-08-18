import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("documentation exposes the one-command install and separates the four authorities", async () => {
  const [readme, install, matrixRaw] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("docs/installation/INSTALL.md", "utf8"),
    readFile("docs/installation/compatibility-matrix.json", "utf8"),
  ]);
  const matrix = JSON.parse(matrixRaw) as Record<string, unknown>;
  const combined = `${readme}\n${install}`;

  expect(readme).toContain("npx @longtable/public-proposal setup --provider codex");
  expect(readme).toContain("@longtable/kpp-cli@0.2.1");
  expect(readme).toContain("@longtable/cli@0.1.72");
  expect(combined).toContain("$public-proposal");
  expect(combined).toContain("korean-public-proposal");
  expect(combined).toContain("@longtable/kpp-cli");
  expect(combined).toContain("LongTable");
  expect(install).toContain("LongTable research lock");
  expect(install).toContain("academic_research");
  expect(install).toContain("Plugin installation does not expand Codex permissions");
  expect(matrix).toMatchObject({
    installerVersion: "0.1.0",
    kppVersion: "0.2.1",
    longtableVersion: "0.1.72",
    workerProtocol: "1.0.0",
    pluginVersion: "0.1.0",
    node: ">=22 <27",
    python: ">=3.11 <3.15",
    verifiedAt: "2026-08-18",
  });
});

test("installation guidance includes the required recovery paths", async () => {
  const install = await readFile("docs/installation/INSTALL.md", "utf8");

  for (const code of [
    "PP_WORKER_PROTOCOL_MISSING",
    "PP_LONGTABLE_REQUIRED",
    "PP_RESEARCH_LOCK_MISSING",
  ]) {
    expect(install).toContain(code);
  }
  expect(install).toContain("public-proposal doctor --json");
  expect(install).toContain("public-proposal uninstall");
});
