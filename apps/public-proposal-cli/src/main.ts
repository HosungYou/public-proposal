#!/usr/bin/env node

import { Command } from "commander";
import {
  parseDoctorInput,
  parseSetupOptions,
  SUPPORTED_KPP_VERSION,
  SUPPORTED_LONGTABLE_VERSION,
  WORKER_PROTOCOL_VERSION,
  type DoctorCheck,
  type DoctorReport,
  type SetupResult,
} from "./contracts.js";

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
  readonly dryRun?: boolean;
}

interface DoctorCliOptions extends JsonOption {
  readonly projectClass?:
    | "academic_research"
    | "research_service"
    | "policy_research"
    | "general_procurement"
    | "document_restyle";
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
    .command("setup <installRoot>")
    .option("--provider <provider>", "Installer provider", "codex")
    .option("--install-scope <installScope>", "Install scope (user or project)")
    .option("--dry-run", "Preview setup changes without applying them")
    .option("--json", "Emit the standard JSON envelope")
    .action(async (installRoot: string, options: SetupCliOptions) => {
      const parsed = parseSetupOptions({
        provider: options.provider,
        installScope: options.installScope,
        dryRun: options.dryRun,
      });
      const result: SetupResult = {
        ok: true,
        plan: [
          `Prepare installer root at ${installRoot}`,
          "Validate plugin, worker, and marketplace bundle inputs",
        ],
        writes: parsed.dryRun ? [] : [`${installRoot}/install-manifest.json`],
        manifestPath: parsed.dryRun ? undefined : `${installRoot}/install-manifest.json`,
        checks: [],
      };
      writeEnvelope(success("Setup contract parsed.", { installRoot, ...result, options: parsed }), options.json === true);
    });

  program
    .command("doctor <installRoot>")
    .option("--project-class <projectClass>", "Proposal class for compatibility checks")
    .option("--json", "Emit the standard JSON envelope")
    .action(async (installRoot: string, options: DoctorCliOptions) => {
      const input = parseDoctorInput({
        installRoot,
        projectClass: options.projectClass,
        expectedKppVersion: SUPPORTED_KPP_VERSION,
        expectedLongtableVersion: SUPPORTED_LONGTABLE_VERSION,
        expectedWorkerProtocol: WORKER_PROTOCOL_VERSION,
      });
      const checks: readonly DoctorCheck[] = [
        {
          name: "authority",
          status: "warning",
          detected: { installRoot: input.installRoot, projectClass: input.projectClass ?? null },
          message: "Doctor authority checks are scaffolded but not yet implemented.",
          action: "Implement setup/doctor execution in a later task.",
        },
      ];
      const report: DoctorReport = { ok: false, checks };
      writeEnvelope(success("Doctor contract parsed.", report), options.json === true);
    });

  try {
    await program.parseAsync(["node", "public-proposal", ...argv]);
    return 0;
  } catch (error) {
    writeEnvelope(failure(error), argv.includes("--json"));
    return 1;
  }
}

function success(message: string, data: unknown): CliEnvelope {
  return { ok: true, code: "PP_OK", message, data };
}

function failure(error: unknown): CliEnvelope {
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
