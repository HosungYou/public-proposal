#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_PROPOSAL_BINARY = join(REPOSITORY_ROOT, "apps/public-proposal-cli/dist/main.js");
const KPP_BINARY = join(REPOSITORY_ROOT, "apps/kpp-cli/dist/main.js");
const FIXTURE_SOURCE = join(REPOSITORY_ROOT, "fixtures/valid/minimal-research-proposal");
const INSTALLER_VERSION = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "apps/public-proposal-cli/package.json"), "utf8")).version;
const KPP_VERSION = "0.3.0";
const LONGTABLE_VERSION = "0.1.72";
const WORKER_PROTOCOL = "1.0.0";
const REQUIRED_RESEARCH_CLASSES = ["academic_research", "research_service", "policy_research"];

export async function runCleanEnvironmentFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "public-proposal-clean-install-"));
  const installRoot = join(fixtureRoot, "install");
  const isolated = await prepareIsolation(fixtureRoot, installRoot);
  const { env, home } = isolated;
  const commands = [];
  commands.push(await capture(
    "public-proposal setup",
    process.execPath,
    [...writeGuardArguments(fixtureRoot), PUBLIC_PROPOSAL_BINARY, "setup", "--provider", "codex", "--install-root", installRoot, "--json"],
    { env },
  ));
  commands.push(await capture(
    "public-proposal doctor",
    process.execPath,
    [...writeGuardArguments(fixtureRoot), PUBLIC_PROPOSAL_BINARY, "doctor", "--install-root", installRoot, "--project-class", "research_service", "--json"],
    { env },
  ));
  commands.push(await capture("kpp doctor", process.execPath, [...writeGuardArguments(fixtureRoot), KPP_BINARY, "doctor", "--json"], { env }));
  commands.push(await capture("longtable doctor", "longtable", ["scholar-research", "doctor", "--json"], { env }));

  const installationPath = join(installRoot, "installation.json");
  const manifest = await readJson(installationPath).catch(() => null);
  const pluginManifestPath = join(installRoot, "plugin", ".codex-plugin", "plugin.json");
  const marketplacePath = join(installRoot, "marketplace", ".agents", "plugins", "marketplace.json");
  const registeredSkills = (await readdir(join(installRoot, "marketplace", "plugin", "skills"), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(installRoot, "marketplace", "plugin", "skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  const hwpxEngine = await readJson(join(
    installRoot,
    "marketplace",
    "plugin",
    "skills",
    "korean-public-proposal",
    "vendor",
    "hwpx-skill",
    "INSTALLATION.json",
  )).catch(() => null);
  const pluginManifest = await readJson(pluginManifestPath).catch(() => null);
  const marketplace = await readJson(marketplacePath).catch(() => null);
  const marketplaceEntry = marketplace?.plugins?.find?.((entry) => entry?.name === "public-proposal");
  const setupEnvelope = parseEnvelope(commands[0].stdout, commands[0].stderr);
  const publicDoctorEnvelope = parseEnvelope(commands[1].stdout, commands[1].stderr);
  const kppDoctorEnvelope = parseEnvelope(commands[2].stdout, commands[2].stderr);
  const longtableDoctorEnvelope = parseEnvelope(commands[3].stdout, commands[3].stderr);
  const kppWorkerCheck = kppDoctorEnvelope?.data?.checks?.find?.(({ name }) => name === "worker_protocol");
  const paths = await listFiles(fixtureRoot);
  const isolation = await finalizeIsolation(isolated, commands);
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
      && marketplaceEntry?.source?.source === "local"
      && marketplaceEntry?.source?.path === "./plugin"
      && registeredSkills.length === 1
      && registeredSkills[0] === "korean-public-proposal"
      && hwpxEngine?.commit === "96a2633f23a08f707679d7e212ebdc59948260e6"
      && hwpxEngine?.verified === true
      && isolation.violations.length === 0
      && isolation.deniedWriteProbe.exitCode !== 0,
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
    registeredSkills,
    hwpxEngine,
    envelopes: { setup: setupEnvelope, publicDoctor: publicDoctorEnvelope, kppDoctor: kppDoctorEnvelope, longtableDoctor: longtableDoctorEnvelope },
    isolation,
    commands,
    paths,
  };
  const reportPath = join(fixtureRoot, "clean-install-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { exitCode: report.ok ? 0 : 1, report: { ...report, reportPath } };
}

