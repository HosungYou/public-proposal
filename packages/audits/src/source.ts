import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256File } from "@longtable/kpp-core";

export type AuditStatus = "PASS" | "BLOCKED";

export interface AuditFinding {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export interface AuditArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface AuditSlice {
  readonly status: AuditStatus;
  readonly findings: readonly AuditFinding[];
  readonly artifacts: readonly AuditArtifact[];
}

export async function inspectArtifact(path: string): Promise<AuditArtifact> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1) {
    throw new Error("artifact is missing, empty, or not a regular file");
  }
  return { path, sha256: await sha256File(path), bytes: metadata.size };
}

export async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON root must be an object");
  }
  return parsed as Record<string, unknown>;
}

export function blocked(
  code: string,
  message: string,
  input: Omit<AuditFinding, "code" | "message"> = {},
): AuditFinding {
  return { code, message, ...input };
}

export function makeSlice(
  findings: readonly AuditFinding[],
  artifacts: readonly AuditArtifact[],
): AuditSlice {
  const sortedFindings = [...findings].sort(compareFindings);
  const sortedArtifacts = deduplicateArtifacts(artifacts).sort((left, right) => left.path.localeCompare(right.path));
  return {
    status: sortedFindings.length === 0 ? "PASS" : "BLOCKED",
    findings: sortedFindings,
    artifacts: sortedArtifacts,
  };
}

export function combineSlices(slices: readonly AuditSlice[]): AuditSlice {
  return makeSlice(
    slices.flatMap((slice) => slice.findings),
    slices.flatMap((slice) => slice.artifacts),
  );
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function writeStableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`${stableJson(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    created = false;
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function compareFindings(left: AuditFinding, right: AuditFinding): number {
  return `${left.code}\0${left.path ?? ""}\0${left.message}`.localeCompare(
    `${right.code}\0${right.path ?? ""}\0${right.message}`,
  );
}

function deduplicateArtifacts(artifacts: readonly AuditArtifact[]): AuditArtifact[] {
  const byPath = new Map<string, AuditArtifact>();
  for (const artifact of artifacts) byPath.set(artifact.path, artifact);
  return [...byPath.values()];
}
