import { join } from "node:path";

export type InstallScope = "user" | "project";

export function installationRoot(scope: InstallScope, cwd: string, home: string): string {
  if (scope === "project") {
    return join(cwd, ".public-proposal");
  }
  return join(home, ".config", "public-proposal");
}

export function manifestPath(installRoot: string): string {
  return join(installRoot, "installation.json");
}

export function manifestTempPath(installRoot: string): string {
  return join(installRoot, "installation.json.tmp");
}
