import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import {
  type DocumentMode,
  type ProjectV1Record,
  type ProjectV2Record,
  ProjectV2Schema,
} from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";
import { MODE_POLICY_VERSION, getDocumentModePolicy } from "./mode-policy.js";
import { persistProjectState, projectPath, readProject } from "./project-store.js";

const TARGET_SCHEMA_VERSION = "2.0.0";

export interface MigrationReport {
  readonly migrationId: string;
  readonly fromSchemaVersion: string;
  readonly toSchemaVersion: typeof TARGET_SCHEMA_VERSION;
  readonly sourceSha256: string;
  readonly destinationSha256: string;
  readonly backupPath: string | null;
  readonly backupScope: "project_metadata_only";
  readonly decisions: readonly string[];
  readonly warnings: readonly string[];
  readonly reportPath: string;
  readonly receiptPath: string;
}

export interface MigrateProjectOptions {
  readonly apply: boolean;
  readonly documentMode?: DocumentMode;
}

/**
 * Converts a v1 project only when the caller supplies an explicit document
 * mode. Dry runs are pure diagnoses; writes are opt-in and leave a byte-for-
 * byte copy of the legacy project metadata under .kpp-migrations.
 */
export async function migrateProject(
  root: string,
  options: MigrateProjectOptions,
): Promise<MigrationReport> {
  const sourceProjectPath = projectPath(root);
  let project;
  try {
    project = await readProject(root);
  } catch (error) {
    if (error instanceof KppError && error.code === "KPP_INPUT_PROJECT_INVALID") {
      throw new KppError("KPP_MIGRATION_UNSUPPORTED_SOURCE", "지원하지 않는 프로젝트 스키마 버전입니다.", {
        path: sourceProjectPath,
        actual: error.details.actual,
      });
    }
    throw error;
  }
  assertSupportedSource(project.schemaVersion);
  if (project.schemaVersion === TARGET_SCHEMA_VERSION) {
    throw new KppError("KPP_MIGRATION_ALREADY_CURRENT", "프로젝트가 이미 현재 스키마입니다.", {
      path: sourceProjectPath,
      actual: project.schemaVersion,
    });
  }
  if (options.documentMode === undefined) {
    throw new KppError("KPP_MIGRATION_DOCUMENT_MODE_REQUIRED", "v1 프로젝트 마이그레이션에는 문서 모드가 필요합니다.", {
      path: sourceProjectPath,
      expected: "--document-mode <document-mode>",
    });
  }

  const policy = getDocumentModePolicy(options.documentMode);
  const migrationId = createMigrationId();
  const migrationRoot = join(root, ".kpp-migrations", migrationId);
  const backupPath = join(migrationRoot, "backup");
  const reportPath = join(migrationRoot, "migration-report.json");
  const receiptPath = join(migrationRoot, "migration-receipt.json");
  const destination = ProjectV2Schema.parse(
    createDestinationProject(project, options.documentMode, migrationId),
  );
  const sourceSha256 = await sha256File(sourceProjectPath);
  const destinationSha256 = sha256Contents(stringify(destination));
  const skeletons = createSkeletons(root, destination);
  const preservedSkeletons = await Promise.all(skeletons.map(async (skeleton) => ({
    ...skeleton,
    exists: await pathExists(skeleton.path),
  })));
  const decisions = [
    `documentMode:${options.documentMode}`,
    `modePolicyVersion:${policy.modePolicyVersion}`,
    ...preservedSkeletons
      .filter((skeleton) => !skeleton.exists)
      .map((skeleton) => `created:${skeleton.name}`),
  ];
  const warnings = [
    "백업 범위는 project metadata only이며 기존 source/evidence 바이트는 원래 위치에서 수정하지 않습니다.",
    "아키텍처와 참조 골격은 비어 있으므로 다음 승인 전에 채우고 검증해야 합니다.",
    ...preservedSkeletons
      .filter((skeleton) => skeleton.exists)
      .map((skeleton) => `기존 ${skeleton.name} 파일을 보존했습니다.`),
    ...(options.apply ? [] : ["Dry run only; no files were written."]),
  ];
  const report: MigrationReport = {
    migrationId,
    fromSchemaVersion: project.schemaVersion,
    toSchemaVersion: TARGET_SCHEMA_VERSION,
    sourceSha256,
    destinationSha256,
    backupPath: options.apply ? backupPath : null,
    backupScope: "project_metadata_only",
    decisions,
    warnings,
    reportPath,
    receiptPath,
  };

  if (!options.apply) {
    return report;
  }

  await mkdir(backupPath, { recursive: true });
  await copyFile(sourceProjectPath, join(backupPath, "kpp.project.yaml"));
  await Promise.all(
    preservedSkeletons
      .filter((skeleton) => !skeleton.exists)
      .map(async (skeleton) => {
        await mkdir(dirname(skeleton.path), { recursive: true });
        await writeFile(skeleton.path, `${JSON.stringify(skeleton.contents, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
      }),
  );
  await persistProjectState(root, destination);
  const persistedDestinationSha256 = await sha256File(sourceProjectPath);
  if (persistedDestinationSha256 !== destinationSha256) {
    throw new KppError("KPP_MIGRATION_DESTINATION_HASH", "마이그레이션된 프로젝트 해시가 예상과 다릅니다.", {
      path: sourceProjectPath,
      expected: destinationSha256,
      actual: persistedDestinationSha256,
    });
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(receiptPath, `${JSON.stringify({
    receiptKind: "project_migration",
    createdAt: new Date().toISOString(),
    ...report,
  }, null, 2)}\n`, "utf8");
  return report;
}

function assertSupportedSource(version: string): void {
  if (version === "1.0.0" || version === TARGET_SCHEMA_VERSION) {
    return;
  }
  throw new KppError("KPP_MIGRATION_UNSUPPORTED_SOURCE", "지원하지 않는 프로젝트 스키마 버전입니다.", {
    expected: ["1.0.0", TARGET_SCHEMA_VERSION],
    actual: version,
  });
}

function createDestinationProject(
  source: ProjectV1Record,
  documentMode: DocumentMode,
  migrationId: string,
): ProjectV2Record {
  return {
    schemaVersion: TARGET_SCHEMA_VERSION,
    projectId: source.projectId,
    proposalClass: source.proposalClass,
    state: source.state,
    issuerPack: source.issuerPack,
    approvalPolicy: source.approvalPolicy,
    documentMode,
    modePolicyVersion: MODE_POLICY_VERSION,
    migrationHistory: [migrationId],
  };
}

function createSkeletons(root: string, project: ProjectV2Record): readonly {
  readonly name: string;
  readonly path: string;
  readonly contents: Record<string, unknown>;
}[] {
  return [
    {
      name: "page architecture",
      path: join(root, "content", "page-architecture.json"),
      contents: {
        schemaVersion: TARGET_SCHEMA_VERSION,
        projectId: project.projectId,
        documentMode: project.documentMode,
        modePolicyVersion: project.modePolicyVersion,
        architectureStatus: "staged",
        chapters: [],
        sections: [],
        pages: [],
      },
    },
    {
      name: "reference manifest",
      path: join(root, "evidence", "reference-manifest.json"),
      contents: {
        schemaVersion: TARGET_SCHEMA_VERSION,
        projectId: project.projectId,
        documentMode: project.documentMode,
        modePolicyVersion: project.modePolicyVersion,
        references: [],
      },
    },
  ];
}

function createMigrationId(): string {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID()}`;
}

function sha256Contents(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
