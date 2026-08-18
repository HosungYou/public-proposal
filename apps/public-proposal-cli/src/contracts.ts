import { z } from "zod";

export const INSTALL_MANIFEST_SCHEMA_VERSION = "1.0.0";
export const SUPPORTED_KPP_VERSION = "0.2.1";
export const SUPPORTED_LONGTABLE_VERSION = "0.1.72";
export const WORKER_PROTOCOL_VERSION = "1.0.0";

export type ProposalClass =
  | "academic_research"
  | "research_service"
  | "policy_research"
  | "general_procurement"
  | "document_restyle";

export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
) => Promise<ProcessResult>;

export interface SetupDependencies {
  readonly spawn: ProcessRunner;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, contents: string, mode?: number) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly sha256: (path: string) => Promise<string>;
  readonly now: () => string;
}

export interface UninstallDependencies {
  readonly readManifest: (path: string) => Promise<InstallManifest & { ownedPaths: readonly string[] }>;
  readonly remove: (path: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
}

export interface UpdateDependencies {
  readonly readMatrix: () => Promise<unknown>;
  readonly checkCompatibility: (matrix: unknown) => Promise<readonly DoctorCheck[]>;
  readonly setup: (options: SetupOptions) => Promise<SetupResult>;
}

const proposalClassSchema = z.enum([
  "academic_research",
  "research_service",
  "policy_research",
  "general_procurement",
  "document_restyle",
]);

const setupOptionsSchema = z.object({
  provider: z.literal("codex"),
  installScope: z.enum(["user", "project"]).default("user"),
  dryRun: z.boolean().default(false),
  cwd: z.string().min(1).optional(),
  home: z.string().min(1).optional(),
  installRoot: z.string().min(1).optional(),
});

const installManifestSchema = z.object({
  schemaVersion: z.literal(INSTALL_MANIFEST_SCHEMA_VERSION),
  packageVersion: z.string().min(1),
  kppVersion: z.literal(SUPPORTED_KPP_VERSION),
  longtableVersion: z.literal(SUPPORTED_LONGTABLE_VERSION),
  pluginVersion: z.string().min(1),
  workerProtocol: z.literal(WORKER_PROTOCOL_VERSION),
  installRoot: z.string().min(1),
  pluginManifestSha256: z.string().min(1),
  bundleManifestSha256: z.string().min(1),
  ownedPaths: z.array(z.string().min(1)).readonly(),
  createdAt: z.string().datetime({ offset: true }),
});

const doctorCheckNameSchema = z.enum([
  "node",
  "npm",
  "codex",
  "python",
  "libreoffice",
  "fonts",
  "plugin",
  "kpp",
  "longtable",
  "scholarResearch",
  "worker",
  "authority",
]);

const doctorCheckSchema = z.object({
  name: doctorCheckNameSchema,
  status: z.enum(["pass", "warning", "blocker"]),
  code: z.string().min(1).optional(),
  detected: z.unknown(),
  message: z.string().min(1),
  action: z.string().min(1).optional(),
});

const doctorInputSchema = z.object({
  installRoot: z.string().min(1),
  projectClass: proposalClassSchema.optional(),
  expectedKppVersion: z.literal(SUPPORTED_KPP_VERSION),
  expectedLongtableVersion: z.literal(SUPPORTED_LONGTABLE_VERSION),
  expectedWorkerProtocol: z.literal(WORKER_PROTOCOL_VERSION),
});

const doctorReportSchema = z.object({
  ok: z.boolean(),
  checks: z.array(doctorCheckSchema).readonly(),
  manifest: installManifestSchema.optional(),
});

const setupResultSchema = z.object({
  ok: z.boolean(),
  plan: z.array(z.string()).readonly(),
  writes: z.array(z.string()).readonly(),
  manifestPath: z.string().min(1).optional(),
  checks: z.array(doctorCheckSchema).readonly(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).optional(),
  manifest: installManifestSchema.optional(),
});

const updateOptionsSchema = z.object({
  installRoot: z.string().min(1),
  apply: z.boolean(),
});

export type SetupOptions = z.input<typeof setupOptionsSchema>;
export type InstallManifest = z.infer<typeof installManifestSchema>;
export type DoctorCheck = z.infer<typeof doctorCheckSchema>;
export type DoctorInput = z.infer<typeof doctorInputSchema>;
export type DoctorReport = z.infer<typeof doctorReportSchema>;
export type SetupResult = z.infer<typeof setupResultSchema>;
export type UpdateOptions = z.infer<typeof updateOptionsSchema>;

export class PublicProposalContractError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.code = code;
    this.name = "PublicProposalContractError";
  }
}

export function parseSetupOptions(input: unknown): SetupOptions {
  if (
    typeof input === "object" &&
    input !== null &&
    "provider" in input &&
    (input as { provider?: unknown }).provider !== "codex"
  ) {
    throw new PublicProposalContractError("PP_SETUP_PROVIDER_UNSUPPORTED");
  }
  return setupOptionsSchema.parse(input);
}

export function parseInstallManifest(input: unknown): InstallManifest {
  return installManifestSchema.parse(input);
}

export function parseDoctorInput(input: unknown): DoctorInput {
  return doctorInputSchema.parse(input);
}

export function parseDoctorReport(input: unknown): DoctorReport {
  return doctorReportSchema.parse(input);
}

export function parseSetupResult(input: unknown): SetupResult {
  return setupResultSchema.parse(input);
}

export function parseUpdateOptions(input: unknown): UpdateOptions {
  return updateOptionsSchema.parse(input);
}
