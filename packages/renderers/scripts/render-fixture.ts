import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderFigureArtifact } from "../src/index.js";
import { ganttFixture } from "../test/fixtures.js";
import { resolveFixtureOutputDirectory } from "./paths.js";

const invocationRoot = process.env.INIT_CWD ?? process.cwd();
const outputDirectory = resolveFixtureOutputDirectory(
  process.argv[2] ?? ".omo/evidence/document-pipeline-task-3-fix-artifacts",
  invocationRoot,
);
const artifact = await renderFigureArtifact(ganttFixture);

await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "FIG-GANTT-001.svg"), artifact.svg, "utf8");
await writeFile(
  resolve(outputDirectory, "FIG-GANTT-001.figure-manifest.json"),
  `${JSON.stringify(artifact.manifest, null, 2)}\n`,
  "utf8",
);

process.stdout.write(`${JSON.stringify({
  fixture: "packages/renderers/test/fixtures.ts#ganttFixture",
  figureId: artifact.manifest.figure.id,
  inputSha256: artifact.manifest.input.sha256,
  svgSha256: artifact.manifest.output.sha256,
  outputDirectory,
})}\n`);
