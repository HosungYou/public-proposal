import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createPackageVersionResolver } from "../src/package-version.js";

test("resolves a sibling dependency package.json in a scoped npx tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "public-proposal-package-version-"));
  const packageRoot = join(root, "node_modules", "@fixture", "consumer");
  const dependencyRoot = join(root, "node_modules", "@fixture", "no-main");
  try {
    await mkdir(packageRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@fixture/consumer" }));
    await writeFile(
      join(dependencyRoot, "package.json"),
      JSON.stringify({ name: "@fixture/no-main", version: "9.8.7", bin: { noMain: "dist/main.js" } }),
    );

    const resolveVersion = createPackageVersionResolver(packageRoot, (path) => readFile(path, "utf8"));

    await expect(resolveVersion("@fixture/no-main")).resolves.toBe("9.8.7");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
