#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import {
  parseDoctorInput,
  parseSetupOptions,
  SUPPORTED_KPP_VERSION,
  SUPPORTED_LONGTABLE_VERSION,
  WORKER_PROTOCOL_VERSION,
  type DoctorReport,
  type SetupResult,
} from "./contracts.js";
import { runDoctor } from "./commands/doctor.js";
import { runSetup } from "./commands/setup.js";
import { runUninstall } from "./commands/uninstall.js";
import { runUpdate } from "./commands/update.js";
import { installationRoot } from "./paths.js";
import { AGENT_TRIGGER_MATRIX, selectAgentProfile, type AgentStage, type ProposalClass, type ProposalRisk } from "./agent-policy.js";

interface CliEnvelope {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly data: unknown;
}

interface JsonOption {
  readonly json?: boolean;
}

interface SetupCliOptions extends JsonOption {
  readonly provider?: string;
  readonly installScope?: "user" | "project";
  readonly installRoot?: string;
  readonly dryRun?: boolean;
}

interface DoctorCliOptions extends JsonOption {
  readonly installScope?: "user" | "project";
  readonly installRoot?: string;
  readonly projectClass?:
    | "academic_research"
    | "research_service"
    | "policy_research"
    | "general_procurement"
    | "document_restyle";
}

interface UpdateCliOptions extends JsonOption {
  readonly apply?: boolean;
  readonly installRoot?: string;
  readonly installScope?: "user" | "project";
}

interface AgentProfileCliOptions extends JsonOption {
  readonly proposalClass?: ProposalClass;
  readonly risk?: ProposalRisk;
  readonly stage?: AgentStage;
  readonly hasFigure?: boolean;
  readonly hasTable?: boolean;
  readonly representative?: boolean;
  readonly hasInstitutionFacts?: boolean;
  readonly hasQualificationOrPii?: boolean;
  readonly hasAcademicEvidence?: boolean;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const program = new Command()
    .name("public-proposal")
    .description("Public proposal meta-installer")
    .exitOverride((error) => {
      if (error.code !== "commander.helpDisplayed") {
        throw error;
      }
    })
    .showSuggestionAfterError(false)
    .showHelpAfterError(false)
    .configureOutput({
      writeOut: (message) => process.stdout.write(message),
      writeErr: () => undefined,
    });

  program
    .command("setup")
    .option("--provider <provider>", "Installer provider", "codex")
    .option("--install-scope <installScope>", "Install scope (user or project)", "user")
    .option("--install-root <installRoot>", "Advanced override for the derived install root")
    .option("--dry-run", "Preview setup changes without applying them")
    .option("--json", "Emit the standard JSON envelope")
    .action(async (options: SetupCliOptions) => {
      const root = resolveRoot(options.installScope ?? "user", options.installRoot);
      const parsed = parseSetupOptions({
        provider: options.provider,
        installScope: options.installScope,
        installRoot: root,
        cwd: process.cwd(),
        home: process.env.HOME,
        dryRun: options.dryRun,
      });
      const result = await runSetup(parsed);
      if (!result.ok) {
        throw new PublicProposalCliError(
          result.error?.code ?? "PP_SETUP_FAILED",
          result.error?.message ?? "Public Proposal setup failed.",
          result,
        );
      }
      writeEnvelope(success("Public Proposal setup completed.", result), Boolean(options.json));
    });

  program
    .command("doctor")
    .option("--install-scope <installScope>", "Install scope (user or project)", "user")
    .option("--install-root <installRoot>", "Advanced override for the derived install root")
    .option("--project-class <projectClass>", "Proposal class for compatibility checks")
    .option("--json", "Emit the standard JSON envelope")
    .action(async (options: DoctorCliOptions) => {
      const input = parseDoctorInput({
        installRoot: resolveRoot(options.installScope ?? "user", options.installRoot),
        projectClass: options.projectClass,
        expectedKppVersion: SUPPORTED_KPP_VERSION,
        expectedLongtableVersion: SUPPORTED_LONGTABLE_VERSION,
        expectedWorkerProtocol: WORKER_PROTOCOL_VERSION,
      });
      const report: DoctorReport = await runDoctor(input);
      if (!report.ok) {
        const blocker = report.checks.find((check) => check.status === "blocker") ?? report.checks[0];
        throw new PublicProposalCliError(
          blocker?.code ?? "PP_DOCTOR_FAILED",
          blocker?.message ?? "Public Proposal doctor found a blocker.",
          report,
        );
      }
      writeEnvelope(success("Public Proposal doctor passed.", report), Boolean(options.json));
    });

