import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const candidates: Record<string, readonly string[]> = {
  soffice: [
    process.env.KPP_SOFFICE_PATH ?? "",
    "/opt/homebrew/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "soffice",
    "libreoffice",
  ],
  pdftoppm: [process.env.KPP_PDFTOPPM_PATH ?? "", "/opt/homebrew/bin/pdftoppm", "/usr/bin/pdftoppm", "/usr/local/bin/pdftoppm", "pdftoppm"],
  pdftotext: [process.env.KPP_PDFTOTEXT_PATH ?? "", "/opt/homebrew/bin/pdftotext", "/usr/bin/pdftotext", "/usr/local/bin/pdftotext", "pdftotext"],
  pdfinfo: [process.env.KPP_PDFINFO_PATH ?? "", "/opt/homebrew/bin/pdfinfo", "/usr/bin/pdfinfo", "/usr/local/bin/pdfinfo", "pdfinfo"],
};

/** Resolve an installed rendering tool without assuming the host OS layout. */
export async function resolveTool(name: keyof typeof candidates): Promise<string> {
  for (const candidate of candidates[name]) {
    if (candidate.length === 0) continue;
    if (isAbsolute(candidate)) {
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
    try {
      const command = process.platform === "win32" ? "where" : "which";
      const result = await execFileAsync(command, [candidate], { encoding: "utf8" });
      const resolved = result.stdout.trim().split(/\r?\n/u)[0];
      if (resolved) return resolved;
    } catch {
      continue;
    }
  }
  throw new Error(`Rendering tool '${name}' is not installed; tried ${candidates[name].filter(Boolean).join(", ")}`);
}
