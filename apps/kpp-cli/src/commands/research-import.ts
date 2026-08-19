import { resolve } from "node:path";
import { importEvidenceBundle } from "../research-bridge.js";
import { success, type CliEnvelope } from "../output.js";

export async function researchImportCommand(
  rootInput: string,
  bundleInput: string,
): Promise<CliEnvelope> {
  const result = await importEvidenceBundle(resolve(rootInput), resolve(bundleInput));
  return success("LongTable 연구 bundle을 검증하고 KPP 연구 잠금 영수증에 결속했습니다.", result);
}