  program
    .command("uninstall")
    .option("--install-scope <installScope>", "Install scope (user or project)", "user")
    .option("--install-root <installRoot>", "Advanced override for the derived install root")
    .option("--json", "Emit the standard JSON envelope")
    .action(async (options: DoctorCliOptions) => {
      const result = await runUninstall(resolveRoot(options.installScope ?? "user", options.installRoot));
      writeEnvelope(success("Public Proposal uninstall completed.", result), Boolean(options.json));
    });

  program
    .command("update")
    .option("--install-scope <installScope>", "Install scope (user or project)", "user")
    .option("--install-root <installRoot>", "Advanced override for the derived install root")
    .option("--apply", "Apply the previewed update")
    .option("--json", "Emit the standard JSON envelope")
    .action(async (options: UpdateCliOptions) => {
      const result = await runUpdate(
        { installRoot: resolveRoot(options.installScope ?? "user", options.installRoot), apply: Boolean(options.apply) },
        {
          readMatrix: async () => ({ publicProposalVersion: "0.1.0" }),
          checkCompatibility: async () => [
            { name: "authority", status: "pass", detected: "0.1.0", message: "Current compatibility matrix is valid." },
          ],
          setup: async (setupOptions) => runSetup(setupOptions),
        },
      );
      if (options.apply && result.mode !== "applied") {
        const blocked = result.changes.find((change) => change.startsWith("blocked: "));
        const code = blocked?.replace("blocked: ", "") || "PP_UPDATE_APPLY_FAILED";
        throw new PublicProposalCliError(code, "Public Proposal update apply failed.", result);
      }
      writeEnvelope(success("Public Proposal update preview completed.", result), Boolean(options.json));
    });

  program
    .command("agent-profile")
    .option("--proposal-class <proposalClass>", "Proposal class", "general_procurement")
    .option("--risk <risk>", "Proposal risk", "low")
    .option("--stage <stage>", "Workflow stage", "authoring")
    .option("--has-figure", "Route visual/render review")
    .option("--has-table", "Route visual/render review")
    .option("--representative", "Route representative prose/evaluator review")
    .option("--has-institution-facts", "Route institutional evidence/data review")
    .option("--has-qualification-or-pii", "Route proof/privacy review")
    .option("--has-academic-evidence", "Route conditional LongTable research")
    .option("--json", "Emit the standard JSON envelope")
    .action((options: AgentProfileCliOptions) => {
      const plan = selectAgentProfile({
        proposalClass: options.proposalClass ?? "general_procurement",
        risk: options.risk ?? "low",
        stage: options.stage ?? "authoring",
        hasFigure: Boolean(options.hasFigure),
        hasTable: Boolean(options.hasTable),
        representative: Boolean(options.representative),
        hasInstitutionFacts: Boolean(options.hasInstitutionFacts),
        hasQualificationOrPii: Boolean(options.hasQualificationOrPii),
        hasAcademicEvidence: Boolean(options.hasAcademicEvidence),
      });
      writeEnvelope(success("Public Proposal agent profile selected.", { plan, triggerMatrix: AGENT_TRIGGER_MATRIX }), Boolean(options.json));
    });

  try {
    await program.parseAsync(["node", "public-proposal", ...argv]);
    return 0;
  } catch (error) {
    writeEnvelope(failure(error), argv.includes("--json"));
    return 1;
  }
}

function resolveRoot(scope: "user" | "project", override?: string): string {
  return resolve(override ?? installationRoot(scope, process.cwd(), process.env.HOME ?? process.cwd()));
}

function success(message: string, data: unknown): CliEnvelope {
  return { ok: true, code: "PP_OK", message, data };
}

class PublicProposalCliError extends Error {
  readonly code: string;
  readonly data: unknown;

  constructor(code: string, message: string, data: unknown) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = "PublicProposalCliError";
  }
}

function failure(error: unknown): CliEnvelope {
  if (error instanceof PublicProposalCliError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      data: error.data,
    };
  }

  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      data: {
        actual: error.message,
      },
    };
  }

  return {
    ok: false,
    code: "PP_INPUT_COMMAND",
    message: "Command input is invalid.",
    data: {
      actual: error instanceof Error ? error.message : String(error),
    },
  };
}

function writeEnvelope(envelope: CliEnvelope, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return;
  }

  process.stdout.write(`${envelope.message}\n`);
}

void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
