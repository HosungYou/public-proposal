import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { KppError, sha256File } from "@longtable/kpp-core";
import {
  createResearchRequest,
  researchRequestPath,
  routeResearch,
  type ResearchRequestOptions,
} from "../research-bridge.js";
import { success, type CliEnvelope } from "../output.js";

export async function researchRequestCommand(
  rootInput: string,
  requirementsInput: string,
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  const options = await readOptions(resolve(requirementsInput));
  const request = await createResearchRequest(root, options);
  const path = researchRequestPath(root);
  return success("잠긴 요구사항에서 LongTable 연구 요청을 생성했습니다.", {
    request,
    requestPath: path,
    requestHash: await sha256File(path),
    route: await routeResearch({
      proposalClass: request.proposalClass,
      academicEvidence: request.targetArtifacts.includes("method"),
      routingDecision: request.routingDecision,
    }),
  });
}

async function readOptions(path: string): Promise<ResearchRequestOptions> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new KppError("PP_RESEARCH_REQUEST_INVALID", "연구 요구사항 JSON을 읽을 수 없습니다.", {
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || !("institution" in value)
    || !("questions" in value)
    || !("requiredData" in value)
  ) {
    throw new KppError("PP_RESEARCH_REQUEST_INVALID", "연구 요구사항 JSON 형식이 올바르지 않습니다.", {
      path,
    });
  }
  return value as ResearchRequestOptions;
}
