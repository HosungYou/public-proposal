import { dirname, join } from "node:path";
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
import { verifyInstalledHwpxEngine, type HwpxEngineInstallation } from "../hwpx-engine.js";

export interface DoctorDependencies {
  readonly packageRoot?: string;
  readonly packageVersion?: PackageVersionResolver;
  readonly spawn: ProcessRunner;
  readonly readFile: (path: string) => Promise<string>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly sha256: (path: string) => Promise<string>;
  readonly listDir?: (path: string) => Promise<readonly string[]>;
  readonly verifyHwpxEngine?: (skillRoot: string) => Promise<HwpxEngineInstallation>;
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

async function pluginCheck(
  installRoot: string,
  packageRoot: string,
  dependencies: DoctorDependencies,
): Promise<DoctorCheck> {
  const pluginManifestPath = join(packageRoot, "plugin", ".codex-plugin", "plugin.json");
  const bundleManifestPath = join(packageRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const installedPluginPath = join(installRoot, "plugin", ".codex-plugin", "plugin.json");
  const installedBundlePath = join(installRoot, "plugin", "skills", "korean-public-proposal", "BUNDLE-MANIFEST.json");
  const installedSkillRoot = join(installRoot, "plugin", "skills", "korean-public-proposal");
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
    const [marketplaces, plugins, skillSurfaces, hwpxEngine] = await Promise.all([
      dependencies.spawn("codex", ["plugin", "marketplace", "list", "--json"]),
      dependencies.spawn("codex", ["plugin", "list", "--json"]),
      dependencies.listDir ? dependencies.listDir(join(installRoot, "plugin", "skills")) : Promise.resolve(["korean-public-proposal"]),
      (dependencies.verifyHwpxEngine ?? verifyInstalledHwpxEngine)(installedSkillRoot),
    ]);
    const marketplacePath = await canonicalPath(join(installRoot, "marketplace"), dependencies.realpath);
    const marketplaceRegistered = marketplaces.code === 0
      && marketplaceListContains(marketplaces.stdout, marketplacePath);
    const pluginRegistered = plugins.code === 0 && pluginListContains(plugins.stdout);
    if (
      skillSurfaces.length !== 1
      || skillSurfaces[0] !== "korean-public-proposal"
      || !marketplaceRegistered
      || !pluginRegistered
    ) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_NOT_INSTALLED",
        detected: {
          skillSurfaces,
          hwpxEngine,
          marketplaceRegistered,
          pluginRegistered,
        },
        message: "Public Proposal must expose exactly one Korean skill surface through the registered Codex plugin.",
      };
    }
    return {
      name: "plugin",
      status: "pass",
      detected: {
        version: installedPlugin.version,
        pluginSha: installedPluginSha,
        bundleSha: installedBundleSha,
        skills: ["korean-public-proposal"],
        hwpxEngine,
        marketplaceRegistered,
        pluginRegistered,
      },
      message: "The single Korean Public Proposal surface and pinned HWPX engine are verified.",
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
