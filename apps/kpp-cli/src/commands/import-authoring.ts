import { resolve } from "node:path";
import { importAuthoring } from "@longtable/kpp-core";
import { success, type CliEnvelope } from "../output.js";
import { readJsonFile } from "./ingest.js";

export async function importAuthoringCommand(
  rootInput: string,
  responseInput: string,
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  const responsePath = resolve(responseInput);
  const result = await importAuthoring(root, await readJsonFile(responsePath));
  return success("증거 범위를 검증한 provisional 작성 응답을 저장했습니다.", result);
}
