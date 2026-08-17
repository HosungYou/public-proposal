import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

describe("renderer package boundary", () => {
  it("packs and imports a clean install without source or evidence files", () => {
    const output = execFileSync(process.execPath, ["scripts/verify-pack.mjs"], {
      cwd: packageRoot,
      encoding: "utf8",
    });

    expect(JSON.parse(output)).toMatchObject({ importable: true, cleanBoundary: true });
  }, 30_000);
});
