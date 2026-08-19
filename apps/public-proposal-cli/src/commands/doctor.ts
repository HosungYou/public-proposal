import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseInstallManifest,
  SUPPORTED_KPP_VERSION,
  SUPPORTED_LONGTABLE_VERSION,
  WORKER_PROTOCOL_VERSION,
  type DoctorCheck,
  type DoctorInput,
  type DoctorReport,
  type PackageVersionResolver,
  type ProcessRunner,
} from "../contracts.js";
import { nodeFs } from "../process.js";
import { createPackageVersionResolver } from "../package-version.js";
import { readPackagedMarketplaceManifest } from "../marketplace.js";
import { verifyManagedWorkerFromManifestContents, verifyWorkerProtocol } from "../worker.js";

export interface DoctorDependencies {
  readonly packageRoot?: string;
  readonly packageVersion?: PackageVersionResolver;
  readonly spawn: ProcessRunner;
  readonly readFile: (path: string) => Promise<string>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly listDir?: (path: string) => Promise<string[]>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly sha256: (path: string) => Promise<string>;
}

const RESEARCH_CLASSES = new Set(["academic_research", "research_service", "policy_research"]);

export async function runDoctor(
  input: DoctorInput,
  dependencies: DoctorDependencies = defaultDoctorDependencies(),
): Promise<DoctorReport> {
  const packageRoot = dependencies.packageRoot ?? defaultPackageRoot();
  const checks: DoctorCheck[] = [];

  checks.push(await commandCheck(dependencies.spawn, "node", ["--version"], "node"));
  checks.push(await commandCheck(dependencies.spawn, "npm", ["--version"], "npm"));
  checks.push(await commandCheck(dependencies.spawn, "codex", ["--version"], "codex"));
  checks.push(await commandCheck(dependencies.spawn, "python3", ["--version"], "python"));
  checks.push(await commandCheck(dependencies.spawn, "soffice", ["--version"], "libreoffice"));
  checks.push(await fontsCheck(dependencies.spawn));
  checks.push(await pluginCheck(input.installRoot, packageRoot, dependencies));
  checks.push(...await pluginSurfaceChecks(input.installRoot, packageRoot, dependencies));
  checks.push(await contractsCheck(input.installRoot, dependencies));
  checks.push(await kppCheck(dependencies.spawn, input.expectedKppVersion, dependencies.packageVersion));
  checks.push(await longtableCheck(
    dependencies.spawn,
    input.expectedLongtableVersion,
    input.projectClass,
    dependencies.packageVersion,
  ));
  checks.push(await scholarResearchCheck(dependencies.spawn, input.projectClass));
  checks.push(await workerCheck(input.installRoot, dependencies, input.expectedWorkerProtocol));
  checks.push(authorityCheck());

  return {
    ok: !checks.some((check) => check.status !== "pass"),
    checks,
  };
}

function defaultDoctorDependencies(): DoctorDependencies {
  const packageRoot = defaultPackageRoot();
  return {
    ...nodeFs,
    packageRoot,
    packageVersion: createPackageVersionResolver(packageRoot, nodeFs.readFile),
  };
}

function defaultPackageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

async function commandCheck(
  spawn: ProcessRunner,
  command: string,
  args: readonly string[],
  name: DoctorCheck["name"],
): Promise<DoctorCheck> {
  const result = await spawn(command, args);
  if (result.code !== 0) {
    return {
      name,
      status: "blocker",
      detected: null,
      message: `${command} is required for Public Proposal setup.`,
      action: `Install ${command} and rerun public-proposal doctor.`,
    };
  }
  return {
    name,
    status: "pass",
    detected: result.stdout.trim(),
    message: `${command} is available.`,
  };
}

async function fontsCheck(spawn: ProcessRunner): Promise<DoctorCheck> {
  const regular = await spawn("fc-match", ["NotoSansCJKkr-Regular"]);
  const bold = await spawn("fc-match", ["NotoSansCJKkr-Bold"]);
  if (regular.code !== 0 || bold.code !== 0) {
    return {
      name: "fonts",
      status: "blocker",
      detected: { regular: regular.stdout.trim(), bold: bold.stdout.trim() },
      message: "Required Noto Sans CJK Korean fonts are missing.",
    };
  }
  return {
    name: "fonts",
    status: "pass",
    detected: { regular: regular.stdout.trim(), bold: bold.stdout.trim() },
    message: "Required Korean fonts are available.",
  };
}

