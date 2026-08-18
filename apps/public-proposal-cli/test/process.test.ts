import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runProcess } from "../src/process.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("passes process cwd and environment options to the child process", async () => {
  const root = await mkdtemp(join(tmpdir(), "public-proposal-process-"));
  temporaryRoots.push(root);
  const canonicalRoot = await realpath(root);

  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write(`${process.cwd()}|${process.env.PUBLIC_PROPOSAL_PROCESS_TEST}`)"],
    { cwd: root, env: { ...process.env, PUBLIC_PROPOSAL_PROCESS_TEST: "propagated" } },
  );

  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`${canonicalRoot}|propagated`);
});
