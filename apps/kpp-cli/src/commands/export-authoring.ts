import { resolve } from "node:path";
import { exportAuthoring } from "@kpp/core";
import { success, type CliEnvelope } from "../output.js";
import { readJsonFile } from "./ingest.js";

export async function exportAuthoringCommand(
  rootInput: string,
  options: { readonly issuerProfile?: string; readonly terminology?: string },
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
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
