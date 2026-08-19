import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import {
  ProjectSchema,
  type ProjectRecord,
  type ProposalClass,
} from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";

export const PROJECT_FILE_NAME = "kpp.project.yaml";

// `release/` is intentionally absent: only the release command may create the
// final submission directory.
export const PROJECT_DIRECTORIES = [
  "sources",
  "requirements",
  "brief",
  "evidence",
  "content",
  "figures",
  "build",
  "rendered",
  "audit",
  "receipts",
] as const;

export interface ProjectInitialization {
  readonly projectId: string;
  readonly issuerPack?: string | null;
  readonly proposalClass?: ProposalClass;
  readonly schemaVersion?: string;
}

export function projectPath(root: string): string {
  return join(root, PROJECT_FILE_NAME);
}

export async function initializeProject(
  root: string,
  input: ProjectInitialization,
): Promise<ProjectRecord> {
  const project = parseProject({
    schemaVersion: input.schemaVersion ?? "1.0.0",
    projectId: input.projectId,
    proposalClass: input.proposalClass ?? "general_procurement",
    state: "INIT",
    issuerPack: input.issuerPack ?? null,
    approvalPolicy: "single_owner",
  }, projectPath(root));

  await Promise.all(PROJECT_DIRECTORIES.map((directory) => mkdir(join(root, directory), {
    recursive: true,
  })));
  await persistProject(projectPath(root), project);
  return project;
}

export async function readProject(root: string): Promise<ProjectRecord> {
  const path = projectPath(root);
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new KppError("KPP_INPUT_PROJECT_READ", "프로젝트 파일을 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }

  try {
    return parseProject(parse(contents), path);
  } catch (error) {
    if (error instanceof KppError) {
      throw error;
    }
    throw new KppError("KPP_INPUT_PROJECT_INVALID", "프로젝트 파일 형식이 올바르지 않습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

export async function persistProjectState(
  root: string,
  project: ProjectRecord,
): Promise<ProjectRecord> {
  const parsed = parseProject(project, projectPath(root));
  await persistProject(projectPath(root), parsed);
  return parsed;
}

function parseProject(value: unknown, path: string): ProjectRecord {
  const parsed = ProjectSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new KppError("KPP_INPUT_PROJECT_INVALID", "프로젝트 파일 형식이 올바르지 않습니다.", {
    path,
    actual: parsed.error.issues,
  });
}

async function persistProject(path: string, project: ProjectRecord): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let created = false;
  let renamed = false;

  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(stringify(project), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    renamed = true;
    await syncDirectory(directory);
  } finally {
    if (created && !renamed) {
      await rm(temporaryPath, { force: true });
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
