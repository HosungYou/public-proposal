#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_PROPOSAL_BINARY = join(REPOSITORY_ROOT, "apps/public-proposal-cli/dist/main.js");
const KPP_BINARY = join(REPOSITORY_ROOT, "apps/kpp-cli/dist/main.js");
const FIXTURE_SOURCE = join(REPOSITORY_ROOT, "fixtures/valid/minimal-research-proposal");
const KPP_VERSION = "0.2.1";
const LONGTABLE_VERSION = "0.1.72";
const WORKER_PROTOCOL = "1.0.0";
const REQUIRED_RESEARCH_CLASSES = ["academic_research", "research_service", "policy_research"];

export async function runCleanEnvironmentFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "public-proposal-clean-install-"));
  const home = join(fixtureRoot, "home");
  const installRoot = join(fixtureRoot, "install");
  const fakeBin = join(fixtureRoot, "fake-bin");
  const fontRoot = join(fixtureRoot, "fonts");
  await Promise.all([mkdir(home, { recursive: true }), mkdir(fontRoot, { recursive: true })]);
  await Promise.all([
    writeFile(join(fontRoot, "NotoSansCJKkr-Regular.otf"), "fixture-font\n"),
    writeFile(join(fontRoot, "NotoSerifCJKkr-Regular.otf"), "fixture-font\n"),
  ]);
  await createFakeToolchain(fakeBin);

  const env = isolatedEnvironment({ fixtureRoot, home, fakeBin, installRoot, fontRoot });
  const commands = [];
  commands.push(await capture(
    "public-proposal setup",
    process.execPath,
    [PUBLIC_PROPOSAL_BINARY, "setup", "--provider", "codex", "--install-root", installRoot, "--json"],
    { env },
  ));
  commands.push(await capture(
    "public-proposal doctor",
    process.execPath,
    [PUBLIC_PROPOSAL_BINARY, "doctor", "--install-root", installRoot, "--project-class", "research_service", "--json"],
    { env },
  ));
  commands.push(await capture("kpp doctor", process.execPath, [KPP_BINARY, "doctor", "--json"], { env }));
  commands.push(await capture("longtable doctor", "longtable", ["scholar-research", "doctor", "--json"], { env }));

  const installationPath = join(installRoot, "installation.json");
  const manifest = await readJson(installationPath).catch(() => null);
  const pluginManifestPath = join(installRoot, "plugin", ".codex-plugin", "plugin.json");
  const marketplacePath = join(installRoot, "marketplace", "marketplace.json");
  const pluginManifest = await readJson(pluginManifestPath).catch(() => null);
  const marketplace = await readJson(marketplacePath).catch(() => null);
  const marketplaceEntry = marketplace?.plugins?.find?.((entry) => entry?.name === "public-proposal");
  const setupEnvelope = parseEnvelope(commands[0].stdout, commands[0].stderr);
  const publicDoctorEnvelope = parseEnvelope(commands[1].stdout, commands[1].stderr);
  const kppDoctorEnvelope = parseEnvelope(commands[2].stdout, commands[2].stderr);
  const longtableDoctorEnvelope = parseEnvelope(commands[3].stdout, commands[3].stderr);
  const kppWorkerCheck = kppDoctorEnvelope?.data?.checks?.find?.(({ name }) => name === "worker_protocol");
  const paths = await listFiles(fixtureRoot);
  const report = {
    ok: commands.every(({ exitCode }) => exitCode === 0)
      && setupEnvelope.ok === true
      && publicDoctorEnvelope.ok === true
      && kppDoctorEnvelope.ok === true
      && kppWorkerCheck?.status === "pass"
      && longtableDoctorEnvelope.ok === true
      && manifest?.kppVersion === KPP_VERSION
      && manifest?.longtableVersion === LONGTABLE_VERSION
      && manifest?.workerProtocol === WORKER_PROTOCOL
      && pluginManifest?.name === "public-proposal"
      && marketplaceEntry?.source?.path === "../plugin",
    fixtureRoot,
    home,
    installRoot,
    manifestPath: installationPath,
    manifest,
    plugin: {
      name: pluginManifest?.name ?? null,
      version: pluginManifest?.version ?? null,
      marketplaceSource: marketplaceEntry?.source?.path ?? null,
    },
    envelopes: { setup: setupEnvelope, publicDoctor: publicDoctorEnvelope, kppDoctor: kppDoctorEnvelope, longtableDoctor: longtableDoctorEnvelope },
    commands,
    paths,
  };
  const reportPath = join(fixtureRoot, "clean-install-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { exitCode: report.ok ? 0 : 1, report: { ...report, reportPath } };
}

