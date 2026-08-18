import { resolve } from "node:path";
import { importResearchLock } from "@longtable/kpp-core";
import { success, type CliEnvelope } from "../output.js";

const SUPPORTED_LONGTABLE_VERSION = "0.1.72";

export async function researchLockCommand(
  rootInput: string,
  handoffInput: string,
): Promise<CliEnvelope> {
  const result = await importResearchLock(
    resolve(rootInput),
    resolve(handoffInput),
    SUPPORTED_LONGTABLE_VERSION,
  );
  return success("LongTable 연구 handoff를 검증하고 연구 잠금 영수증을 발급했습니다.", result);
}
