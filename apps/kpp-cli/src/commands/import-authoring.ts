import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { resolve } from "node:path";
import { importAuthoring, KppError, readProject } from "@longtable/kpp-core";
import { SectionAuthoringRequestSchema, SectionAuthoringResponseSchema } from "@longtable/kpp-schemas";
import { success, type CliEnvelope } from "../output.js";
import { readJsonFile } from "./ingest.js";

export async function importAuthoringCommand(
  rootInput: string,
  responseInput: string,
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  const responsePath = resolve(responseInput);
  const response = await readJsonFile(responsePath);
  if (isSectionAuthoringResponse(response)) {
    return importSectionAuthoring(root, response);
  }
  const result = await importAuthoring(root, response);
  return success("증거 범위를 검증한 provisional 작성 응답을 저장했습니다.", result);
}

async function importSectionAuthoring(root: string, responseInput: unknown): Promise<CliEnvelope> {
  const [project, requestRaw] = await Promise.all([
    readProject(root),
    readFile(join(root, "content", "section-authoring-request.json"), "utf8"),
  ]);
  const request = SectionAuthoringRequestSchema.parse(JSON.parse(requestRaw));
  const response = SectionAuthoringResponseSchema.parse(responseInput);
  if (response.projectId !== project.projectId || response.projectId !== request.projectId || response.inputHash !== request.inputHash) {
    throw new KppError("KPP_INPUT_SECTION_AUTHORING_MISMATCH", "Section 작성 응답이 현재 요청과 일치하지 않습니다.", {
      expected: { projectId: request.projectId, inputHash: request.inputHash },
      actual: { projectId: response.projectId, inputHash: response.inputHash },
    });
  }
  const sections = new Map(request.sectionPlan.sections.map((section) => [section.sectionId, section]));
  for (const section of response.sections) {
    const requestSection = sections.get(section.sectionId);
    if (requestSection === undefined
      || !isSubset(section.claimIds, requestSection.claimIds)
      || !isSubset(section.evidenceIds, requestSection.evidenceIds)
      || !isSubset(section.unresolvedDecisionIds, requestSection.openDecisionIds)) {
      throw new KppError("KPP_INPUT_SECTION_AUTHORING_SCOPE", "Section 작성 응답이 요청된 claim/evidence/decision 범위를 벗어났습니다.", {
        actual: { sectionId: section.sectionId },
      });
    }
  }
  const outputPath = join(root, "content", "section-authoring-response.json");
  await writeJsonAtomically(outputPath, response);
  return success("페이지 메타데이터 없는 section 작성 응답을 저장했습니다.", {
    responsePath: outputPath,
    sectionCount: response.sections.length,
  });
}

function isSectionAuthoringResponse(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && "schemaVersion" in value
    && value.schemaVersion === "section-authoring-response/v1";
}

function isSubset(values: readonly string[], allowed: readonly string[]): boolean {
  const allowedValues = new Set(allowed);
  return values.every((value) => allowedValues.has(value));
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let created = false;
  let renamed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    renamed = true;
  } finally {
    if (created && !renamed) await rm(temporaryPath, { force: true });
  }
}
