import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUPPORTED_KPP_VERSION,
  SUPPORTED_LONGTABLE_VERSION,
  WORKER_PROTOCOL_VERSION,
  type DoctorCheck,
  type DoctorInput,
  type DoctorReport,
  type ProcessRunner,
} from "../contracts.js";
import { nodeFs } from "../process.js";

export interface DoctorDependencies {
  readonly packageRoot?: string;
  readonly spawn: ProcessRunner;
  readonly readFile: (path: string) => Promise<string>;
  readonly exists: (path: string) => Promise<boolean>;
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
  checks.push(await kppCheck(dependencies.spawn, input.expectedKppVersion));
  checks.push(await longtableCheck(dependencies.spawn, input.expectedLongtableVersion, input.projectClass));
  checks.push(await scholarResearchCheck(dependencies.spawn, input.projectClass));
  checks.push(await workerCheck(dependencies.spawn, input.expectedWorkerProtocol));
  checks.push(authorityCheck());

  return {
    ok: !checks.some((check) => check.status !== "pass"),
    checks,
  };
}

function defaultDoctorDependencies(): DoctorDependencies {
  return {
    ...nodeFs,
    packageRoot: defaultPackageRoot(),
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
  const marketplacePath = join(packageRoot, "marketplace", "marketplace.json");
  try {
    const [pluginRaw, bundleRaw, marketplaceRaw, pluginSha] = await Promise.all([
      dependencies.readFile(pluginManifestPath),
      dependencies.readFile(bundleManifestPath),
      dependencies.readFile(marketplacePath),
      dependencies.sha256(pluginManifestPath),
    ]);
    const plugin = JSON.parse(pluginRaw) as { name?: string; version?: string };
    const marketplace = JSON.parse(marketplaceRaw) as {
      plugins?: Array<{ name?: string; source?: { path?: string } }>;
    };
    JSON.parse(bundleRaw);
    const marketplaceEntry = marketplace.plugins?.find((entry) => entry.name === "public-proposal");
    const installedPluginPath = join(installRoot, "plugin", ".codex-plugin", "plugin.json");
    const installed = await dependencies.exists(installedPluginPath);
    if (
      plugin.name !== "public-proposal" ||
      marketplaceEntry?.source?.path !== "../plugin" ||
      !pluginSha.startsWith("sha256:")
    ) {
      return {
        name: "plugin",
        status: "blocker",
        code: "PP_PLUGIN_INTEGRITY_FAILED",
        detected: { pluginName: plugin.name, marketplaceSource: marketplaceEntry?.source?.path, pluginSha },
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
    return {
      name: "plugin",
      status: "pass",
      detected: { version: plugin.version, pluginSha },
      message: "Public Proposal plugin integrity is valid.",
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

async function kppCheck(spawn: ProcessRunner, expectedVersion: string): Promise<DoctorCheck> {
  const result = await spawn("kpp", ["--version"]);
  const detected = normalizeVersion(result.stdout);
  if (result.code !== 0 || detected !== expectedVersion) {
    return {
      name: "kpp",
      status: "blocker",
      code: "PP_KPP_VERSION_MISMATCH",
      detected: detected || null,
      message: `@longtable/kpp-cli must be exactly ${expectedVersion}.`,
    };
  }
  return { name: "kpp", status: "pass", detected, message: "Pinned KPP CLI version is installed." };
}

async function longtableCheck(
  spawn: ProcessRunner,
  expectedVersion: string,
  projectClass: DoctorInput["projectClass"],
): Promise<DoctorCheck> {
  const result = await spawn("longtable", ["--version"]);
  const detected = normalizeVersion(result.stdout);
  const required = projectClass !== undefined && RESEARCH_CLASSES.has(projectClass);
  if (result.code !== 0 || !detected) {
    return {
      name: "longtable",
      status: required ? "blocker" : "warning",
      code: "PP_LONGTABLE_REQUIRED",
      detected: null,
      message: "LongTable CLI is required for academic, research-service, and policy-research proposals.",
    };
  }
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

async function workerCheck(spawn: ProcessRunner, expectedProtocol: string): Promise<DoctorCheck> {
  const result = await spawn("kpp", ["worker", "doctor", "--json"]);
  const detected = parseJsonOrText(result.stdout) as { protocol?: string } | string | null;
  const protocol = typeof detected === "object" && detected !== null ? detected.protocol : undefined;
  if (result.code !== 0 || protocol !== expectedProtocol) {
    return {
      name: "worker",
      status: "blocker",
      code: "PP_WORKER_PROTOCOL_MISSING",
      detected,
      message: `Managed worker protocol ${expectedProtocol} is required.`,
    };
  }
  return { name: "worker", status: "pass", detected, message: "Managed worker protocol is installed." };
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

function parseJsonOrText(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
