import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { resolve } from "node:path";
import { exportAuthoring, KppError, readProject, verifyResearchRequirement } from "@longtable/kpp-core";
import { SectionAuthoringRequestSchema, SectionPlanV1Schema } from "@longtable/kpp-schemas";
import { success, type CliEnvelope } from "../output.js";
import { readJsonFile } from "./ingest.js";

export async function exportAuthoringCommand(
  rootInput: string,
  options: { readonly issuerProfile?: string; readonly terminology?: string; readonly sectionPlan?: string },
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  if (options.sectionPlan !== undefined) {
    await verifyResearchRequirement(root);
    return exportSectionAuthoring(root, resolve(options.sectionPlan));
  }
  await verifyResearchRequirement(root);
  const issuerProfilePath = options.issuerProfile === undefined ? undefined : resolve(options.issuerProfile);
  const terminologyPath = options.terminology === undefined ? undefined : resolve(options.terminology);
  const result = await exportAuthoring(root, {
    ...(issuerProfilePath === undefined
      ? {}
      : { issuerProfile: { path: issuerProfilePath, value: await readJsonFile(issuerProfilePath) } }),
    ...(terminologyPath === undefined
      ? {}
      : { terminology: { path: terminologyPath, value: await readJsonFile(terminologyPath) } }),
  });
  return success("잠긴 요구사항과 증거 범위로 작성 요청 번들을 내보냈습니다.", result);
}

async function exportSectionAuthoring(root: string, sectionPlanPath: string): Promise<CliEnvelope> {
  const [project, sectionPlanInput] = await Promise.all([readProject(root), readJsonFile(sectionPlanPath)]);
  const sectionPlan = SectionPlanV1Schema.parse(sectionPlanInput);
  if (sectionPlan.projectId !== project.projectId) {
    throw new KppError("KPP_INPUT_SECTION_PLAN_PROJECT", "Section Plan의 프로젝트 식별자가 현재 프로젝트와 일치하지 않습니다.", {
      expected: project.projectId,
      actual: sectionPlan.projectId,
    });
  }
  const request = SectionAuthoringRequestSchema.parse({
    schemaVersion: "section-authoring-request/v1",
    projectId: project.projectId,
    inputHash: sha256(JSON.stringify({ projectId: project.projectId, sectionPlan })),
    sectionPlan,
  });
  const requestPath = join(root, "content", "section-authoring-request.json");
  await writeJsonAtomically(requestPath, request);
  return success("페이지 메타데이터 없이 section 작성 요청을 내보냈습니다.", {
    requestPath,
    sectionCount: request.sectionPlan.sections.length,
    inputHash: request.inputHash,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
