import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { success, type CliEnvelope } from "../output.js";
import { EXPECTED_WORKER_PROTOCOL, WORKER_PROTOCOL_PROBE, resolveExplicitWorker, resolveManagedWorker } from "../managed-worker.js";

const execFileAsync = promisify(execFile);

type CheckStatus = "pass" | "warn";

interface DoctorCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detected: unknown;
  readonly message: string;
  readonly action?: string;
}

export interface DoctorCandidates {
  readonly python: readonly string[];
  readonly soffice: readonly string[];
  readonly notoSans: readonly string[];
  readonly notoSerif: readonly string[];
}

export function getDoctorCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = environment.HOME ?? environment.USERPROFILE ?? homedir(),
): DoctorCandidates {
  const windowsRoot = environment.SystemRoot ?? environment.WINDIR ?? "C:\\Windows";
  const programFiles = environment.ProgramFiles ?? environment.PROGRAMFILES ?? "C:\\Program Files";
  const programFilesX86 = environment["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const platformSoffice = platform === "win32"
    ? [
      win32.join(programFiles, "LibreOffice", "program", "soffice.exe"),
      win32.join(programFilesX86, "LibreOffice", "program", "soffice.exe"),
      "soffice.exe",
      "soffice",
      "libreoffice.exe",
      "libreoffice",
    ]
    : platform === "darwin"
      ? [
        "/opt/homebrew/bin/soffice",
        "/usr/local/bin/soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "soffice",
        "libreoffice",
      ]
      : [
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
        "/snap/bin/libreoffice",
        "soffice",
        "libreoffice",
      ];
  const platformFonts = platform === "win32"
    ? {
      sans: [win32.join(windowsRoot, "Fonts", "NotoSansCJKkr-Regular.otf")],
      serif: [win32.join(windowsRoot, "Fonts", "NotoSerifCJKkr-Regular.otf")],
    }
    : platform === "darwin"
      ? {
        sans: [
          "/Library/Fonts/NotoSansCJKkr-Regular.otf",
          join(home, "Library/Fonts/NotoSansCJKkr-Regular.otf"),
        ],
        serif: [
          "/Library/Fonts/NotoSerifCJKkr-Regular.otf",
          join(home, "Library/Fonts/NotoSerifCJKkr-Regular.otf"),
        ],
      }
      : {
        sans: [
          "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf",
          "/usr/share/fonts/truetype/noto/NotoSansCJKkr-Regular.otf",
          join(home, ".local/share/fonts/NotoSansCJKkr-Regular.otf"),
        ],
        serif: [
          "/usr/share/fonts/opentype/noto/NotoSerifCJKkr-Regular.otf",
          "/usr/share/fonts/truetype/noto/NotoSerifCJKkr-Regular.otf",
          join(home, ".local/share/fonts/NotoSerifCJKkr-Regular.otf"),
        ],
      };

  return {
    python: platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"],
    soffice: filterDefined([environment.KPP_SOFFICE_PATH, ...platformSoffice]),
    notoSans: filterDefined([environment.KPP_NOTO_SANS_PATH, ...platformFonts.sans]),
    notoSerif: filterDefined([environment.KPP_NOTO_SERIF_PATH, ...platformFonts.serif]),
  };
}

export async function doctorCommand(): Promise<CliEnvelope> {
  const checks = await Promise.all([
    nodeCheck(),
    pythonCheck(),
    sofficeCheck(),
    notoFontsCheck(),
    temporaryStorageCheck(),
    workerProtocolCheck(),
  ]);

  return success("설치 진단을 완료했습니다.", {
    platform: process.platform,
    arch: process.arch,
    checks,
  });
}

async function nodeCheck(): Promise<DoctorCheck> {
  const version = process.version;
  const major = Number.parseInt(version.slice(1).split(".")[0] ?? "", 10);
  const supported = Number.isInteger(major) && major >= 22 && major < 27;
  return {
    name: "node",
    status: supported ? "pass" : "warn",
    detected: version,
    message: supported ? "지원되는 Node.js 런타임입니다." : "지원 범위(Node.js 22 이상 27 미만)를 확인하세요.",
    ...(!supported ? { action: "지원 범위의 Node.js를 설치한 뒤 다시 진단하세요." } : {}),
  };
}

async function pythonCheck(): Promise<DoctorCheck> {
  const detected = await firstVersion(getDoctorCandidates().python, ["--version"]);
  return {
    name: "python",
    status: detected === null ? "warn" : "pass",
    detected,
    message: detected === null ? "Python 워커를 실행할 Python을 찾지 못했습니다." : "Python 실행 파일을 확인했습니다.",
    ...(detected === null ? { action: "지원되는 Python을 설치하고 PATH에서 python3 또는 python을 사용할 수 있게 하세요." } : {}),
  };
}

async function sofficeCheck(): Promise<DoctorCheck> {
  const path = await firstExecutable(getDoctorCandidates().soffice);
  return {
    name: "soffice",
    status: path === undefined ? "warn" : "pass",
    detected: path ?? null,
    message: path === undefined ? "LibreOffice soffice를 찾지 못했습니다." : "LibreOffice soffice를 확인했습니다.",
    ...(path === undefined ? { action: "LibreOffice를 설치하거나 KPP_SOFFICE_PATH를 설정하세요." } : {}),
  };
}

async function notoFontsCheck(): Promise<DoctorCheck> {
  const candidates = getDoctorCandidates();
  const sans = await firstReadable(candidates.notoSans);
  const serif = await firstReadable(candidates.notoSerif);
  const detected = { sans: sans ?? null, serif: serif ?? null };
  const complete = sans !== undefined && serif !== undefined;
  return {
    name: "noto_fonts",
    status: complete ? "pass" : "warn",
    detected,
    message: complete ? "Noto Sans CJK KR와 Noto Serif CJK KR 경로를 확인했습니다." : "필수 Noto CJK 글꼴 경로를 모두 찾지 못했습니다.",
    ...(!complete ? { action: "Noto Sans/Serif CJK KR를 설치하거나 KPP_NOTO_*_PATH를 설정하세요." } : {}),
  };
}

async function temporaryStorageCheck(): Promise<DoctorCheck> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "kpp-doctor-"));
    const probe = join(directory, "write-probe");
    await writeFile(probe, "ok", { mode: 0o600 });
    const detected = await readFile(probe, "utf8");
    return {
      name: "temp_storage",
      status: detected === "ok" ? "pass" : "warn",
      detected: tmpdir(),
      message: detected === "ok" ? "임시 저장소 쓰기를 확인했습니다." : "임시 저장소 쓰기 결과가 예상과 다릅니다.",
    };
  } catch (error) {
    return {
      name: "temp_storage",
      status: "warn",
      detected: tmpdir(),
      message: "임시 저장소에 쓸 수 없습니다.",
      action: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

async function workerProtocolCheck(): Promise<DoctorCheck> {
  const worker = resolveExplicitWorker() ?? await resolveManagedWorker();
  const actual = worker === null ? null : await workerProtocolVersion(worker);
  const status: CheckStatus = actual === EXPECTED_WORKER_PROTOCOL ? "pass" : "warn";
  return {
    name: "worker_protocol",
    status,
    detected: { expected: EXPECTED_WORKER_PROTOCOL, actual, worker: worker ?? null },
    message: status === "pass" ? "Python 워커 프로토콜이 호환됩니다." : "호환되는 Python 워커 프로토콜을 확인하지 못했습니다.",
    ...(status === "warn" ? { action: "KPP_WORKER_PATH에 프로토콜 1.0.0 워커 실행 파일을 지정한 뒤 다시 진단하세요." } : {}),
  };
}

async function workerProtocolVersion(command: string): Promise<string | null> {
  return await executableVersion(command, ["--protocol-version"])
    ?? await executableVersion(command, ["-c", WORKER_PROTOCOL_PROBE]);
}

function filterDefined(candidates: readonly (string | undefined)[]): string[] {
  return candidates.filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
}

async function executableVersion(command: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { encoding: "utf8" });
    const output = `${stdout}${stderr}`.trim();
    return output.length === 0 ? null : output;
  } catch {
    return null;
  }
}

async function firstVersion(candidates: readonly string[], args: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const version = await executableVersion(candidate, args);
    if (version !== null) {
      return version;
    }
  }
  return null;
}

async function firstExecutable(candidates: readonly string[]): Promise<string | undefined> {
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      if (await executableVersion(path, ["--version"]) !== null) {
        return path;
      }
    }
  }
  return undefined;
}

async function firstReadable(candidates: readonly (string | undefined)[]): Promise<string | undefined> {
  for (const path of candidates) {
    if (path === undefined) {
      continue;
    }
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {
      // Continue looking at the next known path without changing the host.
    }
  }
  return undefined;
}
