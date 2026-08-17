import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RfpCandidatesFileSchema } from "@kpp/schemas";
import {
  extractRequirementCandidates,
  extractTextDocument,
  writeRequirementCandidates,
} from "../src/rfp-candidates.js";

describe("RFP requirement candidate extraction", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ));
  });

  it("extracts reviewable page-linked requirements as pending from a local RFP text fixture", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "kpp-rfp-candidates-"));
    temporaryDirectories.push(fixtureDirectory);
    const rfpPath = join(fixtureDirectory, "issuer-rfp.txt");
    const pageSeventeen = [
      "제안서 작성 분량은 표지 및 간지를 제외하고 50쪽 이내로 한다.",
      "제안서는 A4 용지 세로 방향으로 작성한다.",
      "본문 글꼴은 맑은 고딕 12pt로 작성한다.",
      "제출 마감일시는 2026. 8. 31. 18:00까지이다.",
      "제안서 본문에는 회사명과 상호를 기재할 수 없다.",
      "별지 제1호 서식을 작성하여 제출한다.",
    ].join("\n");
    const fixtureText = `${"앞면\f".repeat(16)}${pageSeventeen}\n`;
    await writeFile(rfpPath, fixtureText, "utf8");

    const candidates = await extractRequirementCandidates(rfpPath);

    expect(candidates).toHaveLength(6);
    expect(candidates.map(({ category }) => category)).toEqual([
      "page_limit",
      "format",
      "font",
      "deadline",
      "anonymity",
      "required_form",
    ]);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "page_limit",
        sourceLocator: "page:17",
        extractedText: "제안서 작성 분량은 표지 및 간지를 제외하고 50쪽 이내로 한다.",
        status: "pending",
      }),
    ]));
    expect(candidates.every((candidate) => candidate.status === "pending")).toBe(true);
    expect(candidates.every((candidate) => candidate.confidence > 0 && candidate.confidence < 1)).toBe(true);
    expect(candidates.every((candidate) => candidate.sourceSha256 === createHash("sha256")
      .update(fixtureText, "utf8").digest("hex"))).toBe(true);
  });

  it("persists a schema-valid candidates file without confirming any extracted rule", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "kpp-rfp-output-"));
    temporaryDirectories.push(fixtureDirectory);
    const rfpPath = join(fixtureDirectory, "issuer-rfp.txt");
    const projectRoot = join(fixtureDirectory, "proposal-project");
    await writeFile(rfpPath, "제안서 분량은 20쪽 이내로 한다.\n", "utf8");

    const output = await writeRequirementCandidates(projectRoot, rfpPath);
    const persisted = JSON.parse(await readFile(output, "utf8")) as unknown;

    expect(output).toBe(join(projectRoot, "requirements", "candidates.json"));
    expect(RfpCandidatesFileSchema.parse(persisted)).toMatchObject({
      schemaVersion: "1.0.0",
      candidates: [expect.objectContaining({
        category: "page_limit",
        sourceLocator: "section:1",
        status: "pending",
      })],
    });
  });

  it("uses argument arrays for the PDF adapter and preserves its page locator", async () => {
    const seen: Array<{ command: string; args: readonly string[] }> = [];

    const document = await extractTextDocument("/tmp/RFP name; unsafe.pdf", {
      run: async (command, args) => {
        seen.push({ command, args });
        return "first page\f제안서 분량은 30쪽 이내로 한다.";
      },
    });

    expect(seen).toEqual([{
      command: "pdftotext",
      args: ["-layout", "/tmp/RFP name; unsafe.pdf", "-"],
    }]);
    expect(document.pages).toEqual([
      { sourceLocator: "page:1", text: "first page" },
      { sourceLocator: "page:2", text: "제안서 분량은 30쪽 이내로 한다." },
    ]);
  });
});