export async function runProposalClassFixture({ proposalClass, researchLock }) {
  assertProposalClass(proposalClass);
  const fixtureRoot = await mkdtemp(join(tmpdir(), `public-proposal-${proposalClass}-`));
  const fixture = join(fixtureRoot, "fixture");
  const projectRoot = join(fixtureRoot, "project");
  await cp(FIXTURE_SOURCE, fixture, { recursive: true, force: false });
  const projectId = `verification-${proposalClass}`;
  const init = await runKpp(["init", projectRoot, "--project-id", projectId, "--proposal-class", proposalClass, "--json"]);
  if (init.exitCode !== 0) return { fixtureRoot, envelope: parseEnvelope(init.stdout, init.stderr) };

  if (!researchLock && REQUIRED_RESEARCH_CLASSES.includes(proposalClass)) {
    const blocked = await runKpp(["export-authoring", projectRoot, "--json"]);
    return { fixtureRoot, envelope: parseEnvelope(blocked.stdout, blocked.stderr) };
  }
  if (proposalClass === "document_restyle") {
    const optional = await runKpp(["export-authoring", projectRoot, "--json"]);
    return { fixtureRoot, envelope: parseEnvelope(optional.stdout, optional.stderr) };
  }

  const rfpPath = join(fixture, "issuer-rfp.txt");
  const candidatesPath = join(fixture, "candidates.json");
  const decisionsPath = join(fixture, "requirement-decisions.json");
  const evidencePath = join(fixture, "evidence", "method-evidence.txt");
  const issuerProfilePath = join(fixture, "issuer-profile.json");
  const terminologyPath = join(fixture, "terminology.json");
  const responsePath = join(fixture, "content", "authoring-response-final.json");

  await requireKpp(["ingest", projectRoot, rfpPath, "--json"]);
  await materializeTemplate(join(fixture, "candidates-template.json"), candidatesPath, {
    __ISSUER_RFP_PATH__: rfpPath,
  });
  await materializeTemplate(join(fixture, "requirement-decisions-template.json"), decisionsPath, {
    __METHOD_EVIDENCE_PATH__: evidencePath,
  });
  await requireKpp([
    "requirements",
    projectRoot,
    "--candidates",
    candidatesPath,
    "--decisions",
    decisionsPath,
    "--json",
  ]);
  const requirementsPath = join(projectRoot, "requirements", "requirements.json");
  await requireKpp(["plan", projectRoot, "--requirements", requirementsPath, "--json"]);
  if (researchLock) await createResearchLock(projectRoot, projectId, proposalClass);
  await requireKpp([
    "export-authoring",
    projectRoot,
    "--issuer-profile",
    issuerProfilePath,
    "--terminology",
    terminologyPath,
    "--json",
  ]);
  await requireKpp(["import-authoring", projectRoot, "--response", responsePath, "--json"]);

  const core = await import(join(REPOSITORY_ROOT, "packages/core/dist/index.js"));
  const designProfilePath = join(projectRoot, "figures", "design-profile.json");
  await cp(join(fixture, "figures", "design-profile.json"), designProfilePath, { force: false });
  const pagePlanPath = join(projectRoot, "content", "page-plan.json");
  await core.writeReceipt({
    stage: "DESIGN_LOCKED",
    files: [designProfilePath, pagePlanPath],
    inputReceiptHashes: [await core.sha256File(join(projectRoot, "receipts", "evidence-lock.json"))],
    output: join(projectRoot, "receipts", "design-lock.json"),
  });
  await core.advanceProject(projectRoot, "DESIGN_LOCKED");
  const approval = await runKpp([
    "content-approve",
    projectRoot,
    "--approved-by",
    "release-verification-owner",
    "--json",
  ]);
  return { fixtureRoot, envelope: parseEnvelope(approval.stdout, approval.stderr) };
}

