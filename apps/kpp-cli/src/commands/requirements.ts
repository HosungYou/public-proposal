import { resolve } from "node:path";
import { lockRequirements } from "@longtable/kpp-core";
import { success, type CliEnvelope } from "../output.js";
import { readJsonFile } from "./ingest.js";

export async function requirementsCommand(
  rootInput: string,
  candidatesInput: string,
  decisionsInput: string,
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  const candidatesPath = resolve(candidatesInput);
  const decisionsPath = resolve(decisionsInput);
  const result = await lockRequirements(root, {
    candidates: await readJsonFile(candidatesPath),
    decisions: await readJsonFile(decisionsPath),
  });
  return success("사람이 확인한 요구사항, 충돌 원장과 조견표를 잠갔습니다.", {
    ...result,
    candidatesPath,
    decisionsPath,
  });
}
