import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("the public proposal plugin exposes both orchestration and Korean authority skills", async () => {
  const manifest = JSON.parse(await readFile(".agents/plugins/marketplace.json", "utf8")) as {
    plugins: Array<{ name: string; source: { path: string } }>;
  };

  expect(manifest.plugins).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "public-proposal",
        source: { path: "./plugins/public-proposal" },
      }),
    ]),
  );
  await expect(readFile("plugins/public-proposal/skills/public-proposal/SKILL.md", "utf8")).resolves.toContain(
    "$public-proposal",
  );
  await expect(
    readFile("plugins/public-proposal/skills/korean-public-proposal/SKILL.md", "utf8"),
  ).resolves.toContain("Authority order");
});