const EXPECTED_PUBLIC_PROPOSAL_SKILLS = ["korean-public-proposal", "public-proposal"] as const;
const EXPECTED_LONGTABLE_SKILLS = ["longtable", "longtable-research"] as const;
const SUPPORTED_RESEARCH_CONTRACT_VERSION = "0.1.0";

async function pluginSurfaceChecks(
  installRoot: string,
  packageRoot: string,
  dependencies: DoctorDependencies,
): Promise<DoctorCheck[]> {
  let manifest;
  try {
    manifest = parseInstallManifest(JSON.parse(await dependencies.readFile(join(installRoot, "installation.json"))));
  } catch (error) {
    const detected = error instanceof Error ? error.message : String(error);
    return [
      blocker("publicProposalPlugin", "PP_INSTALL_MANIFEST_MISMATCH", detected, "Public Proposal installation receipt cannot be verified."),
      blocker("longtablePlugin", "PP_INSTALL_MANIFEST_MISMATCH", detected, "LongTable installation ownership cannot be verified."),
      blocker("skillDiscovery", "PP_SKILL_DISCOVERY_MISMATCH", detected, "Installed skill discovery cannot be verified."),
      blocker("legacyConflicts", "PP_LEGACY_SKILL_CONFLICT", detected, "Legacy LongTable skill conflicts cannot be verified."),
    ];
  }

  const [marketplaces, plugins] = await Promise.all([
    dependencies.spawn("codex", ["plugin", "marketplace", "list", "--json"]),
    dependencies.spawn("codex", ["plugin", "list", "--json"]),
  ]);
  const publicSource = manifest.registrationOwnership?.publicProposal.marketplaceSource
    ?? await canonicalPath(join(installRoot, "marketplace"), dependencies.realpath);
  const longtableSource = manifest.registrationOwnership?.longtable.marketplaceSource
    ?? await canonicalPath(join(installRoot, "longtable-marketplace"), dependencies.realpath);
  const publicManifestPath = join(installRoot, "plugin", ".codex-plugin", "plugin.json");
  const packagedManifestPath = join(packageRoot, "plugin", ".codex-plugin", "plugin.json");

  const publicProposalPlugin = await verifyPublicProposalSurface(
    publicManifestPath,
    packagedManifestPath,
    publicSource,
    manifest,
    marketplaces,
    plugins,
    dependencies,
  );
  const longtableSurface = await resolveLongtableSurface(longtableSource, dependencies);
  const longtablePlugin = await verifyLongtableSurface(
    longtableSurface,
    manifest,
    marketplaces,
    plugins,
    dependencies,
  );

  const publicSkills = await installedSkillNames(join(installRoot, "plugin", "skills"), dependencies);
  const longtableSkills = await installedSkillNames(longtableSurface.skillsRoot, dependencies);
  const exact = arraysEqual(publicSkills, EXPECTED_PUBLIC_PROPOSAL_SKILLS)
    && arraysEqual(longtableSkills, EXPECTED_LONGTABLE_SKILLS);
  const extraLongtableSkills = longtableSkills.filter((name) => !EXPECTED_LONGTABLE_SKILLS.includes(name as typeof EXPECTED_LONGTABLE_SKILLS[number]));
  const legacyInPublic = publicSkills.filter((name) => name.startsWith("longtable-") || name === "longtable" || name === "scholar-research");
  const legacy = [...new Set([...extraLongtableSkills, ...legacyInPublic])].sort();

  return [
    publicProposalPlugin,
    longtablePlugin,
    exact
      ? pass("skillDiscovery", { publicProposal: publicSkills, longtable: longtableSkills }, "Exactly four user-facing skills are discoverable across the two plugins.")
      : blocker(
        "skillDiscovery",
        "PP_SKILL_DISCOVERY_MISMATCH",
        { publicProposal: publicSkills, longtable: longtableSkills },
        "Installed user-facing skills do not match the two-plugin contract.",
      ),
    legacy.length === 0
      ? pass("legacyConflicts", { conflicts: [] }, "No legacy LongTable role skills are exposed as user-facing plugin skills.")
      : blocker(
        "legacyConflicts",
        "PP_LEGACY_SKILL_CONFLICT",
        { conflicts: legacy },
        "Legacy LongTable role skills are exposed and must be removed from the user-facing plugin surface.",
      ),
  ];
}