export async function runProposalClassFixture({ proposalClass, researchLock, academicEvidence = false }) {
  assertProposalClass(proposalClass);
  const fixtureRoot = await mkdtemp(join(tmpdir(), `public-proposal-${proposalClass}-`));
  const fixture = join(fixtureRoot, "fixture");
  const projectRoot = join(fixtureRoot, "project");
  const documentMode = REQUIRED_RESEARCH_CLASSES.includes(proposalClass)
    ? "research_service"
    : proposalClass === "document_restyle"
      ? "document_restyle"
      : "public_procurement";
  const isolated = await prepareIsolation(fixtureRoot, join(fixtureRoot, "install"));
  const commands = [];
  await cp(FIXTURE_SOURCE, fixture, { recursive: true, force: false });
  const projectId = `verification-${proposalClass}`;
  const longtableDoctor = await capture(
    "longtable fixture doctor",
    "longtable",
    ["scholar-research", "doctor", "--json"],
    { env: isolated.env },
  );
  commands.push(longtableDoctor);
  if (longtableDoctor.exitCode !== 0) {
    return proposalFixtureResult(fixtureRoot, parseEnvelope(longtableDoctor.stdout, longtableDoctor.stderr), null, isolated, commands);
  }
  const init = await runKpp(
    ["init", projectRoot, "--project-id", projectId, "--proposal-class", proposalClass, "--document-mode", documentMode, "--json"],
    isolated,
  );
  commands.push(init);
  if (init.exitCode !== 0) {
    return proposalFixtureResult(fixtureRoot, parseEnvelope(init.stdout, init.stderr), null, isolated, commands);
  }

  if (!researchLock && REQUIRED_RESEARCH_CLASSES.includes(proposalClass)) {
    const blocked = await runKpp(["export-authoring", projectRoot, "--json"], isolated);
    commands.push(blocked);
    return proposalFixtureResult(fixtureRoot, parseEnvelope(blocked.stdout, blocked.stderr), null, isolated, commands);
  }
  if (proposalClass === "document_restyle") {
    const optional = await runKpp(["export-authoring", projectRoot, "--json"], isolated);
    commands.push(optional);
    return proposalFixtureResult(fixtureRoot, parseEnvelope(optional.stdout, optional.stderr), null, isolated, commands);
  }

  const rfpPath = join(fixture, "issuer-rfp.txt");
  const candidatesPath = join(fixture, "candidates.json");
  const decisionsPath = join(fixture, "requirement-decisions.json");
  const evidencePath = join(fixture, "evidence", "method-evidence.txt");
  const issuerProfilePath = join(fixture, "issuer-profile.json");
  const terminologyPath = join(fixture, "terminology.json");
  const responsePath = join(fixture, "content", "authoring-response-final.json");

  await requireKpp(["ingest", projectRoot, rfpPath, "--json"], isolated, commands);
  await materializeTemplate(join(fixture, "candidates-template.json"), candidatesPath, {
    __ISSUER_RFP_PATH__: rfpPath,
  });
  await materializeTemplate(join(fixture, "requirement-decisions-template.json"), decisionsPath, {
    __METHOD_EVIDENCE_PATH__: evidencePath,
  });
  if (documentMode === "public_procurement" || academicEvidence) {
    const decisions = await readJson(decisionsPath);
    const requirement = decisions.requirements?.requirements?.[0];
    const evidenceBinding = decisions.requirements?.evidenceBindings?.[0];
    if (requirement === undefined || evidenceBinding === undefined) {
      throw new Error("Academic evidence fixture is missing its locked requirement binding.");
    }
    if (documentMode === "public_procurement") {
      requirement.pageRole = "requirement_response";
      evidenceBinding.targetPageRole = "requirement_response";
    }
    if (academicEvidence) {
      requirement.pageRole = "academic_evidence";
      evidenceBinding.targetPageRole = "academic_evidence";
    }
    await writeFile(decisionsPath, `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
  }
  await requireKpp([
    "requirements",
    projectRoot,
    "--candidates",
    candidatesPath,
    "--decisions",
    decisionsPath,
    "--json",
  ], isolated, commands);
  const requirementsPath = join(projectRoot, "requirements", "requirements.json");
  await requireKpp(["plan", projectRoot, "--requirements", requirementsPath, "--json"], isolated, commands);
  if (!researchLock && proposalClass === "general_procurement" && academicEvidence) {
    const blocked = await runKpp(["export-authoring", projectRoot, "--json"], isolated);
    commands.push(blocked);
    return proposalFixtureResult(fixtureRoot, parseEnvelope(blocked.stdout, blocked.stderr), null, isolated, commands);
  }
  if (researchLock) await createResearchLock(projectRoot, projectId, proposalClass);
  await requireKpp([
    "export-authoring",
    projectRoot,
    "--issuer-profile",
    issuerProfilePath,
    "--terminology",
    terminologyPath,
    "--json",
  ], isolated, commands);
  await requireKpp(["import-authoring", projectRoot, "--response", responsePath, "--json"], isolated, commands);

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
  ], isolated);
  commands.push(approval);
  const envelope = parseEnvelope(approval.stdout, approval.stderr);
  const researchBinding = researchLock && envelope.ok === true
    ? await inspectResearchBinding(core, projectRoot)
    : null;
  return proposalFixtureResult(fixtureRoot, envelope, researchBinding, isolated, commands);
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
  if (meta.version !== INSTALLER_VERSION || meta.dependencies?.["@longtable/kpp-cli"] !== KPP_VERSION || meta.dependencies?.["@longtable/cli"] !== LONGTABLE_VERSION) {
    throw new Error("The meta-installer must pin the exact KPP and LongTable CLI versions.");
  }
  const plugin = await readJson(join(REPOSITORY_ROOT, "apps/public-proposal-cli/plugin/.codex-plugin/plugin.json"));
  const marketplace = await readJson(join(REPOSITORY_ROOT, "apps/public-proposal-cli/marketplace/.agents/plugins/marketplace.json"));
  const bundle = await readJson(join(REPOSITORY_ROOT, "apps/public-proposal-cli/plugin/skills/korean-public-proposal/BUNDLE-MANIFEST.json"));
  const entry = marketplace.plugins?.find?.((candidate) => candidate?.name === "public-proposal");
  if (
    plugin.name !== "public-proposal" ||
    entry?.source?.source !== "local" ||
    entry?.source?.path !== "./plugin" ||
    !Array.isArray(bundle.files) ||
    bundle.files.length === 0
  ) {
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
    if (result.exitCode !== 0) {
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const tail = output.length > 4000 ? output.slice(-4000) : output;
      throw new VerificationError(`${name} failed${tail ? `; output:\n${tail}` : ""}`, { artifactRoot, commands });
    }
    return result;
  };

  try {
    await runRequired("npm ci", "npm", ["ci"]);
    await runRequired("workspace build", "npm", ["run", "build"]);
    await runRequired("workspace typecheck", "npm", ["run", "typecheck"]);
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
    const registryProbe = await capture(
      "npm registry availability",
      "npm",
      ["view", `@longtable/public-proposal@${INSTALLER_VERSION}`, "version", "--json"],
      { cwd: REPOSITORY_ROOT },
    );
    commands.push(registryProbe);
    const registry = {
      package: `@longtable/public-proposal@${INSTALLER_VERSION}`,
      available: registryProbe.exitCode === 0 && registryProbe.stdout.includes(INSTALLER_VERSION),
      exitCode: registryProbe.exitCode,
      output: registryProbe.stdout.trim() || registryProbe.stderr.trim(),
      prerequisite: "Registry availability is independently checked before the documented npx command is marked release-ready.",
    };
    const testHome = join(artifactRoot, "test-home");
    await mkdir(testHome, { recursive: true });
    const hermeticTestEnv = {
      ...process.env,
      HOME: testHome,
      USERPROFILE: testHome,
      PUBLIC_PROPOSAL_INSTALLATION_MANIFEST: join(artifactRoot, "missing-installation.json"),
    };
    const testOptions = { env: hermeticTestEnv };
    // The release gate must not observe a real user's managed worker receipt.
    // Otherwise a local Public Proposal install can change the result of KPP's
    // "no worker path" diagnostic test.
    await runRequired("hermetic focused unit tests", "npm", ["test", "--", "apps/public-proposal-cli/test", "tests/plugin/install-docs.test.ts"], testOptions);
    await runRequired("hermetic full JavaScript test suite", "npm", ["test"], testOptions);
    await runRequired("Python worker tests", "uv", ["run", "--project", "workers/docx-python", "pytest", "-q"], testOptions);
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
      matrix[`${proposalClass}:missing`] = {
        ...fixture.envelope,
        isolation: fixture.isolation,
      };
      if (fixture.envelope.code !== "PP_RESEARCH_LOCK_MISSING") {
        throw new VerificationError(`${proposalClass} did not fail closed without LongTable`, { artifactRoot, commands, matrix });
      }
    }
    const generalAcademicMissing = await runProposalClassFixture({
      proposalClass: "general_procurement",
      researchLock: false,
      academicEvidence: true,
    });
    matrix["general_procurement:academic-missing"] = {
      ...generalAcademicMissing.envelope,
      isolation: generalAcademicMissing.isolation,
    };
    if (generalAcademicMissing.envelope.code !== "PP_RESEARCH_LOCK_MISSING") {
      throw new VerificationError("general procurement academic evidence did not fail closed without LongTable", {
        artifactRoot,
        commands,
        matrix,
      });
    }
    for (const input of [
      { proposalClass: "research_service", researchLock: true },
      { proposalClass: "general_procurement", researchLock: false, academicEvidence: false },
      { proposalClass: "general_procurement", researchLock: true, academicEvidence: true },
    ]) {
      const fixture = await runProposalClassFixture(input);
      const matrixKey = input.proposalClass === "general_procurement" && input.academicEvidence
        ? "general_procurement:academic-locked"
        : `${input.proposalClass}:${input.researchLock ? "locked" : "optional"}`;
      matrix[matrixKey] = {
        ...fixture.envelope,
        researchBinding: fixture.researchBinding,
        isolation: fixture.isolation,
      };
      if (fixture.envelope?.data?.state !== "CONTENT_APPROVED") {
        throw new VerificationError(`${input.proposalClass} fixture did not reach CONTENT_APPROVED`, { artifactRoot, commands, matrix });
      }
      if (input.researchLock && fixture.researchBinding?.boundToContentApproval !== true) {
        throw new VerificationError(`${input.proposalClass} content approval is not bound to its research lock`, {
          artifactRoot,
          commands,
          matrix,
        });
      }
    }
    const report = {
      ok: true,
      localArtifactVerified: true,
      releaseReady: registry.available,
      artifactRoot,
      contracts,
      tarball,
      registry,
      cleanInstall: install.report,
      matrix,
      commands,
    };
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

async function inspectResearchBinding(core, root) {
  const researchLockPath = join(root, "receipts", "research-lock.json");
  const contentApprovalPath = join(root, "receipts", "content-approval.json");
  const [researchVerification, contentVerification, researchLockSha256] = await Promise.all([
    core.verifyReceipt(researchLockPath),
    core.verifyReceipt(contentApprovalPath),
    core.sha256File(researchLockPath),
  ]);
  return {
    researchLockPath,
    contentApprovalPath,
    researchLockSha256,
    researchLockValid: researchVerification.valid,
    contentApprovalValid: contentVerification.valid,
    boundToContentApproval: contentVerification.receipt.inputReceiptHashes.includes(researchLockSha256),
  };
}

async function prepareIsolation(fixtureRoot, installRoot) {
  const home = join(fixtureRoot, "home");
  const fakeBin = join(fixtureRoot, "fake-bin");
  const fontRoot = join(fixtureRoot, "fonts");
  const temporaryRoot = join(fixtureRoot, "tmp");
  const writeLog = join(fixtureRoot, "fake-runner-write-log.jsonl");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(fontRoot, { recursive: true }),
    mkdir(temporaryRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(fontRoot, "NotoSansCJKkr-Regular.otf"), "fixture-font\n"),
    writeFile(join(fontRoot, "NotoSerifCJKkr-Regular.otf"), "fixture-font\n"),
    writeFile(writeLog, "", { mode: 0o600 }),
  ]);
  await createFakeToolchain(fakeBin);
  const env = isolatedEnvironment({
    fixtureRoot,
    home,
    fakeBin,
    installRoot,
    fontRoot,
    temporaryRoot,
    writeLog,
  });
  const deniedPath = join(dirname(fixtureRoot), `public-proposal-denied-${basename(fixtureRoot)}`);
  const deniedWriteProbe = await capture(
    "fixture write-boundary probe",
    process.execPath,
    [...writeGuardArguments(fixtureRoot), "-e", `require("node:fs").writeFileSync(${JSON.stringify(deniedPath)}, "denied")`],
    { env },
  );
  const configuredHostStatePath = join(resolve(process.env.HOME ?? dirname(fixtureRoot)), ".codex", "config.toml");
  // Hosted runners do not provision a Codex config. Fall back to an existing
  // executable outside the fixture so the permission probe tests access
  // control rather than whether an optional host file happens to exist.
  const hostStatePath = existsSync(configuredHostStatePath) ? configuredHostStatePath : process.execPath;
  const deniedReadProbe = await capture(
    "host-state read-boundary probe",
    process.execPath,
    [...writeGuardArguments(fixtureRoot), "-e", `require("node:fs").readFileSync(${JSON.stringify(hostStatePath)})`],
    { env },
  );
  return {
    fixtureRoot,
    home,
    fakeBin,
    fontRoot,
    temporaryRoot,
    installRoot,
    writeLog,
    env,
    deniedWriteProbe,
    deniedReadProbe,
  };
}

async function finalizeIsolation(isolated, commands) {
  const fakeRunnerEvents = (await readFile(isolated.writeLog, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const outsideWrites = fakeRunnerEvents.filter(({ writePath }) =>
    typeof writePath === "string" && !isWithin(isolated.fixtureRoot, writePath),
  );
  const permissionFailures = commands.flatMap((command) => {
    const combined = `${command.stdout}\n${command.stderr}`;
    return combined.includes("ERR_ACCESS_DENIED")
      ? [{ command: command.name, detail: "Node permission model denied an undeclared fixture command access." }]
      : [];
  });
  const probeDenied = isolated.deniedWriteProbe.exitCode !== 0
    && `${isolated.deniedWriteProbe.stdout}\n${isolated.deniedWriteProbe.stderr}`.includes("ERR_ACCESS_DENIED");
  const readProbeDenied = isolated.deniedReadProbe.exitCode !== 0
    && `${isolated.deniedReadProbe.stdout}\n${isolated.deniedReadProbe.stderr}`.includes("ERR_ACCESS_DENIED");
  return {
    environmentMode: "allowlist",
    environmentKeys: Object.keys(isolated.env).sort(),
    allowedWriteRoot: resolve(isolated.fixtureRoot),
    writeGuard: "node-permission-model+fake-runner-log",
    deniedWriteProbe: {
      exitCode: isolated.deniedWriteProbe.exitCode,
      detected: probeDenied ? "ERR_ACCESS_DENIED" : null,
    },
    deniedHostReadProbe: {
      exitCode: isolated.deniedReadProbe.exitCode,
      detected: readProbeDenied ? "ERR_ACCESS_DENIED" : null,
    },
    fakeRunnerEvents,
    violations: [
      ...outsideWrites.map(({ writePath, command }) => ({ command, writePath })),
      ...permissionFailures,
      ...(!probeDenied ? [{ command: "fixture write-boundary probe", detail: "Write guard did not reject an outside write." }] : []),
      ...(!readProbeDenied ? [{ command: "host-state read-boundary probe", detail: "Read guard did not reject host Codex state." }] : []),
    ],
  };
}

async function proposalFixtureResult(fixtureRoot, envelope, researchBinding, isolated, commands) {
  return {
    fixtureRoot,
    envelope,
    researchBinding,
    isolation: await finalizeIsolation(isolated, commands),
    commands,
  };
}

function writeGuardArguments(fixtureRoot) {
  const permissionFlag = process.allowedNodeEnvironmentFlags.has("--permission")
    ? "--permission"
    : "--experimental-permission";
  const readableRoots = [
    ...canonicalVariants(REPOSITORY_ROOT),
    ...canonicalVariants(fixtureRoot).map(temporaryTraversalRoot),
    "/usr",
  ];
  const fixtureRoots = canonicalVariants(fixtureRoot);
  return [
    permissionFlag,
    ...readableRoots.map((path) => `--allow-fs-read=${path}`),
    ...fixtureRoots.map((path) => `--allow-fs-read=${path}`),
    ...fixtureRoots.map((path) => `--allow-fs-write=${path}`),
    "--allow-child-process",
  ];
}

function temporaryTraversalRoot(path) {
  const resolved = resolve(path);
  if (resolved.startsWith("/")) {
    return `/${resolved.split("/").filter(Boolean)[0] ?? "tmp"}`;
  }
  return dirname(resolved);
}

function canonicalVariants(path) {
  const resolved = resolve(path);
  try {
    return [...new Set([resolved, realpathSync(resolved)])];
  } catch {
    return [resolved];
  }
}

function isWithin(root, path) {
  const normalizedRoot = `${resolve(root)}/`;
  return resolve(path).startsWith(normalizedRoot);
}

async function createFakeToolchain(fakeBin) {
  await mkdir(fakeBin, { recursive: true });
  const source = fakeRunnerSource();
  await Promise.all(["node", "npm", "codex", "python3", "soffice", "fc-match", "kpp", "longtable", "uv"].map(async (name) => {
    const path = join(fakeBin, name);
    await writeFile(path, source, { mode: 0o755 });
    await chmod(path, 0o755);
  }));
}

function fakeRunnerSource() {
  return String.raw`#!/bin/sh
name=$(basename "$0")
if [ -n "$PP_VERIFY_WRITE_LOG" ]; then
  printf '{"command":"%s","event":"invoke"}\n' "$name" >> "$PP_VERIFY_WRITE_LOG"
fi
case "$name" in
  node) printf 'v22.20.0\n' ;;
  npm) printf '10.9.3\n' ;;
  python3) printf 'Python 3.12.0\n' ;;
  soffice) printf 'LibreOffice 25.2.0\n' ;;
  fc-match) printf 'NotoSansCJKkr-Regular.otf: Noto Sans CJK KR\n' ;;
  kpp) printf '@longtable/kpp-cli 0.3.0\n' ;;
  longtable)
    if [ "$1" = "--version" ]; then printf '@longtable/cli 0.1.72\n'
    elif printf '%s' "$*" | grep -q doctor; then printf '{"ok":true,"code":"LONGTABLE_OK"}\n'
    elif [ "$1" = "codex" ] && [ "$2" = "install-skills" ]; then
      while [ "$#" -gt 0 ]; do
        if [ "$1" = "--dir" ]; then skill_root=$2; break; fi
        shift
      done
      mkdir -p "$skill_root/longtable" "$skill_root/longtable-research"
      printf '%s\n' '# LongTable' > "$skill_root/longtable/SKILL.md"
      printf '%s\n' '# LongTable Research' > "$skill_root/longtable-research/SKILL.md"
    else printf '{"ok":true}\n'; fi
    ;;
  codex)
    state_root=$(dirname "$PUBLIC_PROPOSAL_INSTALLATION_MANIFEST")
    if [ "$1" = "--version" ]; then printf 'codex-cli 0.144.5\n'
    elif [ "$1 $2 $3" = "plugin marketplace list" ]; then
      marketplace_path=$(CDPATH= cd -- "$state_root/marketplace" 2>/dev/null && pwd -P)
      if [ -f "$state_root/.marketplace-registered" ]; then printf '{"marketplaces":[{"name":"public-proposal","path":"%s"}]}\n' "$marketplace_path"; else printf '{"marketplaces":[]}\n'; fi
    elif [ "$1 $2 $3" = "plugin marketplace add" ]; then printf registered > "$state_root/.marketplace-registered"
    elif [ "$1 $2 $3" = "plugin marketplace remove" ]; then rm -f "$state_root/.marketplace-registered"
    elif [ "$1 $2" = "plugin list" ]; then
      if [ -f "$state_root/.plugin-registered" ]; then printf '{"installed":[{"pluginId":"public-proposal@public-proposal","installed":true}],"available":[]}\n'; else printf '{"installed":[],"available":[]}\n'; fi
    elif [ "$1 $2" = "plugin add" ]; then printf registered > "$state_root/.plugin-registered"
    elif [ "$1 $2" = "plugin remove" ]; then rm -f "$state_root/.plugin-registered"
    else printf '{"ok":true}\n'; fi
    ;;
  uv)
    environment=$UV_PROJECT_ENVIRONMENT
    if [ -z "$environment" ] && [ -n "$PUBLIC_PROPOSAL_INSTALLATION_MANIFEST" ]; then
      environment=$(dirname "$PUBLIC_PROPOSAL_INSTALLATION_MANIFEST")/worker/.venv
    fi
    if [ -z "$environment" ]; then printf 'UV_PROJECT_ENVIRONMENT missing\n' >&2; exit 2; fi
    python=$environment/bin/python
    if [ -n "$PP_VERIFY_WRITE_LOG" ]; then
      printf '{"command":"uv","event":"write","writePath":"%s"}\n' "$python" >> "$PP_VERIFY_WRITE_LOG"
    fi
    mkdir -p "$environment/bin"
    printf '#!/bin/sh\nprintf "1.0.0\\n"\n' > "$python"
    chmod 755 "$python"
    ;;
  *) printf 'unexpected fake command: %s %s\n' "$name" "$*" >&2; exit 127 ;;
