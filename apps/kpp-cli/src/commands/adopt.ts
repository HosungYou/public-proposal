import { adoptProject } from "@longtable/kpp-core";
import { success, type CliEnvelope } from "../output.js";

export interface AdoptOptions {
  readonly source?: string;
  readonly master?: string;
}

export async function adoptCommand(root: string, options: AdoptOptions): Promise<CliEnvelope> {
  return success("기존 제안서 작업을 UNMANAGED_DRAFT로 연결했습니다.", await adoptProject({
    root,
    source: options.source,
    master: options.master,
  }));
}