async function verifyPublicProposalSurface(
  installedPath: string,
  packagedPath: string,
  marketplaceSource: string,
  manifest: ReturnType<typeof parseInstallManifest>,
  marketplaces: Awaited<ReturnType<ProcessRunner>>,
  plugins: Awaited<ReturnType<ProcessRunner>>,
  dependencies: DoctorDependencies,
): Promise<DoctorCheck> {
  try {
    const [installedRaw, packagedRaw, installedSha] = await Promise.all([
      dependencies.readFile(installedPath),
      dependencies.readFile(packagedPath),
      dependencies.sha256(installedPath),
    ]);
    const installed = JSON.parse(installedRaw) as { name?: string; version?: string };
    const packaged = JSON.parse(packagedRaw) as { name?: string; version?: string };
    const registered = marketplaces.code === 0 && plugins.code === 0
      && marketplaceListContainsNamed(marketplaces.stdout, "public-proposal", marketplaceSource)
      && pluginListContainsNamed(plugins.stdout, "public-proposal@public-proposal", "public-proposal", "public-proposal");
    if (
      installed.name !== "public-proposal"
      || installed.version !== packaged.version
      || installedSha !== manifest.pluginManifestSha256
      || !registered
    ) {
      return blocker("publicProposalPlugin", "PP_PLUGIN_INTEGRITY_FAILED", {
        installedName: installed.name,
        installedVersion: installed.version,
        packagedVersion: packaged.version,
        installedSha,
        expectedSha: manifest.pluginManifestSha256,
        registered,
      }, "Public Proposal manifest, source registration, or receipt binding is invalid.");
    }
    return pass("publicProposalPlugin", {
      name: installed.name,
      version: installed.version,
      marketplaceSource,
      sha256: installedSha,
    }, "Public Proposal manifest and independent Codex registration match the receipt.");
  } catch (error) {
    return blocker("publicProposalPlugin", "PP_PLUGIN_INTEGRITY_FAILED", error instanceof Error ? error.message : String(error), "Public Proposal plugin cannot be verified.");
  }
}

async function resolveLongtableSurface(
  marketplaceSource: string,
  dependencies: DoctorDependencies,
): Promise<{ manifestPath: string; skillsRoot: string; marketplaceSource: string }> {
  for (const marketplacePath of [
    join(marketplaceSource, ".agents", "plugins", "marketplace.json"),
    join(marketplaceSource, "marketplace.json"),
  ]) {
    try {
      const marketplace = JSON.parse(await dependencies.readFile(marketplacePath)) as {
        plugins?: Array<{ name?: string; source?: { source?: string; path?: string } }>;
      };
      const entry = marketplace.plugins?.find((candidate) => candidate.name === "longtable");
      if (entry?.source?.source === "local" && entry.source.path) {
        const pluginRoot = resolve(marketplaceSource, entry.source.path);
        return {
          manifestPath: join(pluginRoot, ".codex-plugin", "plugin.json"),
          skillsRoot: join(pluginRoot, "skills"),
          marketplaceSource,
        };
      }
    } catch {
      // Try the packaged marketplace layout.
    }
  }
  const pluginRoot = join(marketplaceSource, "plugin");
  return {
    manifestPath: join(pluginRoot, ".codex-plugin", "plugin.json"),
    skillsRoot: join(pluginRoot, "skills"),
    marketplaceSource,
  };
}