export async function verifyPackageContracts() {
  const packagePaths = [
    "packages/schemas/package.json",
    "packages/core/package.json",
    "packages/renderers/package.json",
    "packages/audits/package.json",
    "apps/kpp-cli/package.json",
  ];
  const packages = await Promise.all(packagePaths.map(async (path) => ({ path, value: await readJson(join(REPOSITORY_ROOT, path)) })));
  const mismatched = packages.filter(({ value }) => value.version !== KPP_VERSION);
  if (mismatched.length > 0) {
    throw new Error(`KPP workspace packages must remain at ${KPP_VERSION}: ${mismatched.map(({ path, value }) => `${path}=${value.version}`).join(", ")}`);
  }
  for (const { path, value } of packages) {
    for (const [name, version] of Object.entries(value.dependencies ?? {})) {
      if (name.startsWith("@longtable/kpp-") && version !== KPP_VERSION) {
        throw new Error(`${path} pins ${name} to ${version}, expected ${KPP_VERSION}`);
      }
    }
  }
  const meta = await readJson(join(REPOSITORY_ROOT, "apps/public-proposal-cli/package.json"));
  if (meta.dependencies?.["@longtable/kpp-cli"] !== KPP_VERSION || meta.dependencies?.["@longtable/cli"] !== LONGTABLE_VERSION) {
    throw new Error("The meta-installer must pin the exact KPP and LongTable CLI versions.");
  }
  const plugin = await readJson(join(REPOSITORY_ROOT, "apps/public-proposal-cli/plugin/.codex-plugin/plugin.json"));
  const marketplace = await readJson(join(REPOSITORY_ROOT, "apps/public-proposal-cli/marketplace/marketplace.json"));
  const bundle = await readJson(join(REPOSITORY_ROOT, "apps/public-proposal-cli/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json"));
  const entry = marketplace.plugins?.find?.((candidate) => candidate?.name === "public-proposal");
  if (plugin.name !== "public-proposal" || entry?.source?.path !== "../plugin" || !Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error("The packaged Codex plugin, marketplace, or Korean authority bundle is invalid.");
  }
  await verifyBundleHashes(bundle);
  const workerProtocolSource = await readFile(join(REPOSITORY_ROOT, "workers/docx-python/src/kpp_docx/protocol.py"), "utf8");
  if (!workerProtocolSource.includes(`PROTOCOL_VERSION = \"${WORKER_PROTOCOL}\"`)) {
    throw new Error(`Managed worker protocol must remain ${WORKER_PROTOCOL}.`);
  }
  return {
    kppPackages: Object.fromEntries(packages.map(({ value }) => [value.name, value.version])),
    metaDependencies: {
      "@longtable/kpp-cli": meta.dependencies["@longtable/kpp-cli"],
      "@longtable/cli": meta.dependencies["@longtable/cli"],
    },
    workerProtocol: WORKER_PROTOCOL,
    plugin: { name: plugin.name, version: plugin.version, marketplaceSource: entry.source.path, bundleFiles: bundle.files.length },
  };
}

