import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  materializePharmacyPartnership,
  runPharmacyBuildRenderAudit,
  type PharmacyFixtureVariant,
} from "./pharmacy-fixture.js";

const outputRoot = resolve(process.argv[2] ?? ".superpowers/sdd/2026-08-20-kpp-vnext-document-architecture/evidence/pharmacy-negative-evidence");
await mkdir(outputRoot, { recursive: true });
const results: Record<string, unknown> = {};

for (const variant of ["oversized_title", "repeated_topology", "decorative_evidence"] as const satisfies readonly PharmacyFixtureVariant[]) {
  const fixture = await materializePharmacyPartnership(variant, join(outputRoot, variant));
  try {
    const run = await runPharmacyBuildRenderAudit(fixture);
    results[variant] = {
      state: run.audit.state,
      status: run.audit.report.status,
      findingCodes: run.audit.report.findings.map(({ code }) => code),
      auditPath: run.audit.auditPath,
    };
  } catch (error) {
    results[variant] = {
      rejected: true,
      code: typeof error === "object" && error !== null && "code" in error ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const reportPath = join(outputRoot, "negative-report.json");
await writeFile(reportPath, `${JSON.stringify({ schemaVersion: "1.0.0", results }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reportPath, results }));