async function verifyLongtableSurface(
  surface: { manifestPath: string; marketplaceSource: string },
  manifest: ReturnType<typeof parseInstallManifest>,
  marketplaces: Awaited<ReturnType<ProcessRunner>>,
  plugins: Awaited<ReturnType<ProcessRunner>>,
  dependencies: DoctorDependencies,
): Promise<DoctorCheck> {
  try {
    const plugin = JSON.parse(await dependencies.readFile(surface.manifestPath)) as { name?: string; version?: string };
    const registered = marketplaces.code === 0 && plugins.code === 0
      && marketplaceListContainsNamed(marketplaces.stdout, "longtable", surface.marketplaceSource)
      && pluginListContainsNamed(plugins.stdout, "longtable@longtable", "longtable", "longtable");
    if (plugin.name !== "longtable" || plugin.version !== manifest.longtableVersion || !registered) {
      return blocker("longtablePlugin", "PP_LONGTABLE_PLUGIN_INTEGRITY_FAILED", {
        name: plugin.name,
        version: plugin.version,
        expectedVersion: manifest.longtableVersion,
        registered,
      }, "LongTable manifest, version, or independent source registration is invalid.");
    }
    return pass("longtablePlugin", {
      name: plugin.name,
      version: plugin.version,
      marketplaceSource: surface.marketplaceSource,
      ownership: manifest.registrationOwnership?.longtable.ownership ?? "legacy_untracked",
    }, "LongTable manifest and independent Codex registration match the receipt.");
  } catch (error) {
    return blocker("longtablePlugin", "PP_LONGTABLE_PLUGIN_INTEGRITY_FAILED", error instanceof Error ? error.message : String(error), "LongTable plugin cannot be verified.");
  }
}

async function installedSkillNames(root: string, dependencies: DoctorDependencies): Promise<string[]> {
  if (dependencies.listDir) {
    try {
      return (await dependencies.listDir(root)).sort();
    } catch {
      return [];
    }
  }
  const candidates = [
    ...EXPECTED_PUBLIC_PROPOSAL_SKILLS,
    ...EXPECTED_LONGTABLE_SKILLS,
    "scholar-research",
    "longtable-start",
    "longtable-interview",
    "longtable-panel",
    "longtable-methods",
    "longtable-measure",
    "longtable-theory",
    "longtable-reviewer",
    "longtable-voice",
  ];
  const present = await Promise.all(candidates.map(async (name) => ({
    name,
    exists: await dependencies.exists(join(root, name, "SKILL.md")),
  })));
  return present.filter(({ exists }) => exists).map(({ name }) => name).sort();
}

async function contractsCheck(installRoot: string, dependencies: DoctorDependencies): Promise<DoctorCheck> {
  try {
    const manifest = parseInstallManifest(JSON.parse(await dependencies.readFile(join(installRoot, "installation.json"))));
    const contractVersion = dependencies.packageVersion
      ? await dependencies.packageVersion("@longtable/proposal-research-contracts")
      : null;
    if (
      manifest.kppVersion !== SUPPORTED_KPP_VERSION
      || manifest.longtableVersion !== SUPPORTED_LONGTABLE_VERSION
      || contractVersion !== SUPPORTED_RESEARCH_CONTRACT_VERSION
    ) {
      return blocker("contracts", "PP_CONTRACT_VERSION_MISMATCH", {
        contractVersion,
        expectedContractVersion: SUPPORTED_RESEARCH_CONTRACT_VERSION,
        kppVersion: manifest.kppVersion,
        longtableVersion: manifest.longtableVersion,
      }, "Proposal research contract or toolchain versions do not match the pinned installation contract.");
    }
    return pass("contracts", {
      proposalResearchContracts: contractVersion,
      kpp: manifest.kppVersion,
      longtable: manifest.longtableVersion,
    }, "Proposal research contract and toolchain versions match the pinned technical contract.");
  } catch (error) {
    return blocker("contracts", "PP_CONTRACT_VERSION_MISMATCH", error instanceof Error ? error.message : String(error), "Proposal research contract versions cannot be verified.");
  }
}

function arraysEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function pass(name: DoctorCheck["name"], detected: unknown, message: string): DoctorCheck {
  return { name, status: "pass", detected, message };
}

function blocker(name: DoctorCheck["name"], code: string, detected: unknown, message: string): DoctorCheck {
  return { name, status: "blocker", code, detected, message };
}

