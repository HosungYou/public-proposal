import { access } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { initializeProject, KppError, projectPath } from "@kpp/core";
import { success, type CliEnvelope } from "../output.js";

export interface InitOptions {
  readonly issuerPack?: string;
  readonly projectId?: string;
}

export async function initializeCommand(rootInput: string, options: InitOptions): Promise<CliEnvelope> {
  const root = resolve(rootInput);
  const projectFile = projectPath(root);

  try {
    await access(projectFile);
    throw new KppError("KPP_INPUT_PROJECT_EXISTS", "이미 초기화된 프로젝트입니다.", {
      path: projectFile,
    });
  } catch (error) {
    if (error instanceof KppError) {
      throw error;
    }
  }

  const projectId = options.projectId ?? basename(root);
  if (projectId.length === 0 || projectId === "." || projectId === "/") {
    throw new KppError("KPP_INPUT_PROJECT_INVALID", "프로젝트 식별자가 올바르지 않습니다.", {
      path: root,
      actual: projectId,
    });
  }

  const project = await initializeProject(root, {
    projectId,
    issuerPack: options.issuerPack,
  });
  return success("프로젝트를 초기화했습니다.", project);
}
