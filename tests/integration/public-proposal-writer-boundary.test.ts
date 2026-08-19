import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PUBLIC_PROPOSAL_SOURCE_DIRECTORY = fileURLToPath(
  new URL("../../apps/public-proposal-cli/src/", import.meta.url),
);

describe("Public Proposal writer ownership boundary", () => {
  it("keeps canonical KPP receipt and project-content writes out of Public Proposal source", async () => {
    const sourceFiles = (await readdir(PUBLIC_PROPOSAL_SOURCE_DIRECTORY, { recursive: true }))
      .filter((relativePath) => relativePath.endsWith(".ts"));
    const source = (await Promise.all(sourceFiles.map(async (relativePath) => (
      `// ${relativePath}\n${await readFile(join(PUBLIC_PROPOSAL_SOURCE_DIRECTORY, relativePath), "utf8")}`
    )))).join("\n");

    expect(source).not.toMatch(/\bwriteReceipt\b/);
    expect(source).not.toMatch(/(?:section-plan|agent-execution-state|agent-execution-integrity|representative-review|representative-approval|full-authoring-request)\.json/);
    expect(source).not.toContain("writeJsonAtomically");
  });
});
