import { isAbsolute, resolve } from "node:path";

export function resolveFixtureOutputDirectory(outputPath: string, invocationRoot: string): string {
  return isAbsolute(outputPath) ? resolve(outputPath) : resolve(invocationRoot, outputPath);
}