async function pluginCheck(
  installRoot: string,
  packageRoot: string,
  dependencies: DoctorDependencies,
): Promise<DoctorCheck> {
  const pluginManifestPath = join(packageRoot, "plugin", ".codex-plugin", "plugin.json");
  const bundleManifestPath = join(packageRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const installedPluginPath = join(installRoot, "plugin", ".codex-plugin", "plugin.json");
  const installedBundlePath = join(installRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const longtableSkillPath = join(installRoot, "plugin", "skills", "longtable", "SKILL.md");
  const longtableResearchSkillPath = join(installRoot, "plugin", "skills", "longtable-research", "SKILL.md");
  const registeredLongtableSkillPath = join(installRoot, "marketplace", "plugin", "skills", "longtable", "SKILL.md");
  const registeredLongtableResearchSkillPath = join(installRoot, "marketplace", "plugin", "skills", "longtable-research", "SKILL.md");
  try {
    const [pluginRaw, bundleRaw, marketplaceManifest, packagePluginSha] = await Promise.all([
      dependencies.readFile(pluginManifestPath),
      dependencies.readFile(bundleManifestPath),
      readPackagedMarketplaceManifest(packageRoot, dependencies.readFile),
      dependencies.sha256(pluginManifestPath),
    ]);
    const marketplaceRaw = marketplaceManifest.contents;
    const plugin = JSON.parse(pluginRaw) as { name?: string; version?: string };
    const marketplace = JSON.parse(marketplaceRaw) as {
      plugins?: Array<{ name?: string; source?: { source?: string; path?: string } }>;
    };
    JSON.parse(bundleRaw);
    const marketplaceEntry = marketplace.plugins?.find((entry) => entry.name === "public-proposal");
    const installed = await dependencies.exists(installedPluginPath);
    if (
      plugin.name !== "public-proposal" ||
      marketplaceEntry?.source?.source !== "local" ||
      marketplaceEntry?.source?.path !== "./plugin" ||
      !packagePluginSha.startsWith("sha256:")
    ) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
        detected: { pluginName: plugin.name, marketplaceSource: marketplaceEntry?.source?.path, packagePluginSha },
        message: "Packaged public-proposal plugin or marketplace integrity failed.",
      };
    }
    if (!installed) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_NOT_INSTALLED",
        detected: { installedPluginPath },
        message: "Public Proposal Codex plugin is not installed at the manifest-owned path.",
      };
    }
    const manifest = parseInstallManifest(JSON.parse(await dependencies.readFile(join(installRoot, "installation.json"))));
    if (manifest.installRoot !== installRoot) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_INSTALL_MANIFEST_MISMATCH",
        detected: { manifestInstallRoot: manifest.installRoot, installRoot },
        message: "Installation receipt does not match the requested install root.",
      };
    }
    const [installedPluginRaw, installedBundleRaw, installedPluginSha, installedBundleSha] = await Promise.all([
      dependencies.readFile(installedPluginPath),
      dependencies.readFile(installedBundlePath),
      dependencies.sha256(installedPluginPath),
      dependencies.sha256(installedBundlePath),
    ]);
    const installedPlugin = JSON.parse(installedPluginRaw) as { name?: string; version?: string };
    if (
      installedPlugin.name !== "public-proposal" ||
      installedPluginSha !== manifest.pluginManifestSha256 ||
      installedBundleSha !== manifest.bundleManifestSha256
    ) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
        detected: {
          installedPluginName: installedPlugin.name,
          installedPluginSha,
          expectedPluginSha: manifest.pluginManifestSha256,
          installedBundleSha,
          expectedBundleSha: manifest.bundleManifestSha256,
        },
        message: "Installed Public Proposal plugin or Korean bundle hash does not match the receipt.",
      };
    }
    const bundleCheck = await validateBundleFiles(installedBundleRaw, join(installRoot, "plugin", "skills", "korean-public-proposal"), dependencies);
    if (bundleCheck) {
      return bundleCheck;
    }
    const [longtableSkill, longtableResearchSkill, registeredLongtableSkill, registeredLongtableResearchSkill, marketplaces, plugins] = await Promise.all([
      dependencies.readFile(longtableSkillPath).catch(() => ""),
      dependencies.readFile(longtableResearchSkillPath).catch(() => ""),
      dependencies.readFile(registeredLongtableSkillPath).catch(() => ""),
      dependencies.readFile(registeredLongtableResearchSkillPath).catch(() => ""),
      dependencies.spawn("codex", ["plugin", "marketplace", "list", "--json"]),
      dependencies.spawn("codex", ["plugin", "list", "--json"]),
    ]);
    const marketplacePath = await canonicalPath(join(installRoot, "marketplace"), dependencies.realpath);
    const marketplaceRegistered = marketplaces.code === 0
      && marketplaceListContains(marketplaces.stdout, marketplacePath);
    const pluginRegistered = plugins.code === 0 && pluginListContains(plugins.stdout);
    const ownership = manifest.registrationOwnership;
    if (ownership) {
      const longtableMarketplaceRegistered = marketplaces.code === 0
        && marketplaceListContainsNamed(marketplaces.stdout, "longtable", ownership.longtable.marketplaceSource);
      const longtablePluginRegistered = plugins.code === 0
        && pluginListContainsNamed(plugins.stdout, "longtable@longtable", "longtable", "longtable");
      if (!marketplaceRegistered || !pluginRegistered || !longtableMarketplaceRegistered || !longtablePluginRegistered) {
        return {
          name: "plugin",
          status: "blocker",
          code: "PP_PLUGIN_NOT_INSTALLED",
          detected: { marketplaceRegistered, pluginRegistered, longtableMarketplaceRegistered, longtablePluginRegistered },
          message: "Public Proposal and LongTable must remain independently registered at their receipted sources.",
        };
      }
      return {
        name: "plugin",
        status: "pass",
        detected: {
          version: installedPlugin.version,
          pluginSha: installedPluginSha,
          bundleSha: installedBundleSha,
          publicProposalSource: ownership.publicProposal.marketplaceSource,
          longtableSource: ownership.longtable.marketplaceSource,
          longtableOwnership: ownership.longtable.ownership,
        },
        message: "Public Proposal and LongTable independent registrations match the installation receipt.",
      };
    }
    if (
      !longtableSkill.trim()
      || !longtableResearchSkill.trim()
      || !registeredLongtableSkill.trim()
      || !registeredLongtableResearchSkill.trim()
      || !marketplaceRegistered
      || !pluginRegistered
    ) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_NOT_INSTALLED",
        detected: {
          longtableSkill: Boolean(longtableSkill.trim()),
          longtableResearchSkill: Boolean(longtableResearchSkill.trim()),
          registeredLongtableSkill: Boolean(registeredLongtableSkill.trim()),
          registeredLongtableResearchSkill: Boolean(registeredLongtableResearchSkill.trim()),
          marketplaceRegistered,
          pluginRegistered,
        },
        message: "Public Proposal and both LongTable skills must be discoverable through the registered Codex plugin.",
      };
    }
    return {
      name: "plugin",
      status: "pass",
      detected: {
        version: installedPlugin.version,
        pluginSha: installedPluginSha,
        bundleSha: installedBundleSha,
        skills: ["longtable", "longtable-research"],
        marketplaceRegistered,
        pluginRegistered,
      },
      message: "Public Proposal and LongTable skills are discoverable through the registered Codex plugin.",
    };
  } catch (error) {
    return {
      name: "plugin",
      status: "blocker",
      code: "PP_PLUGIN_INTEGRITY_FAILED",
      detected: error instanceof Error ? error.message : String(error),
      message: "Packaged public-proposal plugin cannot be verified.",
    };
  }
}