export async function runReleaseVerification() {
  const artifactRoot = await mkdtemp(join(tmpdir(), "public-proposal-release-verification-"));
  const commands = [];
  const runRequired = async (name, command, args, options = {}) => {
    const result = await capture(name, command, args, { cwd: REPOSITORY_ROOT, ...options });
    commands.push(result);
    if (result.exitCode !== 0) throw new VerificationError(`${name} failed`, { artifactRoot, commands });
    return result;
  };

  try {
    await runRequired("npm ci", "npm", ["ci"]);
    await runRequired("workspace build", "npm", ["run", "build"]);
    await runRequired("workspace typecheck", "npm", ["run", "typecheck"]);
    await runRequired("focused unit tests", "npm", ["test", "--", "apps/public-proposal-cli/test", "tests/plugin/install-docs.test.ts"]);
    await runRequired("full JavaScript test suite", "npm", ["test"]);
    await runRequired("Python worker tests", "uv", ["run", "--project", "workers/docx-python", "pytest", "-q"]);
    const contracts = await verifyPackageContracts();
    await runRequired("meta-installer pack dry-run", "npm", ["pack", "--workspace", "@longtable/public-proposal", "--dry-run", "--json"]);
    const pack = await runRequired("meta-installer pack", "npm", [
      "pack",
      "--workspace",
      "@longtable/public-proposal",
      "--json",
      "--pack-destination",
      artifactRoot,
    ]);
    const packData = JSON.parse(pack.stdout);
    const packRecord = Array.isArray(packData) ? packData[0] : packData;
    if (typeof packRecord?.filename !== "string" || typeof packRecord?.integrity !== "string") {
      throw new VerificationError("npm pack did not report filename and integrity", { artifactRoot, commands });
    }
    const tarballPath = join(artifactRoot, packRecord.filename);
    const tarball = await inspectTarball(tarballPath, packRecord.integrity);
    const dryRunHome = join(artifactRoot, "dry-run-home");
    await mkdir(dryRunHome, { recursive: true });
    await runRequired(
      "npx @longtable/public-proposal setup --dry-run",
      "npx",
      ["--yes", "--package", tarballPath, "public-proposal", "setup", "--provider", "codex", "--dry-run", "--json"],
      { env: { ...process.env, HOME: dryRunHome, USERPROFILE: dryRunHome, LONGTABLE_HOME: join(dryRunHome, ".longtable") } },
    );
    const install = await runCleanEnvironmentFixture();
    if (install.exitCode !== 0) throw new VerificationError("clean install doctor chain failed", { artifactRoot, commands, install });
    const matrix = {};
    for (const proposalClass of REQUIRED_RESEARCH_CLASSES) {
      const fixture = await runProposalClassFixture({ proposalClass, researchLock: false });
      matrix[`${proposalClass}:missing`] = fixture.envelope;
      if (fixture.envelope.code !== "PP_RESEARCH_LOCK_MISSING") {
        throw new VerificationError(`${proposalClass} did not fail closed without LongTable`, { artifactRoot, commands, matrix });
      }
    }
    for (const input of [
      { proposalClass: "research_service", researchLock: true },
      { proposalClass: "general_procurement", researchLock: false },
    ]) {
      const fixture = await runProposalClassFixture(input);
      matrix[`${input.proposalClass}:${input.researchLock ? "locked" : "optional"}`] = fixture.envelope;
      if (fixture.envelope?.data?.state !== "CONTENT_APPROVED") {
        throw new VerificationError(`${input.proposalClass} fixture did not reach CONTENT_APPROVED`, { artifactRoot, commands, matrix });
      }
    }
    const report = { ok: true, artifactRoot, contracts, tarball, cleanInstall: install.report, matrix, commands };
    const reportPath = join(artifactRoot, "verification-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return { ...report, reportPath };
  } catch (error) {
    const details = error instanceof VerificationError ? error.details : { artifactRoot, commands };
    const report = { ok: false, artifactRoot, error: error instanceof Error ? error.message : String(error), ...details };
    const reportPath = join(artifactRoot, "verification-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    throw new VerificationError(`${report.error}; report: ${reportPath}`, { ...report, reportPath });
  }
}

async function createResearchLock(root, projectId, proposalClass) {
  const core = await import(join(REPOSITORY_ROOT, "packages/core/dist/index.js"));
  const researchRoot = join(root, "evidence", "research-lock");
  await mkdir(researchRoot, { recursive: true });
  const artifacts = {
    researchSpecification: join(researchRoot, "research-specification.json"),
    citationSlotMatrix: join(researchRoot, "citation-slot-matrix.json"),
    sourceLedger: join(researchRoot, "source-ledger.json"),
    claimTransferLedger: join(researchRoot, "claim-transfer-ledger.json"),
  };
  await Promise.all([
    writeFile(artifacts.researchSpecification, '{"researchQuestions":["fixture"]}\n'),
    writeFile(artifacts.citationSlotMatrix, '{"slots":[{"slotId":"CITE-1","required":true}]}\n'),
    writeFile(artifacts.sourceLedger, '{"sources":[{"sourceId":"SRC-1"}]}\n'),
    writeFile(artifacts.claimTransferLedger, '{"transfers":[{"claimId":"CLAIM-METHOD","decision":"bounded"}]}\n'),
  ]);
  const handoffPath = join(researchRoot, "handoff.json");
  await writeFile(handoffPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    longtableVersion: LONGTABLE_VERSION,
    projectId,
    proposalClass,
    researchSpecificationPath: "evidence/research-lock/research-specification.json",
    researchSpecificationSha256: await core.sha256File(artifacts.researchSpecification),
    citationSlotMatrixPath: "evidence/research-lock/citation-slot-matrix.json",
    citationSlotMatrixSha256: await core.sha256File(artifacts.citationSlotMatrix),
    sourceLedgerPath: "evidence/research-lock/source-ledger.json",
    sourceLedgerSha256: await core.sha256File(artifacts.sourceLedger),
    claimTransferLedgerPath: "evidence/research-lock/claim-transfer-ledger.json",
    claimTransferLedgerSha256: await core.sha256File(artifacts.claimTransferLedger),
    openRequiredCheckpoints: [],
    createdAt: "2026-08-18T00:00:00.000Z",
  }, null, 2)}\n`);
  await core.importResearchLock(root, handoffPath, LONGTABLE_VERSION);
}

async function createFakeToolchain(fakeBin) {
  await mkdir(fakeBin, { recursive: true });
  const source = `#!${process.execPath}\n${fakeRunnerSource()}`;
  await Promise.all(["node", "npm", "codex", "python3", "soffice", "fc-match", "kpp", "longtable", "uv"].map(async (name) => {
    const path = join(fakeBin, name);
    await writeFile(path, source, { mode: 0o755 });
    await chmod(path, 0o755);
  }));
}

