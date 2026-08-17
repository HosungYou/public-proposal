import { resolve } from "node:path";
import { readProject } from "@longtable/kpp-core";
import { success, type CliEnvelope } from "../output.js";

export async function statusCommand(rootInput: string): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  return success("프로젝트 상태를 확인했습니다.", await readProject(root));
}
