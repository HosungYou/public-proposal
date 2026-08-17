import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = mkdtempSync(join(tmpdir(), "kpp-renderers-pack-"));
const packOutput = execFileSync(
  "npm",
  ["pack", "--json", "--pack-destination", tempRoot],
  { cwd: packageRoot, encoding: "utf8" },
);
const [packResult] = JSON.parse(packOutput);
const filePaths = packResult.files.map(({ path }) => path);
const requiredFiles = ["dist/index.js", "dist/index.d.ts", "package.json"];
const forbiddenPrefixes = ["src/", "test/", "scripts/", ".omo/"];
const cleanBoundary = requiredFiles.every((path) => filePaths.includes(path))
  && forbiddenPrefixes.every((prefix) => filePaths.every((path) => !path.startsWith(prefix)));

if (!cleanBoundary) {
  throw new Error(`Renderer tarball boundary mismatch: ${JSON.stringify(filePaths)}`);
}

writeFileSync(join(tempRoot, "package.json"), '{"private":true}\n', "utf8");
execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(tempRoot, packResult.filename)], {
  cwd: tempRoot,
  stdio: "pipe",
});
execFileSync(
  process.execPath,
  ["--input-type=module", "--eval", "const m=await import('@kpp/renderers'); if(typeof m.renderFigureArtifact!=='function') process.exit(2);"],
  { cwd: tempRoot, encoding: "utf8" },
);
process.stdout.write(`${JSON.stringify({ importable: true, cleanBoundary: true, files: filePaths })}\n`);