function fakeRunnerSource() {
  return String.raw`
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
const name = basename(process.argv[1]);
const args = process.argv.slice(2);
if (name === "node") process.stdout.write("v22.20.0\n");
else if (name === "npm") process.stdout.write("10.9.3\n");
else if (name === "python3") process.stdout.write("Python 3.12.0\n");
else if (name === "soffice") process.stdout.write("LibreOffice 25.2.0\n");
else if (name === "fc-match") process.stdout.write("NotoSansCJKkr-Regular.otf: Noto Sans CJK KR\n");
else if (name === "kpp") process.stdout.write("@longtable/kpp-cli 0.2.1\n");
else if (name === "longtable" && args[0] === "--version") process.stdout.write("@longtable/cli 0.1.72\n");
else if (name === "longtable" && args.includes("doctor")) process.stdout.write('{"ok":true,"code":"LONGTABLE_OK"}\n');
else if (name === "longtable") process.stdout.write('{"ok":true}\n');
else if (name === "codex" && args[0] === "--version") process.stdout.write("codex-cli 0.144.5\n");
else if (name === "codex" && args.join(" ").includes("list --json")) process.stdout.write("[]\n");
else if (name === "codex") process.stdout.write('{"ok":true}\n');
else if (name === "uv") {
  const environment = process.env.UV_PROJECT_ENVIRONMENT
    || (process.env.PUBLIC_PROPOSAL_INSTALLATION_MANIFEST
      ? join(dirname(process.env.PUBLIC_PROPOSAL_INSTALLATION_MANIFEST), "worker", ".venv")
      : undefined);
  if (!environment) { process.stderr.write("UV_PROJECT_ENVIRONMENT missing\n"); process.exitCode = 2; }
  else {
    const python = join(environment, "bin", "python");
    await mkdir(join(environment, "bin"), { recursive: true });
    await writeFile(python, '#!/bin/sh\nprintf "1.0.0\\n"\n', { mode: 0o755 });
    await chmod(python, 0o755);
  }
} else { process.stderr.write("unexpected fake command: " + name + " " + args.join(" ") + "\n"); process.exitCode = 127; }
`;
}

