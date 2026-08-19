#!/usr/bin/env node

import { Command, Option } from "commander";
import { contentApproveCommand } from "./commands/content.js";
import { approveCommand } from "./commands/approve.js";
import { auditCommand } from "./commands/audit.js";
import { buildCommand } from "./commands/build.js";
import { doctorCommand } from "./commands/doctor.js";
import { exportAuthoringCommand } from "./commands/export-authoring.js";
import { ingestCommand } from "./commands/ingest.js";
import { importAuthoringCommand } from "./commands/import-authoring.js";
import { initializeCommand } from "./commands/init.js";
import { planCommand } from "./commands/plan.js";
import { requirementsCommand } from "./commands/requirements.js";
import { researchImportCommand } from "./commands/research-import.js";
import { researchLockCommand } from "./commands/research-lock.js";
import { researchRequestCommand } from "./commands/research-request.js";
import { renderCommand } from "./commands/render.js";
import { releaseCommand } from "./commands/release.js";
import { statusCommand } from "./commands/status.js";
import { failure, writeEnvelope } from "./output.js";

const PROPOSAL_CLASSES = [
  "academic_research",
  "research_service",
  "policy_research",
  "general_procurement",
  "document_restyle",
] as const;

interface JsonOption {
  readonly json?: boolean;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const program = new Command()
    .name("kpp")
    .description("KPP 제안서 컴파일러")
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
    .command("doctor")
    .option("--json", "JSON 형식으로 출력")
    .action(async (options: JsonOption) => {
      writeEnvelope(await doctorCommand(), options.json === true);
    });

  program
    .command("init <root>")
    .option("--project-id <projectId>", "프로젝트 식별자")
    .option("--issuer-pack <issuerPack>", "기관 팩 식별자")
    .addOption(new Option("--proposal-class <proposalClass>", "제안서 분류").choices(PROPOSAL_CLASSES))
    .option("--json", "JSON 형식으로 출력")
    .action(async (
      root: string,
      options: JsonOption & {
        projectId?: string;
        issuerPack?: string;
        proposalClass?: (typeof PROPOSAL_CLASSES)[number];
      },
    ) => {
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
    .command("requirements <root>")
    .requiredOption("--candidates <path>", "pending 후보 요구사항 JSON")
    .requiredOption("--decisions <path>", "사람 확인·충돌해소 JSON")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { candidates: string; decisions: string }) => {
      writeEnvelope(
        await requirementsCommand(root, options.candidates, options.decisions),
        options.json === true,
      );
    });

  program
    .command("research-request <root>")
    .requiredOption("--requirements <path>", "기관·데이터 연구 요구사항 JSON")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { requirements: string }) => {
      writeEnvelope(await researchRequestCommand(root, options.requirements), options.json === true);
    });

  program
    .command("research-import <root>")
    .requiredOption("--bundle <path>", "LongTable Evidence/Data Bundle JSON 또는 legacy handoff")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { bundle: string }) => {
      writeEnvelope(await researchImportCommand(root, options.bundle), options.json === true);
    });

  program
    .command("research-lock <root>")
    .requiredOption("--handoff <path>", "LongTable 연구 handoff JSON")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { handoff: string }) => {
      writeEnvelope(await researchLockCommand(root, options.handoff), options.json === true);
    });

  program
    .command("plan <root>")
    .requiredOption("--requirements <path>", "사용자 확인 요구사항 JSON")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { requirements: string }) => {
      writeEnvelope(await planCommand(root, options.requirements), options.json === true);
    });

  program
    .command("export-authoring <root>")
    .option("--issuer-profile <path>", "확인된 기관 프로필 JSON")
    .option("--terminology <path>", "승인된 용어집 JSON")
    .option("--json", "JSON 형식으로 출력")
    .action(async (
      root: string,
      options: JsonOption & { issuerProfile?: string; terminology?: string },
    ) => {
      writeEnvelope(await exportAuthoringCommand(root, options), options.json === true);
    });

  program
    .command("import-authoring <root>")
    .requiredOption("--response <path>", "작성 어댑터 응답 JSON")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { response: string }) => {
      writeEnvelope(await importAuthoringCommand(root, options.response), options.json === true);
    });

  program
    .command("content-approve <root>")
    .requiredOption("--approved-by <name>", "콘텐츠 승인자 표시명")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { approvedBy?: string }) => {
      writeEnvelope(await contentApproveCommand(root, options), options.json === true);
    });

  program
    .command("render <root>")
    .requiredOption("--docx <path>", "canonical immutable DOCX 경로")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { docx?: string }) => {
      writeEnvelope(await renderCommand(root, options), options.json === true);
    });

  program
    .command("build <root>")
    .requiredOption("--request <path>", "잠긴 BuildRequest JSON")
    .option("--python <path>", "관리된 DOCX Python 경로")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { request: string; python?: string }) => {
      writeEnvelope(await buildCommand(root, options), options.json === true);
    });

  program
    .command("audit <root>")
    .requiredOption("--docx <path>", "canonical immutable DOCX 경로")
    .requiredOption("--build-manifest <path>", "canonical build manifest 경로")
    .requiredOption("--render-manifest <path>", "canonical render manifest 경로")
    .option("--figure <spec:svg:manifest>", "semantic figure artifact binding", collectOption, [])
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { docx: string; buildManifest: string; renderManifest: string; figure?: string[] }) => {
      writeEnvelope(await auditCommand(root, options), options.json === true);
    });

  program
    .command("approve <root>")
    .requiredOption("--approved-by <name>", "제출책임자 이름")
    .requiredOption("--audit <audit.json>", "현재 PASS audit JSON")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { approvedBy: string; audit: string }) => {
      writeEnvelope(await approveCommand(root, options), options.json === true);
    });

  program
    .command("release <root>")
    .requiredOption("--approval <approval.json>", "현재 human approval receipt")
    .requiredOption("--output <release-parent>", "immutable release 상위 경로")
    .option("--json", "JSON 형식으로 출력")
    .action(async (root: string, options: JsonOption & { approval: string; output: string }) => {
      writeEnvelope(await releaseCommand(root, options), options.json === true);
    });

  try {
    await program.parseAsync(["node", "kpp", ...argv]);
    return 0;
  } catch (error) {
    writeEnvelope(failure(error), argv.includes("--json"));
    return 1;
  }
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
