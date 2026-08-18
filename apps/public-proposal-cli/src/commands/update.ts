import type { DoctorCheck, InstallManifest, SetupOptions, SetupResult, UpdateOptions } from "../contracts.js";

export interface UpdateDependencies {
  readonly readMatrix: () => Promise<unknown>;
  readonly checkCompatibility: (matrix: unknown) => Promise<readonly DoctorCheck[]>;
  readonly setup: (options: SetupOptions) => Promise<SetupResult>;
}

export async function runUpdate(
  options: UpdateOptions,
  dependencies: UpdateDependencies,
): Promise<{ mode: "preview" | "applied"; changes: readonly string[]; manifest?: InstallManifest }> {
  const matrix = await dependencies.readMatrix();
  const checks = await dependencies.checkCompatibility(matrix);
  const blocker = checks.find((check) => check.status === "blocker");
  if (blocker) {
    return {
      mode: "preview",
      changes: [`blocked: ${blocker.code ?? blocker.name}`],
    };
  }

  const changes = changesFromMatrix(matrix);
  if (!options.apply) {
    return { mode: "preview", changes };
  }

  const setup = await runSetupForUpdate(dependencies, options.installRoot);
  if (!setup.ok) {
    return {
      mode: "preview",
      changes: [`blocked: ${setup.error?.code ?? "PP_SETUP_FAILED"}`],
    };
  }
  return {
    mode: "applied",
    changes,
    manifest: setup.manifest,
  };
}

async function runSetupForUpdate(
  dependencies: UpdateDependencies,
  installRoot: string,
): Promise<SetupResult> {
  try {
    return await dependencies.setup({
      provider: "codex",
      installScope: "user",
      installRoot,
    });
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "PP_SETUP_FAILED";
    return {
      ok: false,
      plan: [],
      writes: [],
      checks: [],
      error: {
        code,
        message: error instanceof Error ? error.message : "Setup failed during update apply.",
      },
    };
  }
}

function changesFromMatrix(matrix: unknown): readonly string[] {
  if (typeof matrix !== "object" || matrix === null) {
    return ["compatibility matrix update available"];
  }
  const version = (matrix as { publicProposalVersion?: unknown }).publicProposalVersion;
  if (typeof version === "string" && version.length > 0) {
    return [`@longtable/public-proposal ${version}`];
  }
  return ["compatibility matrix update available"];
}