function marketplaceListContainsNamed(stdout: string, name: string, source: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { marketplaces?: Array<{ name?: string; root?: string; path?: string; marketplaceSource?: { source?: string } }> };
    return parsed.marketplaces?.some((entry) => entry.name === name
      && (entry.root ?? entry.path ?? entry.marketplaceSource?.source) === source) ?? false;
  } catch {
    return false;
  }
}

function pluginListContainsNamed(stdout: string, pluginId: string, name: string, marketplace: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { installed?: Array<{ pluginId?: string; installed?: boolean }>; plugins?: Array<{ name?: string; marketplace?: string }> };
    return (parsed.installed?.some((entry) => entry.pluginId === pluginId && entry.installed === true) ?? false)
      || (parsed.plugins?.some((entry) => entry.name === name && entry.marketplace === marketplace) ?? false);
  } catch {
    return false;
  }
}

async function validateBundleFiles(
  bundleRaw: string,
  bundleRoot: string,
  dependencies: DoctorDependencies,
): Promise<DoctorCheck | null> {
  const bundle = JSON.parse(bundleRaw) as { files?: Array<{ path?: string; sha256?: string }> };
  for (const file of bundle.files ?? []) {
    if (!file.path || !file.sha256) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
        detected: file,
        message: "Installed Korean bundle manifest contains an invalid file entry.",
      };
    }
    const installedFile = join(bundleRoot, file.path);
    if (!(await dependencies.exists(installedFile))) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
        detected: { missing: installedFile },
        message: "Installed Korean bundle file is missing.",
      };
    }
    const actual = await dependencies.sha256(installedFile);
    if (normalizeHash(actual) !== normalizeHash(file.sha256)) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
        detected: { path: installedFile, actual, expected: file.sha256 },
        message: "Installed Korean bundle file hash does not match the bundle manifest.",
      };
    }
  }
  return null;
}

