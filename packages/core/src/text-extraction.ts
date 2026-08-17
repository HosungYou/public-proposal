import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { KppError } from "./errors.js";

export interface ExtractedTextPage {
  readonly sourceLocator: string;
  readonly text: string;
}

export interface ExtractedTextDocument {
  readonly sourcePath: string;
  readonly pages: readonly ExtractedTextPage[];
}

export type TextExtractionRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

export interface TextExtractionOptions {
  readonly run?: TextExtractionRunner;
}

export async function extractTextDocument(
  sourcePath: string,
  options: TextExtractionOptions = {},
): Promise<ExtractedTextDocument> {
  const normalizedSourcePath = resolve(sourcePath);
  const extension = extname(normalizedSourcePath).toLowerCase();
  let text: string;
  let locatorKind: "page" | "section";

  if (isPlainTextExtension(extension)) {
    try {
      text = await readFile(normalizedSourcePath, "utf8");
    } catch (error) {
      throw new KppError("KPP_INPUT_SOURCE_READ", "RFP 원문을 읽을 수 없습니다.", {
        path: normalizedSourcePath,
        actual: error instanceof Error ? error.message : error,
      });
    }
    locatorKind = text.includes("\f") ? "page" : "section";
  } else if (extension === ".pdf") {
    text = await (options.run ?? runTextExtractionCommand)("pdftotext", ["-layout", normalizedSourcePath, "-"]);
    locatorKind = "page";
  } else if (extension === ".docx") {
    text = await (options.run ?? runTextExtractionCommand)("textutil", ["-convert", "txt", "-stdout", normalizedSourcePath]);
    locatorKind = text.includes("\f") ? "page" : "section";
  } else {
    throw new KppError("KPP_INPUT_SOURCE_UNSUPPORTED", "지원하지 않는 RFP 원본 형식입니다.", {
      path: normalizedSourcePath,
      actual: extension || "no extension",
    });
  }

  return {
    sourcePath: normalizedSourcePath,
    pages: textToPages(text, locatorKind),
  };
}

function isPlainTextExtension(extension: string): boolean {
  return extension === ".txt" || extension === ".text" || extension === ".md";
}

function textToPages(text: string, locatorKind: "page" | "section"): readonly ExtractedTextPage[] {
  const parts = text.replace(/\r\n/g, "\n").split("\f");
  return parts.map((part, index) => ({
    sourceLocator: `${locatorKind}:${index + 1}`,
    text: part.trim(),
  })).filter(({ text }) => text.length > 0);
}

function runTextExtractionCommand(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => reject(new KppError(
      "KPP_INPUT_TEXT_EXTRACTOR",
      "RFP 텍스트 추출기를 실행할 수 없습니다.",
      { actual: error.message },
    )));
    child.once("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(new KppError("KPP_INPUT_TEXT_EXTRACTOR", "RFP 텍스트 추출에 실패했습니다.", {
        actual: { command, code, stderr: Buffer.concat(stderr).toString("utf8") },
      }));
    });
  });
}
