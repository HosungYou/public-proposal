import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  EvidenceLedger,
  PageArchitectureManifest,
  ReferenceManifest,
  ReferenceRecord,
  ReferenceTarget,
} from "@longtable/kpp-schemas";
import { finding, result, type ValidationFinding, type ValidationResult } from "./page-architecture.js";
import { getDocumentModePolicy } from "./mode-policy.js";

export function validateReferenceManifest(
  manifest: ReferenceManifest,
  architecture: PageArchitectureManifest,
  evidence: EvidenceLedger,
): ValidationResult {
  const findings: ValidationFinding[] = [];
  if (
    manifest.projectId !== architecture.projectId
    || manifest.documentMode !== architecture.documentMode
    || manifest.modePolicyVersion !== architecture.modePolicyVersion
  ) {
    findings.push(finding(
      "KPP_REF_MODE_MISMATCH",
      "Reference and architecture manifest identities must match.",
      "manifest",
      identity(architecture),
      identity(manifest),
    ));
  }

  const policy = getDocumentModePolicy(manifest.documentMode);
  if (manifest.modePolicyVersion !== policy.modePolicyVersion) {
    findings.push(finding(
      "KPP_REF_MODE_MISMATCH",
      "Reference manifest policy version must be supported by the selected mode.",
      "manifest",
      policy.modePolicyVersion,
      manifest.modePolicyVersion,
    ));
  }

  const references = new Map<string, ReferenceRecord>();
  for (const reference of manifest.references) {
    if (references.has(reference.referenceId)) {
      findings.push(finding(
        "KPP_REF_DANGLING_ID",
        "Reference IDs must be unique.",
        `reference:${reference.referenceId}`,
        "unique referenceId",
        reference.referenceId,
      ));
    }
    references.set(reference.referenceId, reference);
    if (!policy.allowedReferenceClasses.includes(reference.referenceClass)) {
      findings.push(finding(
        "KPP_REF_CLASS_NOT_ALLOWED",
        "Reference class is not allowed by the selected mode policy.",
        `reference:${reference.referenceId}`,
        policy.allowedReferenceClasses,
        reference.referenceClass,
      ));
    }
    validateSource(reference, evidence, findings);
  }

  const declaredReferenceIds = new Set<string>();
  const targets = declaredTargets(architecture, evidence);
  for (const page of architecture.pages) {
    for (const referenceId of page.referenceIds) {
      declaredReferenceIds.add(referenceId);
      if (!references.has(referenceId)) {
        findings.push(finding(
          "KPP_REF_DANGLING_ID",
          "Architecture reference IDs must resolve to a manifest record.",
          `page:${page.pageId}/reference:${referenceId}`,
          "declared reference record",
          referenceId,
        ));
      }
    }
    validateIssuerOverride(page, references, manifest, policy, findings);
  }

  for (const reference of manifest.references) {
    if (!declaredReferenceIds.has(reference.referenceId)) {
      findings.push(finding(
        "KPP_REF_DANGLING_ID",
        "Reference records must be declared by at least one architecture page.",
        `reference:${reference.referenceId}`,
        "architecture page referenceIds",
        reference.referenceId,
      ));
    }
    for (const target of reference.targets) {
      if (!targets.has(targetKey(target))) {
        findings.push(finding(
          "KPP_REF_UNDECLARED_TARGET",
          "Reference targets must be declared by the architecture or evidence ledger.",
          `reference:${reference.referenceId}/target:${target.kind}:${target.id}`,
          "declared target",
          target,
        ));
      }
    }
  }
  return result(findings);
}