function normalizeHash(hash: string): string {
  return hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
}

function marketplaceListContains(stdout: string, marketplacePath: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { marketplaces?: Array<{ name?: string; root?: string; path?: string; marketplaceSource?: { source?: string } }> };
    return parsed.marketplaces?.some((entry) => entry.name === "public-proposal" && [entry.root, entry.path, entry.marketplaceSource?.source].includes(marketplacePath)) ?? false;
  } catch { return false; }
}

function pluginListContains(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { installed?: Array<{ pluginId?: string; installed?: boolean }>; plugins?: Array<{ name?: string; marketplace?: string }> };
    return (parsed.installed?.some((entry) => entry.pluginId === "public-proposal@public-proposal" && entry.installed === true) ?? false)
      || (parsed.plugins?.some((entry) => entry.name === "public-proposal" && entry.marketplace === "public-proposal") ?? false);
  } catch { return false; }
}

export async function kppCheck(
  spawn: ProcessRunner,
  expectedVersion: string,
  packageVersion?: PackageVersionResolver,
): Promise<DoctorCheck> {
  const result = await spawn("kpp", ["--version"]);
  const detected = normalizeVersion(result.stdout);
  if (result.code === 0 && detected) {
    if (detected !== expectedVersion) {
      return {
        name: "kpp",
        status: "blocker",
        code: "PP_KPP_VERSION_MISMATCH",
        detected,
        message: `@longtable/kpp-cli must be exactly ${expectedVersion}.`,
      };
    }
    return { name: "kpp", status: "pass", detected, message: "Pinned KPP CLI version is installed." };
  }

  const metadataVersion = packageVersion ? await packageVersion("@longtable/kpp-cli") : null;
  if (metadataVersion === expectedVersion) {
    const probe = await spawn("kpp", ["doctor", "--json"]);
    if (probe.code === 0) {
      return {
        name: "kpp",
        status: "pass",
        detected: { version: metadataVersion, source: "package.json", probe: "doctor --json" },
        message: "Pinned KPP CLI package is installed; its supported doctor probe passed.",
      };
    }
  }

  if (metadataVersion !== null && metadataVersion !== expectedVersion) {
    return {
      name: "kpp",
      status: "blocker",
      code: "PP_KPP_VERSION_MISMATCH",
      detected: metadataVersion,
      message: `@longtable/kpp-cli must be exactly ${expectedVersion}.`,
    };
  }

  return {
    name: "kpp",
    status: "blocker",
    code: "PP_KPP_VERSION_MISMATCH",
    detected: detected || null,
    message: `@longtable/kpp-cli must be exactly ${expectedVersion}.`,
  };
}

