import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const checkout = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
if (!checkout || !output) {
  throw new Error("usage: node scripts/generate_hwpx_engine_manifest.mjs CHECKOUT OUTPUT");
}

const { stdout: commitOutput } = await run("git", ["rev-parse", "HEAD"], { cwd: checkout });
const commit = commitOutput.trim();
if (commit !== "96a2633f23a08f707679d7e212ebdc59948260e6") {
  throw new Error(`unexpected HWPX commit ${commit}`);
}
const { stdout: filesOutput } = await run("git", ["ls-files", "-z"], { cwd: checkout, encoding: "buffer" });
const sourceFiles = filesOutput.toString("utf8").split("\0").filter(Boolean).filter((path) => path !== ".gitignore");
const files = [];
for (const source of sourceFiles.sort()) {
  const payload = await readFile(join(checkout, ...source.split("/")));
  const destination = source === "SKILL.md" ? "UPSTREAM-SKILL.md" : posix.normalize(source);
  files.push({
    source,
    destination,
    bytes: payload.byteLength,
    sha256: createHash("sha256").update(payload).digest("hex"),
  });
}

const manifest = {
  schemaVersion: "1.0.0",
  repository: "https://github.com/jkf87/hwpx-skill.git",
  commit,
  destinationRoot: "vendor/hwpx-skill",
  distributionMode: "fetched-from-upstream-not-redistributed",
  licenseStatus: "no-root-license-file-in-pinned-tree",
  files,
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
