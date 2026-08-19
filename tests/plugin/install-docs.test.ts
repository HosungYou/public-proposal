import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const PUBLISHED_SETUP = "npx --yes @longtable/public-proposal@0.1.3 setup --provider codex";
const PUBLISHED_DOCTOR = "npx --yes @longtable/public-proposal@0.1.3 doctor --json";
const GLOBAL_DOCTOR_LINE = /^public-proposal doctor --json$/mu;
const UNPINNED_COMMAND_LINE = /^\s*npx(?: --yes)? @longtable\/public-proposal (?:setup|doctor|update|uninstall)\b.*$/mu;
const FUTURE_VNEXT_SETUP = "npx --yes @longtable/public-proposal@<vnext-version> setup --provider codex";

async function readInstallationDocs(): Promise<InstallationDocs> {
  const [readme, install, packageReadme, beta, matrixRaw] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("docs/installation/INSTALL.md", "utf8"),
    readFile("apps/public-proposal-cli/README.md", "utf8"),
    readFile("docs/VNEXT-BETA.md", "utf8"),
    readFile("docs/installation/compatibility-matrix.json", "utf8"),
  ]);
  return {
    readme,
    install,
    packageReadme,
    beta,
    matrix: JSON.parse(matrixRaw) as Record<string, unknown>,
  };
}

test("documentation exposes a runnable ephemeral install and doctor path", async () => {
  const { readme, install, packageReadme, beta } = await readInstallationDocs();

  for (const document of [readme, install, packageReadme, beta]) {
    expect(document).toContain(PUBLISHED_SETUP);
    expect(document).toContain(PUBLISHED_DOCTOR);
    expect(document).toContain("@longtable/public-proposal@0.1.3");
    expect(document).not.toContain("not yet available from the public npm registry");
    expect(document).toContain("Published 0.1.3 legacy/current behavior");
    expect(document).toContain("Local vNext tarball / hermetic verification");
    expect(document).toContain("Future vNext registry command");
    expect(document).toContain(FUTURE_VNEXT_SETUP);
    expect(document).not.toMatch(UNPINNED_COMMAND_LINE);
  }

  const [primaryGuide] = install.split("## Manual fallback");
  expect(primaryGuide).toBeDefined();
  expect(primaryGuide).not.toMatch(GLOBAL_DOCTOR_LINE);
  expect(readme).not.toMatch(GLOBAL_DOCTOR_LINE);
  expect(packageReadme).not.toMatch(GLOBAL_DOCTOR_LINE);
});

test("documentation separates all four authorities, permissions, and research classes", async () => {
  const { readme, install, packageReadme } = await readInstallationDocs();
  const combined = `${readme}\n${install}\n${packageReadme}`;

  for (const authority of [
    "$public-proposal",
    "korean-public-proposal",
    "@longtable/kpp-cli",
    "LongTable",
  ]) {
    expect(combined).toContain(authority);
  }
  expect(combined).toContain("Plugin installation does not expand Codex permissions");
  for (const proposalClass of [
    "academic_research",
    "research_service",
    "policy_research",
    "general_procurement",
    "document_restyle",
  ]) {
    expect(install).toContain(proposalClass);
  }
  expect(install).toContain("LongTable research lock");
  expect(install).toContain("scholar-research");
  expect(install).toContain("canonical `longtable-research`");
  expect(install).toContain("Required only when locked requirements contain an academic-evidence slot");
  expect(install).toContain("Not required");
});

test("manual global fallback is distinct and the matrix records exact compatibility facts", async () => {
  const { install, matrix } = await readInstallationDocs();
  const [, manualFallback] = install.split("## Manual fallback");

  expect(manualFallback).toContain("npm install --global @longtable/public-proposal@0.1.3 @longtable/kpp-cli@0.2.1 @longtable/cli@0.1.72");
  expect(manualFallback).toMatch(GLOBAL_DOCTOR_LINE);
  expect(manualFallback).toContain("This section alone assumes the globally installed `public-proposal` executable.");
  expect(manualFallback).toContain("npx --yes @longtable/public-proposal@0.1.3 uninstall");
  expect(manualFallback).toContain("npx --yes @longtable/public-proposal@0.1.3 update");
  expect(matrix).toMatchObject({
    installerPackage: "@longtable/public-proposal",
    installerVersion: "0.1.3",
    kppPackage: "@longtable/kpp-cli",
    kppVersion: "0.2.1",
    longtablePackage: "@longtable/cli",
    longtableVersion: "0.1.72",
    workerProtocol: "1.0.0",
    pluginId: "public-proposal",
    pluginVersion: "0.1.0",
    node: ">=22 <27",
    python: ">=3.11 <3.15",
    verifiedAt: "2026-08-18",
  });
  expect(matrix.runtimeRangeEnforcement).toContain("do not enforce Node or Python semver ranges");
});

test("installation guidance retains the required recovery paths", async () => {
  const { install } = await readInstallationDocs();

  for (const code of [
    "PP_WORKER_PROTOCOL_MISSING",
    "PP_LONGTABLE_REQUIRED",
    "PP_RESEARCH_LOCK_MISSING",
  ]) {
    expect(install).toContain(code);
  }
  expect(install).toContain(PUBLISHED_DOCTOR);
  expect(install).toContain("public-proposal uninstall");
});

test("documentation explains the global Codex marketplace scope collision", async () => {
  const { readme, install, packageReadme, beta } = await readInstallationDocs();

  for (const document of [readme, install, packageReadme, beta]) {
    expect(document).toContain("single global Codex `public-proposal` marketplace selector");
    expect(document).toContain("PP_MARKETPLACE_CONFLICT");
  }
  expect(install).toContain("Choose one scope, uninstall the existing Public Proposal installation");
  expect(install).toContain("npx --yes @longtable/public-proposal@0.1.3 uninstall --install-scope user");
  expect(install).toContain("npx --yes @longtable/public-proposal@0.1.3 setup --provider codex --install-scope project");
});

interface InstallationDocs {
  readonly readme: string;
  readonly install: string;
  readonly packageReadme: string;
  readonly beta: string;
  readonly matrix: Record<string, unknown>;
}