function isolatedEnvironment({ fixtureRoot, home, fakeBin, installRoot, fontRoot }) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    LONGTABLE_HOME: join(fixtureRoot, "isolated-longtable-state"),
    PUBLIC_PROPOSAL_INSTALLATION_MANIFEST: join(installRoot, "installation.json"),
    KPP_NOTO_SANS_PATH: join(fontRoot, "NotoSansCJKkr-Regular.otf"),
    KPP_NOTO_SERIF_PATH: join(fontRoot, "NotoSerifCJKkr-Regular.otf"),
    KPP_SOFFICE_PATH: join(fakeBin, "soffice"),
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
  };
}

async function verifyBundleHashes(bundle) {
  const root = join(REPOSITORY_ROOT, "apps/public-proposal-cli/plugin/skills/korean-public-proposal");
  for (const file of bundle.files) {
    if (typeof file.path !== "string" || !/^[a-f0-9]{64}$/u.test(file.sha256 ?? "")) {
      throw new Error("Korean authority bundle has an invalid file binding.");
    }
    const actual = createHash("sha256").update(await readFile(join(root, file.path))).digest("hex");
    if (actual !== file.sha256) throw new Error(`Korean authority bundle hash mismatch: ${file.path}`);
  }
}

async function inspectTarball(path, expectedIntegrity) {
  const contents = await readFile(path);
  const integrity = `sha512-${createHash("sha512").update(contents).digest("base64")}`;
  if (integrity !== expectedIntegrity) throw new Error(`Tarball integrity mismatch for ${basename(path)}`);
  const listing = await capture("tarball listing", "tar", ["-tzf", path], { cwd: REPOSITORY_ROOT });
  if (listing.exitCode !== 0) throw new Error(`Cannot inspect tarball: ${listing.stderr}`);
  const files = listing.stdout.trim().split("\n").filter(Boolean);
  for (const required of [
    "package/dist/main.js",
    "package/plugin/.codex-plugin/plugin.json",
    "package/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json",
    "package/marketplace/marketplace.json",
    "package/worker/pyproject.toml",
    "package/worker/uv.lock",
  ]) {
    if (!files.includes(required)) throw new Error(`Tarball is missing ${required}`);
  }
  return { path, bytes: contents.length, integrity, sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`, files };
}

async function runKpp(args) {
  return capture("kpp", process.execPath, [KPP_BINARY, ...args], { cwd: REPOSITORY_ROOT });
}

async function requireKpp(args) {
  const result = await runKpp(args);
  if (result.exitCode !== 0) throw new Error(`kpp ${args[0]} failed: ${result.stdout || result.stderr}`);
  return parseEnvelope(result.stdout, result.stderr);
}

function parseEnvelope(stdout, stderr) {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return { ok: false, code: "PP_VERIFY_ENVELOPE_INVALID", message: stderr || stdout, data: null };
  }
}

async function materializeTemplate(sourcePath, destinationPath, replacements) {
  const source = await readFile(sourcePath, "utf8");
  const rendered = Object.entries(replacements).reduce((value, [marker, replacement]) => value.replaceAll(marker, replacement), source);
  await writeFile(destinationPath, rendered, "utf8");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [path];
  }));
  return paths.flat().sort().map((path) => resolve(path));
}

function assertProposalClass(value) {
  const supported = [...REQUIRED_RESEARCH_CLASSES, "general_procurement", "document_restyle"];
  if (!supported.includes(value)) throw new Error(`Unsupported proposal class: ${value}`);
}

function capture(name, command, args, options = {}) {
  return new Promise((complete) => {
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPOSITORY_ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => complete({ name, command, args, startedAt, exitCode: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => complete({ name, command, args, startedAt, exitCode: code ?? 1, stdout, stderr }));
  });
}

class VerificationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "VerificationError";
    this.details = details;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleaseVerification()
    .then((report) => {
      process.stdout.write(`${JSON.stringify({ ok: true, reportPath: report.reportPath, artifactRoot: report.artifactRoot })}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