function validateSource(
  reference: ReferenceRecord,
  evidence: EvidenceLedger,
  findings: ValidationFinding[],
): void {
  const localPath = reference.sourcePath ?? reference.path;
  const expectedSha256 = reference.sourceSha256 ?? reference.sha256;
  const unavailable = reference.availability === "unavailable"
    || reference.verificationStatus === "unavailable";
  if (unavailable) {
    if (localPath !== undefined || expectedSha256 !== undefined) {
      findings.push(finding(
        "KPP_REF_UNAVAILABLE_SOURCE",
        "Unavailable references cannot claim local bytes or a byte hash.",
        `reference:${reference.referenceId}`,
        "URI-only unavailable declaration",
        { localPath, expectedSha256 },
      ));
    }
    return;
  }
  if (localPath !== undefined) {
    let actualSha256: string | undefined;
    try {
      const path = resolve(localPath);
      if (!statSync(path).isFile()) throw new Error("source is not a regular file");
      actualSha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    } catch (error) {
      findings.push(finding(
        "KPP_REF_STALE_HASH",
        "Local reference bytes must be readable and match the declared hash.",
        `reference:${reference.referenceId}`,
        expectedSha256,
        error instanceof Error ? error.message : error,
      ));
      return;
    }
    if (expectedSha256 === undefined || actualSha256 !== expectedSha256) {
      findings.push(finding(
        "KPP_REF_STALE_HASH",
        "Local reference bytes must match the declared hash.",
        `reference:${reference.referenceId}`,
        expectedSha256,
        actualSha256,
      ));
    }
  }

  const binding = evidence.bindings.find(({ evidenceId }) => evidenceId === reference.referenceId);
  if (binding !== undefined && (
    resolve(binding.sourcePath) !== (localPath === undefined ? undefined : resolve(localPath))
    || binding.sourceSha256 !== expectedSha256
  )) {
    findings.push(finding(
      "KPP_REF_STALE_HASH",
      "Reference records linked to evidence IDs must match the locked evidence binding.",
      `reference:${reference.referenceId}`,
      { sourcePath: resolve(binding.sourcePath), sourceSha256: binding.sourceSha256 },
      { sourcePath: localPath, sourceSha256: expectedSha256 },
    ));
  }
}

function validateIssuerOverride(
  page: PageArchitectureManifest["pages"][number],
  references: ReadonlyMap<string, ReferenceRecord>,
  manifest: ReferenceManifest,
  policy: ReturnType<typeof getDocumentModePolicy>,
  findings: ValidationFinding[],
): void {
  const override = page.issuerOverride;
  if (override === undefined) return;
  const validIdentity = override.documentMode === manifest.documentMode
    && override.modePolicyVersion === manifest.modePolicyVersion;
  const source = override.sourceId === undefined ? undefined : references.get(override.sourceId);
  const sourceValid = override.sourceId === undefined || (
    source !== undefined
    && page.referenceIds.includes(override.sourceId)
    && policy.issuerOverridePolicy.allowedReferenceClasses.includes(source.referenceClass)
    && source.verificationStatus === "verified"
  );
  const ruleValid = override.ruleId === undefined
    || policy.issuerOverridePolicy.allowedRuleIds.includes(override.ruleId);
  if (!validIdentity || !sourceValid || !ruleValid) {
    findings.push(finding(
      "KPP_REF_ISSUER_OVERRIDE_INVALID",
      "Issuer overrides must match the selected mode policy and identify verified issuer_rule authority.",
      `page:${page.pageId}/issuerOverride`,
      identity(manifest),
      override,
    ));
  }
}

function declaredTargets(
  architecture: PageArchitectureManifest,
  evidence: EvidenceLedger,
): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const page of architecture.pages) {
    targets.add(targetKey({ kind: "page", id: page.pageId }));
    for (const id of page.claimIds) targets.add(targetKey({ kind: "claim", id }));
    for (const id of page.proofIds) targets.add(targetKey({ kind: "proof", id }));
    for (const id of page.figureIds) targets.add(targetKey({ kind: "figure", id }));
    const extension = page as typeof page & { readonly tableIds?: readonly string[]; readonly quotationIds?: readonly string[] };
    for (const id of extension.tableIds ?? []) targets.add(targetKey({ kind: "table", id }));
    for (const id of extension.quotationIds ?? []) targets.add(targetKey({ kind: "quotation", id }));
  }
  for (const claim of evidence.claims) targets.add(targetKey({ kind: "claim", id: claim.claimId }));
  for (const binding of evidence.bindings) targets.add(targetKey({ kind: "proof", id: binding.evidenceId }));
  return targets;
}

function targetKey(target: ReferenceTarget): string {
  return `${target.kind}:${target.id}`;
}

function identity(value: { readonly projectId: string; readonly documentMode: string; readonly modePolicyVersion: string }) {
  return {
    projectId: value.projectId,
    documentMode: value.documentMode,
    modePolicyVersion: value.modePolicyVersion,
  };
}
