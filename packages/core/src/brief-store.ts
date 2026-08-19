import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  LivingProposalBriefV1Schema,
  type LivingProposalBriefV1,
  type Receipt,
} from "@longtable/kpp-schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";
import { readProject } from "./project-store.js";
import { verifyProjectState, advanceProject } from "./state-machine.js";
import { writeReceipt } from "./receipts.js";

const BRIEF_FILE_NAME = "living-brief.json";
const LOCK_SUMMARY_FILE_NAME = "brief-lock-summary.json";

export interface BriefDiff {
  readonly confirmed: readonly string[];
  readonly changed: readonly string[];
  readonly stillOpen: readonly string[];
  readonly invalidatedDownstream: readonly string[];
  readonly nextHumanGate: string;
}

export async function lockLivingBrief(rootInput: string, briefInput: unknown): Promise<Receipt> {
  const root = resolve(rootInput);
  const project = await verifyProjectState(root);
  if (project.state !== "REQUIREMENTS_LOCKED") {
    throw new KppError("KPP_STATE_INVALID_TRANSITION", "Living Brief는 REQUIREMENTS_LOCKED 상태에서만 잠글 수 있습니다.", {
      stage: project.state,
      expected: "REQUIREMENTS_LOCKED",
      actual: project.state,
    });
  }
  const brief = parseBrief(briefInput);
  if (brief.projectId !== project.projectId || brief.proposalClass !== project.proposalClass) {
    throw new KppError("KPP_INPUT_BRIEF_PROJECT", "Living Brief의 프로젝트 식별자가 현재 프로젝트와 일치하지 않습니다.", {
      expected: { projectId: project.projectId, proposalClass: project.proposalClass },
      actual: { projectId: brief.projectId, proposalClass: brief.proposalClass },
    });
  }

  const briefPath = livingBriefPath(root);
  const summaryPath = join(root, "brief", LOCK_SUMMARY_FILE_NAME);
  await writeJsonAtomically(briefPath, brief);
  const briefSha256 = await sha256File(briefPath);
  await writeJsonAtomically(summaryPath, {
    schemaVersion: "living-brief-lock/v1",
    briefSha256,
    doctrineVersion: brief.doctrineVersion,
    activeDecisionIds: brief.activeDecisions.map(({ decisionId }) => decisionId),
    openCriticalDecisionIds: brief.openDecisions
      .filter(({ critical }) => critical)
      .map(({ decisionId }) => decisionId),
  });
  const summarySha256 = await sha256File(summaryPath);
  const requirementsReceiptPath = join(root, "receipts", "requirements-lock.json");
  const receipt = await writeReceipt({
    stage: "BRIEF_LOCKED",
    files: [briefPath, summaryPath],
    inputs: [
      { name: "brief", path: briefPath, sha256: briefSha256 },
      { name: "doctrine", path: summaryPath, sha256: summarySha256 },
    ],
    inputReceiptHashes: [await sha256File(requirementsReceiptPath)],
    output: join(root, "receipts", "brief-lock.json"),
  });
  await advanceProject(root, "BRIEF_LOCKED");
  return receipt;
}

export async function readLivingBrief(rootInput: string): Promise<LivingProposalBriefV1> {
  const root = resolve(rootInput);
  const path = livingBriefPath(root);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new KppError("KPP_INPUT_BRIEF_READ", "Living Brief를 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
  try {
    return parseBrief(JSON.parse(raw));
  } catch (error) {
    if (error instanceof KppError) throw error;
    throw new KppError("KPP_INPUT_BRIEF_INVALID", "Living Brief JSON 형식이 올바르지 않습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

/** Returns only the decision-review fields that are allowed in a human diff. */
export function diffBrief(previous: LivingProposalBriefV1, next: LivingProposalBriefV1): BriefDiff {
  const previousDecisions = new Map(previous.activeDecisions.map((decision) => [decision.decisionId, decision]));
  const nextDecisions = new Map(next.activeDecisions.map((decision) => [decision.decisionId, decision]));
  const confirmed = [...nextDecisions.entries()]
    .filter(([decisionId, decision]) => JSON.stringify(previousDecisions.get(decisionId)) === JSON.stringify(decision))
    .map(([decisionId]) => decisionId);
  const changedDecisionIds = new Set([
    ...[...previousDecisions.keys()].filter((decisionId) => !nextDecisions.has(decisionId)),
    ...[...nextDecisions.entries()]
      .filter(([decisionId, decision]) => JSON.stringify(previousDecisions.get(decisionId)) !== JSON.stringify(decision))
      .map(([decisionId]) => decisionId),
  ]);
  const changed = [...changedDecisionIds].sort();
  if (previous.problem !== next.problem) changed.push("problem");
  if (previous.doctrineVersion !== next.doctrineVersion) changed.push("doctrineVersion");
  if (JSON.stringify(previous.evidenceBoundary) !== JSON.stringify(next.evidenceBoundary)) changed.push("evidenceBoundary");
  if (JSON.stringify(previous.approvedReferences) !== JSON.stringify(next.approvedReferences)) changed.push("approvedReferences");

  const invalidatedDownstream = new Set<string>();
  for (const decisionId of changedDecisionIds) {
    for (const decision of [previousDecisions.get(decisionId), nextDecisions.get(decisionId)]) {
      decision?.affects.forEach((affected) => invalidatedDownstream.add(affected));
    }
  }
  if (changed.includes("evidenceBoundary") || changed.includes("approvedReferences")) {
    invalidatedDownstream.add("research");
  }
  return {
    confirmed: confirmed.sort(),
    changed: [...new Set(changed)].sort(),
    stillOpen: next.openDecisions.map(({ decisionId }) => decisionId).sort(),
    invalidatedDownstream: [...invalidatedDownstream].sort(),
    nextHumanGate: next.nextHumanGate,
  };
}

export function livingBriefPath(root: string): string {
  return join(root, "brief", BRIEF_FILE_NAME);
}

function parseBrief(value: unknown): LivingProposalBriefV1 {
  const parsed = LivingProposalBriefV1Schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new KppError("KPP_INPUT_BRIEF_INVALID", "Living Brief 형식이 올바르지 않습니다.", {
    actual: parsed.error.issues,
  });
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
    await syncDirectory(directory);
  } finally {
    if (created && !renamed) await rm(temporaryPath, { force: true });
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