esac
`;
}

function isolatedEnvironment({ fixtureRoot, home, fakeBin, installRoot, fontRoot, temporaryRoot, writeLog }) {
  return {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    LONGTABLE_HOME: join(fixtureRoot, "isolated-longtable-state"),
    TMPDIR: temporaryRoot,
    TMP: temporaryRoot,
    TEMP: temporaryRoot,
    PUBLIC_PROPOSAL_INSTALLATION_MANIFEST: join(installRoot, "installation.json"),
    KPP_NOTO_SANS_PATH: join(fontRoot, "NotoSansCJKkr-Regular.otf"),
    KPP_NOTO_SERIF_PATH: join(fontRoot, "NotoSerifCJKkr-Regular.otf"),
    KPP_SOFFICE_PATH: join(fakeBin, "soffice"),
    PP_VERIFY_WRITE_LOG: writeLog,
    PATH: [fakeBin, "/usr/bin", "/bin"].join(delimiter),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
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
    "package/marketplace/.agents/plugins/marketplace.json",
    "package/worker/pyproject.toml",
    "package/worker/uv.lock",
  ]) {
    if (!files.includes(required)) throw new Error(`Tarball is missing ${required}`);
  }
  return { path, bytes: contents.length, integrity, sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`, files };
}

async function runKpp(args, isolated) {
  return capture(
    `kpp ${args[0] ?? "command"}`,
    process.execPath,
    [...writeGuardArguments(isolated.fixtureRoot), KPP_BINARY, ...args],
    { cwd: REPOSITORY_ROOT, env: isolated.env },
  );
}

async function requireKpp(args, isolated, commands) {
  const result = await runKpp(args, isolated);
  commands.push(result);
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