export async function longtableCheck(
  spawn: ProcessRunner,
  expectedVersion: string,
  projectClass: DoctorInput["projectClass"],
  packageVersion?: PackageVersionResolver,
  forceRequired = false,
): Promise<DoctorCheck> {
  const result = await spawn("longtable", ["--version"]);
  const detected = normalizeVersion(result.stdout);
  const required = forceRequired || (projectClass !== undefined && RESEARCH_CLASSES.has(projectClass));
  if (result.code === 0 && detected) {
    if (detected !== expectedVersion) {
      return {
        name: "longtable",
        status: "blocker",
        code: "PP_LONGTABLE_VERSION_MISMATCH",
        detected,
        message: `@longtable/cli must be exactly ${expectedVersion}.`,
      };
    }
    return { name: "longtable", status: "pass", detected, message: "Pinned LongTable CLI version is installed." };
  }

  const metadataVersion = packageVersion ? await packageVersion("@longtable/cli") : null;
  if (metadataVersion === expectedVersion) {
    const probe = await spawn("longtable", ["scholar-research", "doctor", "--json"]);
    if (probe.code === 0) {
      return {
        name: "longtable",
        status: "pass",
        detected: { version: metadataVersion, source: "package.json", probe: "scholar-research doctor" },
        message: "Pinned LongTable CLI package is installed; its supported doctor probe passed.",
      };
    }
  }

  if (metadataVersion !== null && metadataVersion !== expectedVersion) {
    return {
      name: "longtable",
      status: "blocker",
      code: "PP_LONGTABLE_VERSION_MISMATCH",
      detected: metadataVersion,
      message: `@longtable/cli must be exactly ${expectedVersion}.`,
    };
  }

  if (result.code !== 0 || !detected) {
    return {
      name: "longtable",
      status: required ? "blocker" : "warning",
      code: "PP_LONGTABLE_REQUIRED",
      detected: null,
      message: "LongTable CLI is required for academic, research-service, and policy-research proposals.",
    };
  }
  return { name: "longtable", status: "pass", detected, message: "Pinned LongTable CLI version is installed." };
}

async function scholarResearchCheck(
  spawn: ProcessRunner,
  projectClass: DoctorInput["projectClass"],
): Promise<DoctorCheck> {
  const result = await spawn("longtable", ["scholar-research", "doctor", "--json"]);
  const required = projectClass !== undefined && RESEARCH_CLASSES.has(projectClass);
  if (result.code !== 0) {
    return {
      name: "scholarResearch",
      status: required ? "blocker" : "warning",
      detected: result.stderr || result.stdout || null,
      message: "LongTable scholar-research doctor did not pass.",
    };
  }
  return {
    name: "scholarResearch",
    status: "pass",
    detected: parseJsonOrText(result.stdout),
    message: "LongTable scholar-research doctor passed.",
  };
}

async function workerCheck(
  installRoot: string,
  dependencies: DoctorDependencies,
  expectedProtocol: string,
): Promise<DoctorCheck> {
  const manifestRaw = await dependencies.readFile(join(installRoot, "installation.json")).catch(() => undefined);
  if (manifestRaw === undefined) {
    return {
      name: "worker",
      status: "blocker",
      code: "PP_WORKER_PROTOCOL_MISSING",
      detected: null,
      message: `Managed worker protocol ${expectedProtocol} is required.`,
    };
  }
  try {
    const worker = await verifyManagedWorkerFromManifestContents(manifestRaw, {
      realpath: dependencies.realpath,
      sha256: dependencies.sha256,
    });
    const protocol = await verifyWorkerProtocol(worker.executable, dependencies.spawn);
    return { name: "worker", status: "pass", detected: { protocol, worker }, message: "Managed worker protocol is installed." };
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "PP_WORKER_PROTOCOL_MISSING";
    return {
      name: "worker",
      status: "blocker",
      code,
      detected: null,
      message: `Managed worker protocol ${expectedProtocol} is required.`,
    };
  }
}

function authorityCheck(): DoctorCheck {
  return {
    name: "authority",
    status: "pass",
    detected: {
      kppVersion: SUPPORTED_KPP_VERSION,
      longtableVersion: SUPPORTED_LONGTABLE_VERSION,
      workerProtocol: WORKER_PROTOCOL_VERSION,
    },
    message: "Pinned authority versions are configured.",
  };
}

function normalizeVersion(stdout: string): string {
  const match = stdout.match(/\d+\.\d+\.\d+/);
  return match?.[0] ?? "";
}

async function canonicalPath(path: string, realpath?: (path: string) => Promise<string>): Promise<string> {
  if (realpath === undefined) return path;
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function parseJsonOrText(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
