import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProject } from "../src/migration.js";

describe("project migration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
      force: true,
      recursive: true,
    })));
  });

  it("reports an explicit mode decision without writing during a dry run", async () => {
    const root = await createLegacyProject(temporaryDirectories);
    const projectPath = join(root, "kpp.project.yaml");
    const sourcePath = join(root, "sources", "rfp.txt");
    const originalProject = await readFile(projectPath);
    const originalSource = await readFile(sourcePath);

    const report = await migrateProject(root, {
      apply: false,
      documentMode: "private_partnership",
    });

    expect(report).toMatchObject({
      fromSchemaVersion: "1.0.0",
      toSchemaVersion: "2.0.0",
      backupPath: null,
      backupScope: "project_metadata_only",
      receiptPath: expect.stringContaining(".kpp-migrations"),
      decisions: expect.arrayContaining(["documentMode:private_partnership"]),
    });
    await expect(readFile(projectPath)).resolves.toEqual(originalProject);
    await expect(readFile(sourcePath)).resolves.toEqual(originalSource);
    await expect(stat(join(root, ".kpp-migrations"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("backs up v1 metadata and writes a hash-bound migration receipt only with apply", async () => {
    const root = await createLegacyProject(temporaryDirectories);
    const projectPath = join(root, "kpp.project.yaml");
    const originalProject = await readFile(projectPath);
    const originalSource = await readFile(join(root, "sources", "rfp.txt"));
    const originalEvidence = await readFile(join(root, "evidence", "source.txt"));

    const report = await migrateProject(root, {
      apply: true,
      documentMode: "private_partnership",
    });

    expect(report.backupPath).toMatch(/\.kpp-migrations\/[^/]+\/backup$/);
    expect(report.backupScope).toBe("project_metadata_only");
    expect(report.receiptPath).toContain(report.migrationId);
    await expect(readFile(join(report.backupPath ?? "", "kpp.project.yaml"))).resolves.toEqual(originalProject);
    await expect(readFile(projectPath, "utf8")).resolves.toContain("schemaVersion: 2.0.0");
    await expect(readFile(projectPath, "utf8")).resolves.toContain("documentMode: private_partnership");
    await expect(readFile(join(root, "sources", "rfp.txt"))).resolves.toEqual(originalSource);
    await expect(readFile(join(root, "evidence", "source.txt"))).resolves.toEqual(originalEvidence);
    await expect(readFile(report.receiptPath, "utf8")).resolves.toContain(report.destinationSha256);
    await expect(readFile(join(root, "content", "page-architecture.json"), "utf8")).resolves.toContain('"pages": []');
    await expect(readFile(join(root, "evidence", "reference-manifest.json"), "utf8")).resolves.toContain('"references": []');
  });

  it("rejects an ambiguous v1 project until a document mode is supplied", async () => {
    const root = await createLegacyProject(temporaryDirectories);

    await expect(migrateProject(root, { apply: false })).rejects.toMatchObject({
      code: "KPP_MIGRATION_DOCUMENT_MODE_REQUIRED",
    });
    await expect(readdir(root)).resolves.not.toContain(".kpp-migrations");
  });

  it("fails closed for an unsupported source schema version", async () => {
    const root = await createLegacyProject(temporaryDirectories, "3.0.0");
    const projectPath = join(root, "kpp.project.yaml");
    const originalProject = await readFile(projectPath);

    await expect(migrateProject(root, {
      apply: false,
      documentMode: "private_partnership",
    })).rejects.toMatchObject({ code: "KPP_MIGRATION_UNSUPPORTED_SOURCE" });
    await expect(readFile(projectPath)).resolves.toEqual(originalProject);
  });
});

async function createLegacyProject(
  temporaryDirectories: string[],
  schemaVersion: string = "1.0.0",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kpp-migration-"));
  temporaryDirectories.push(root);
  await Promise.all([
    mkdir(join(root, "sources"), { recursive: true }),
    mkdir(join(root, "evidence"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "kpp.project.yaml"), [
      `schemaVersion: ${schemaVersion}`,
      "projectId: legacy-project",
      "proposalClass: general_procurement",
      "state: INIT",
      "issuerPack: null",
      "approvalPolicy: single_owner",
      "",
    ].join("\n")),
    writeFile(join(root, "sources", "rfp.txt"), "source bytes"),
    writeFile(join(root, "evidence", "source.txt"), "evidence bytes"),
  ]);
  return root;
}
