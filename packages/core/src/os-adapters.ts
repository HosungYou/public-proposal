import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { KppError } from "./errors.js";

const execFileAsync = promisify(execFile);

export interface ExecutableIdentity {
  readonly path: string;
  readonly version: string;
}

export interface ResolveExecutableInput {
  readonly name: string;
  readonly candidates: readonly string[];
  readonly versionArgs: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
}

export interface ExecuteFileInput {
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
}

export interface ExecuteFileResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Resolve and version an executable without invoking a shell. */
export async function resolveVerifiedExecutable(
  input: ResolveExecutableInput,
): Promise<ExecutableIdentity> {
  const environment = input.environment ?? process.env;
  for (const candidate of input.candidates) {
    for (const path of executablePaths(candidate, environment)) {
      try {
        await access(path, constants.X_OK);
        const versionResult = await executeFile(path, input.versionArgs, {
          environment,
          timeoutMs: 10_000,
        });
        const version = `${versionResult.stdout}${versionResult.stderr}`.trim();
        if (version.length > 0) {
          return { path, version };
        }
      } catch {
        // Continue through the locked candidate list.
      }
    }
  }

  throw new KppError(
    "KPP_RENDER_EXECUTABLE_MISSING",
    `${input.name} 실행 파일을 확인할 수 없습니다.`,
    { expected: input.candidates, stage: "BUILT" },
  );
}

/** Execute a verified program with an argument vector and shell expansion disabled. */
export async function executeFile(
  executable: string,
  args: readonly string[],
  input: ExecuteFileInput = {},
): Promise<ExecuteFileResult> {
  try {
    const result = await execFileAsync(executable, [...args], {
      cwd: input.cwd,
      encoding: "utf8",
      env: input.environment ?? process.env,
      maxBuffer: input.maxBufferBytes ?? 16 * 1024 * 1024,
      shell: false,
      timeout: input.timeoutMs ?? 120_000,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    throw new KppError("KPP_RENDER_PROCESS_FAILED", "문서 렌더링 프로세스가 실패했습니다.", {
      path: executable,
      actual: error instanceof Error ? error.message : error,
      stage: "BUILT",
    });
  }
}

function executablePaths(
  candidate: string,
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  if (candidate.trim().length === 0) {
    return [];
  }
  if (isAbsolute(candidate)) {
    return [resolve(candidate)];
  }
  return (environment.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry.length > 0)
    .map((entry) => join(entry, candidate));
}
