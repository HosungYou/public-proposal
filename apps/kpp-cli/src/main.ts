#!/usr/bin/env node

import { Command } from "commander";
import { doctorCommand } from "./commands/doctor.js";
import { ingestCommand } from "./commands/ingest.js";
import { initializeCommand } from "./commands/init.js";
import { planCommand } from "./commands/plan.js";
import { statusCommand } from "./commands/status.js";
import { failure, writeEnvelope } from "./output.js";

interface JsonOption {
  readonly json?: boolean;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const program = new Command()
    .name("kpp")
    .description("KPP 제안서 컴파일러")
    .exitOverride()
    .showSuggestionAfterError(false)
    .showHelpAfterError(false)
    .configureOutput({
      writeOut: () => undefined,
      writeErr: () => undefined,
    });

  program
    .command("doctor")
    .option("--json", "JSON 형식으로 출력")
    .action(async (options: JsonOption) => {
      writeEnvelope(await doctorCommand(), options.json === true);
    });

  program
    .command("init <root>")
    .option("--project-id <projectId>", "프로젝트 식별자")
    .option("--issuer-pack <issuerPack>", "기관 팩 식별자")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { projectId?: string; issuerPack?: string }) => {
      writeEnvelope(await initializeCommand(root, options), options.json === true);
    });

  program
    .command("status <root>")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption) => {
      writeEnvelope(await statusCommand(root), options.json === true);
    });

  program
    .command("ingest <root> <rfp>")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, rfp: string, options: JsonOption) => {
      writeEnvelope(await ingestCommand(root, rfp), options.json === true);
    });

  program
    .command("plan <root>")
    .requiredOption("--requirements <path>", "사용자 확인 요구사항 JSON")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { requirements: string }) => {
      writeEnvelope(await planCommand(root, options.requirements), options.json === true);
    });

  try {
    await program.parseAsync(["node", "kpp", ...argv]);
    return 0;
  } catch (error) {
    writeEnvelope(failure(error), argv.includes("--json"));
    return 1;
  }
}

void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
