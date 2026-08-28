import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { verifyReleaseAuditReceipt } from "../src/commands/release.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release audit receipt boundary", () => {
  test("rejects a free-form technical PASS file", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpp-cli-release-audit-"));
    roots.push(root);
    await mkdir(join(root, "audit"));
    const auditPath = join(root, "audit", "audit.json");
    await writeFile(auditPath, JSON.stringify({ status: "PASS", humanBoundary: "TECHNICAL_GATE_ONLY" }));

    await expect(verifyReleaseAuditReceipt(root, auditPath, {
      projectId: "release-fixture",
      documentMode: "private_partnership",
      modePolicyVersion: "1.0.0",
    })).rejects.toMatchObject({ code: "KPP_RELEASE_AUDIT_INVALID" });
  });

  test("rejects the legacy v1 flat PASS report instead of silently upgrading it", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpp-cli-release-v1-audit-"));
    roots.push(root);
    await mkdir(join(root, "audit"));
    const auditPath = join(root, "audit", "audit.json");
    await writeFile(auditPath, JSON.stringify({
      schemaVersion: "1",
      status: "PASS",
      findings: [],
      artifacts: [],
      humanBoundary: "TECHNICAL_GATE_ONLY",
    }));

    await expect(verifyReleaseAuditReceipt(root, auditPath, {
      projectId: "release-fixture",
      documentMode: "private_partnership",
      modePolicyVersion: "1.0.0",
    })).rejects.toMatchObject({ code: "KPP_RELEASE_AUDIT_INVALID" });
  });
});
