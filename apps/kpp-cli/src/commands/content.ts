import { resolve } from "node:path";
import { approveContent } from "@longtable/kpp-audits";
import { verifyResearchRequirement } from "@longtable/kpp-core";
import { success, type CliEnvelope } from "../output.js";

export async function contentApproveCommand(
  rootInput: string,
  options: { readonly approvedBy?: string },
): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  await verifyResearchRequirement(root);
  const result = await approveContent(root, { approvedBy: options.approvedBy });
  return success("검증된 콘텐츠를 제출책임자가 승인했습니다.", result);
}
