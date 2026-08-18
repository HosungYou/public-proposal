import { parseInstallManifest, type InstallManifest } from "./contracts.js";

export function serializeManifest(manifest: InstallManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function readManifestJson(contents: string): InstallManifest {
  return parseInstallManifest(JSON.parse(contents));
}

export function isProtectedPath(path: string): boolean {
  return path.includes("/.longtable") || path.endsWith("/.longtable") || path.includes("customer");
}
