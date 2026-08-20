import { resolve } from "node:path";
import {
  migrateProject,
  KppError,
  type DocumentMode,
} from "@longtable/kpp-core";
import { success, type CliEnvelope } from "../output.js";

export interface MigrateOptions {
  readonly apply?: boolean;
  readonly documentMode?: DocumentMode;
  readonly to?: string;
}

export async function migrateCommand(rootInput: string, options: MigrateOptions): Promise<CliEnvelope> {
  if (options.to !== undefined && options.to !== "2.0.0") {
    throw new KppError("KPP_MIGRATION_UNSUPPORTED_TARGET", "지원하지 않는 마이그레이션 대상 버전입니다.", {
      expected: "2.0.0",
      actual: options.to,
    });
  }
  const report = await migrateProject(resolve(rootInput), {
    apply: options.apply === true,
    documentMode: options.documentMode,
  });
  return success(
    options.apply === true ? "프로젝트 마이그레이션을 적용했습니다." : "프로젝트 마이그레이션을 진단했습니다.",
    report,
  );
}
