import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../apps/kpp-cli/src/main.js";

describe("kpp adopt CLI", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("accepts explicit source and master paths and emits a JSON adoption report", async () => {
    const legacyRoot = await temporaryRoot("kpp-adopt-cli-");
    const source = join(legacyRoot, "source-packet");
    const master = join(legacyRoot, "proposal-final.docx");
    await mkdir(source);
    await writeFile(join(source, "공고문.pdf"), "source", "utf8");
    await writeFile(master, "master", "utf8");

    const lines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      expect(await runCli(["adopt", legacyRoot, "--source", source, "--master", master, "--json"])).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }

    const envelope = JSON.parse(lines.join("")) as { ok: boolean; data: { state: string; projectRoot: string } };
    expect(envelope).toMatchObject({ ok: true, data: { state: "UNMANAGED_DRAFT", projectRoot: legacyRoot } });
    expect(await readFile(join(legacyRoot, "kpp.project.yaml"), "utf8")).toContain("state: UNMANAGED_DRAFT");
  });

  async function temporaryRoot(prefix: string): Promise<string> {
    const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    roots.push(root);
    return root;
  }
});
