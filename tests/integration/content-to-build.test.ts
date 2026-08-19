import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

let core: typeof import("@longtable/kpp-core");

interface ContentFixtureResult {
  readonly state: string;
  readonly blockers: readonly unknown[];
  readonly root: string;
  readonly researchBundleHash?: string;
  readonly candidates: {
    readonly candidates: readonly {
      readonly candidateId: string;
      readonly sourcePath: string;
      readonly sourceSha256: string;
      readonly sourceLocator: string;
    }[];
  };
  readonly requirements: {
    readonly requirements: readonly {
      readonly requirementId: string;
      readonly sourceCandidateIds?: readonly string[];
    }[];
  };
  readonly complianceMatrix: {
    readonly rows: readonly {
      readonly candidateId: string;
      readonly sourceLocator: string;
      readonly sourceSha256: string;
      readonly sourceAuthority: string;
      readonly targetRequirementIds: readonly string[];
      readonly targetPageIds: readonly string[];
      readonly targetPageRoles: readonly string[];
      readonly decidedBy: string;
    }[];
  };
  readonly decisionLedger: {
    readonly decisions: readonly {
      readonly candidateId: string;
      readonly sourceLocator: string;
      readonly sourceSha256: string;
      readonly sourceAuthority: string;
      readonly decidedBy: string;
    }[];
  };
  readonly pagePlan: {
    readonly pages: readonly {
      readonly figureSpecs: readonly { readonly family: string; readonly renderer: string }[];
    }[];
  };
  readonly evidenceLedger: {
    readonly claims: readonly { readonly claimId: string; readonly status: string }[];
  };
  readonly designProfile: {
    readonly figurePolicy: {
      readonly gantt: { readonly requiredStructure: readonly string[] };
      readonly raci: { readonly renderer: string };
    };
    readonly imageGeneration: {
      readonly directFinalUse: boolean;
      readonly evidenceBearingFiguresAllowed: boolean;
    };
  };
  readonly pendingBlankRegister: {
    readonly entries: readonly {
      readonly claimId: string;
      readonly status: string;
      readonly disposition: string;
    }[];
  };
  readonly finalResponse: {
    readonly blocks: readonly {
      readonly pageId: string;
      readonly claimIds: readonly string[];
      readonly pendingBlankFieldIds: readonly string[];
      readonly text: string;
    }[];
  };
}

describe("content-to-build integration fixture", () => {
  const temporaryDirectories: string[] = [];

  beforeAll(async () => {
    expect(await runProcess("npm", ["run", "build"])).toMatchObject({ code: 0, stderr: "" });
    core = await import("@longtable/kpp-core");
  });

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ));
  });

  it("advances a sourced research proposal to CONTENT_APPROVED", async () => {
    const result = await runContentFixture("fixtures/valid/minimal-research-proposal", temporaryDirectories);

    expect(result.state).toBe("CONTENT_APPROVED");
    expect(result.blockers).toEqual([]);
    expect(result.candidates.candidates).toEqual([
      expect.objectContaining({
        candidateId: "CAND-PAGE-LIMIT-001",
        sourcePath: join(result.root, "..", "fixture", "issuer-rfp.txt"),
        sourceSha256: "48bbad3126f72ffe754f12a85d96021343437b552276fd74d28c5c1a3edfe615",
        sourceLocator: "section:1",
      }),
      expect.objectContaining({
        candidateId: "CAND-METHOD-001",
        sourcePath: join(result.root, "..", "fixture", "issuer-rfp.txt"),
        sourceSha256: "48bbad3126f72ffe754f12a85d96021343437b552276fd74d28c5c1a3edfe615",
        sourceLocator: "section:2",
      }),
    ]);
    expect(result.requirements.requirements).toEqual([
      expect.objectContaining({
        requirementId: "REQ-RESEARCH-METHOD",
        sourceCandidateIds: ["CAND-PAGE-LIMIT-001", "CAND-METHOD-001"],
      }),
      expect.objectContaining({ requirementId: "REQ-OPTIONAL-INPUT" }),
    ]);
    expect(result.complianceMatrix.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidateId: "CAND-PAGE-LIMIT-001",
        sourceLocator: "section:1",
        sourceSha256: "48bbad3126f72ffe754f12a85d96021343437b552276fd74d28c5c1a3edfe615",
        sourceAuthority: "issuer",
        targetRequirementIds: ["REQ-RESEARCH-METHOD"],
        targetPageIds: ["PAGE-001"],
        targetPageRoles: ["research_method"],
        decidedBy: "synthetic-proposal-owner",
      }),
      expect.objectContaining({
        candidateId: "CAND-METHOD-001",
        sourceLocator: "section:2",
        sourceSha256: "48bbad3126f72ffe754f12a85d96021343437b552276fd74d28c5c1a3edfe615",
        sourceAuthority: "issuer",
        targetRequirementIds: ["REQ-RESEARCH-METHOD"],
        targetPageIds: ["PAGE-001"],
        targetPageRoles: ["research_method"],
        decidedBy: "synthetic-proposal-owner",
      }),
    ]));
    expect(result.decisionLedger.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidateId: "CAND-PAGE-LIMIT-001",
        sourceLocator: "section:1",
        sourceSha256: "48bbad3126f72ffe754f12a85d96021343437b552276fd74d28c5c1a3edfe615",
        sourceAuthority: "issuer",
        decidedBy: "synthetic-proposal-owner",
      }),
      expect.objectContaining({
        candidateId: "CAND-METHOD-001",
        sourceLocator: "section:2",
        sourceSha256: "48bbad3126f72ffe754f12a85d96021343437b552276fd74d28c5c1a3edfe615",
        sourceAuthority: "issuer",
        decidedBy: "synthetic-proposal-owner",
      }),
    ]));
    expect(result.evidenceLedger.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimId: "CLAIM-METHOD", status: "bounded" }),
      expect.objectContaining({ claimId: "CLAIM-OPTIONAL", status: "pending_blank" }),
    ]));
    expect(result.pendingBlankRegister.entries).toEqual([
      expect.objectContaining({
        claimId: "CLAIM-OPTIONAL",
        status: "pending_blank",
        disposition: "removed_before_content_approval",
      }),
    ]);
    expect(result.finalResponse.blocks.map(({ pageId, claimIds, pendingBlankFieldIds }) => ({
      pageId,
      claimIds,
      pendingBlankFieldIds,
    }))).toEqual([
      { pageId: "PAGE-001", claimIds: ["CLAIM-METHOD"], pendingBlankFieldIds: [] },
      { pageId: "PAGE-002", claimIds: ["CLAIM-OPTIONAL"], pendingBlankFieldIds: [] },
    ]);
    for (const block of result.finalResponse.blocks) {
      expect(block.pendingBlankFieldIds).toEqual([]);
      expect(block.text).not.toContain("{{");
      expect(block.text).not.toMatch(/\b(?:TBD|TO\s*BE\s*DECIDED)\b/iu);
      expect(block.text).not.toMatch(/\[(?:작성|입력|추후)[^\]]*\]|추후\s*입력|입력\s*필요|미정/u);
    }

    const figures = result.pagePlan.pages.flatMap(({ figureSpecs }) => figureSpecs);
    expect(figures).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: "gantt", renderer: "svg-gantt" }),
      expect.objectContaining({ family: "raci", renderer: "word-native-raci-table" }),
    ]));
    expect(result.designProfile.figurePolicy.gantt.requiredStructure).toEqual([
      "time_axis",
      "work_package_rows",
      "duration_bars",
      "milestones",
    ]);
    expect(result.designProfile.figurePolicy.raci.renderer).toBe("word-native-raci-table");
    expect(result.designProfile.imageGeneration).toEqual({
      directFinalUse: false,
      evidenceBearingFiguresAllowed: false,
    });

    for (const receiptName of [
      "source-lock.json",
      "requirements-lock.json",
      "evidence-lock.json",
      "design-lock.json",
      "content-approval.json",
    ]) {
      expect((await core.verifyReceipt(join(result.root, "receipts", receiptName))).valid).toBe(true);
    }
    const contentApproval = await core.verifyReceipt(join(result.root, "receipts", "content-approval.json"));
    expect(contentApproval.receipt.inputReceiptHashes).toContain(
      await core.sha256File(join(result.root, "receipts", "research-lock.json")),
    );
    const researchReceipt = await core.verifyReceipt(join(result.root, "receipts", "research-lock.json"));
    expect(researchReceipt.receipt.inputReceiptHashes).toContain(result.researchBundleHash);
  });

  it("allows general procurement content approval without LongTable", async () => {
    const result = await runContentFixture(
      "fixtures/valid/minimal-research-proposal",
      temporaryDirectories,
      { proposalClass: "general_procurement", academicEvidence: false },
    );

    expect(result.state).toBe("CONTENT_APPROVED");
    await expect(readFile(join(result.root, "receipts", "research-lock.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows general procurement with an academic evidence slot after a valid LongTable lock", async () => {
    const result = await runContentFixture(
      "fixtures/valid/minimal-research-proposal",
      temporaryDirectories,
      { proposalClass: "general_procurement", academicEvidence: true },
    );

    expect(result.state).toBe("CONTENT_APPROVED");
    const researchReceiptPath = join(result.root, "receipts", "research-lock.json");
    expect((await core.verifyReceipt(researchReceiptPath)).valid).toBe(true);
    const contentApproval = await core.verifyReceipt(join(result.root, "receipts", "content-approval.json"));
    expect(contentApproval.receipt.inputReceiptHashes).toContain(
      await core.sha256File(researchReceiptPath),
    );
    const researchReceipt = await core.verifyReceipt(researchReceiptPath);
    expect(researchReceipt.receipt.inputReceiptHashes).toContain(result.researchBundleHash);
  });
});

async function runContentFixture(
  fixtureInput: string,
  temporaryDirectories: string[],
  options: {
    readonly proposalClass?: "research_service" | "general_procurement";
    readonly academicEvidence?: boolean;
  } = {},
): Promise<ContentFixtureResult> {
  const fixtureSource = resolve(fixtureInput);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kpp-content-to-build-"));
  temporaryDirectories.push(temporaryDirectory);
  const fixture = join(temporaryDirectory, "fixture");
  const root = join(temporaryDirectory, "proposal-project");
  await cp(fixtureSource, fixture, { recursive: true, force: false });

  const rfpPath = join(fixture, "issuer-rfp.txt");
  const candidatesTemplatePath = join(fixture, "candidates-template.json");
  const decisionsTemplatePath = join(fixture, "requirement-decisions-template.json");
  const candidatesPath = join(fixture, "candidates.json");
  const decisionsPath = join(fixture, "requirement-decisions.json");
  const evidencePath = join(fixture, "evidence", "method-evidence.txt");
  const issuerProfilePath = join(fixture, "issuer-profile.json");
  const terminologyPath = join(fixture, "terminology.json");
  const finalResponsePath = join(fixture, "content", "authoring-response-final.json");
  const designProfilePath = join(fixture, "figures", "design-profile.json");
  const pendingBlankRegisterPath = join(fixture, "content", "pending-blank-register.json");

  const proposalClass = options.proposalClass ?? "research_service";
  expect(await runCli([
    "init",
    root,
    "--project-id",
    "synthetic-research-proposal",
    "--proposal-class",
    proposalClass,
    "--json",
  ])).toMatchObject({ code: 0, stderr: "" });
  expect(await runCli(["ingest", root, rfpPath, "--json"])).toMatchObject({ code: 0, stderr: "" });
  const candidates = await materializeTemplate<ContentFixtureResult["candidates"]>(candidatesTemplatePath, candidatesPath, {
    "__ISSUER_RFP_PATH__": rfpPath,
  });
  const decisions = await materializeTemplate<Record<string, unknown>>(decisionsTemplatePath, decisionsPath, {
    "__METHOD_EVIDENCE_PATH__": evidencePath,
  });
  if (options.academicEvidence !== undefined) {
    const requirementRecord = decisions.requirements as {
      requirements: Array<{ pageRole: string }>;
      evidenceBindings: Array<{ targetPageRole: string }>;
    };
    const pageRole = options.academicEvidence ? "academic_evidence" : "qualification_evidence";
    requirementRecord.requirements[0]!.pageRole = pageRole;
    requirementRecord.evidenceBindings[0]!.targetPageRole = pageRole;
    await writeFile(decisionsPath, `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
  }
  const issuerSourceSha256 = await core.sha256File(rfpPath);
  expect(candidates.candidates).toHaveLength(2);
  for (const candidate of candidates.candidates) {
    expect(candidate.sourcePath).toBe(rfpPath);
    expect(candidate.sourceSha256).toBe(issuerSourceSha256);
  }
  const requirementsLock = await runCli([
    "requirements",
    root,
    "--candidates",
    candidatesPath,
    "--decisions",
    decisionsPath,
    "--json",
  ]);
  expect(requirementsLock).toMatchObject({ code: 0, stderr: "" });
  expect(parseEnvelope(requirementsLock.stdout)).toMatchObject({
    ok: true,
    data: { state: "REQUIREMENTS_LOCKED" },
  });
  const requirementsPath = join(root, "requirements", "requirements.json");
  expect(await runCli(["plan", root, "--requirements", requirementsPath, "--json"])).toMatchObject({ code: 0, stderr: "" });

  const researchBundleHash = proposalClass === "research_service" || options.academicEvidence === true
    ? await createResearchBundleLock(root, proposalClass, fixture)
    : undefined;

  const issuerProfile = JSON.parse(await readFile(issuerProfilePath, "utf8")) as unknown;
  const terminology = JSON.parse(await readFile(terminologyPath, "utf8")) as unknown;
  await core.exportAuthoring(root, {
    issuerProfile: { path: issuerProfilePath, value: issuerProfile },
    terminology: { path: terminologyPath, value: terminology },
  });
  const finalResponse = JSON.parse(await readFile(finalResponsePath, "utf8")) as unknown;
  await core.importAuthoring(root, finalResponse);

  const installedDesignProfilePath = join(root, "figures", "design-profile.json");
  await cp(designProfilePath, installedDesignProfilePath, { force: false });
  const pagePlanPath = join(root, "content", "page-plan.json");
  await core.writeReceipt({
    stage: "DESIGN_LOCKED",
    files: [installedDesignProfilePath, pagePlanPath],
    inputReceiptHashes: [await core.sha256File(join(root, "receipts", "evidence-lock.json"))],
    output: join(root, "receipts", "design-lock.json"),
  });
  await core.advanceProject(root, "DESIGN_LOCKED");

  const approval = await runCli([
    "content-approve",
    root,
    "--approved-by",
    "synthetic-proposal-owner",
    "--json",
  ]);
  expect(approval).toMatchObject({ code: 0, stderr: "" });
  const approvalEnvelope = parseEnvelope(approval.stdout);
  expect(approvalEnvelope).toMatchObject({ ok: true, code: "KPP_OK", data: { state: "CONTENT_APPROVED" } });
  const approvalData = approvalEnvelope.data as {
    readonly state?: string;
    readonly findings?: { readonly blockers?: readonly unknown[] };
  };

  return {
    state: approvalData.state ?? "UNKNOWN",
    blockers: approvalData.findings?.blockers ?? [],
    root,
    ...(researchBundleHash === undefined ? {} : { researchBundleHash }),
    candidates,
    requirements: JSON.parse(await readFile(requirementsPath, "utf8")) as ContentFixtureResult["requirements"],
    complianceMatrix: JSON.parse(await readFile(join(root, "requirements", "compliance-matrix.json"), "utf8")) as ContentFixtureResult["complianceMatrix"],
    decisionLedger: JSON.parse(await readFile(join(root, "requirements", "decision-ledger.json"), "utf8")) as ContentFixtureResult["decisionLedger"],
    pagePlan: JSON.parse(await readFile(pagePlanPath, "utf8")) as ContentFixtureResult["pagePlan"],
    evidenceLedger: JSON.parse(await readFile(join(root, "evidence", "evidence-ledger.json"), "utf8")) as ContentFixtureResult["evidenceLedger"],
    designProfile: JSON.parse(await readFile(installedDesignProfilePath, "utf8")) as ContentFixtureResult["designProfile"],
    pendingBlankRegister: JSON.parse(await readFile(pendingBlankRegisterPath, "utf8")) as ContentFixtureResult["pendingBlankRegister"],
    finalResponse: finalResponse as ContentFixtureResult["finalResponse"],
  };
}

async function createResearchBundleLock(
  root: string,
  proposalClass: "research_service" | "general_procurement",
  fixture: string,
): Promise<string> {
  const requestOptionsPath = join(fixture, "research-request-options.json");
  await writeFile(requestOptionsPath, `${JSON.stringify({
    institution: {
      canonicalName: "합성 연구기관",
      aliases: [],
      identifiers: { alio: "SYNTHETIC-INSTITUTION" },
    },
    questions: [{
      questionId: "QUESTION-METHOD",
      text: "연구 수행방법은 어떤 근거로 구성되는가?",
      requiredDataFieldIds: ["FIELD-METHOD"],
    }],
    requiredData: [{
      fieldId: "FIELD-METHOD",
      definition: "연구 수행방법 근거",
      period: "2026",
      unit: "method",
      grain: "requirement",
      required: true,
      allowedSourceClasses: ["institution_official"],
      targetClaimIds: ["CLAIM-METHOD"],
      targetFigureIds: ["FIG-SCHEDULE-001"],
    }],
    privacyClass: "PUBLIC",
    academicEvidence: true,
  }, null, 2)}\n`, "utf8");
  const requestResult = await runCli([
    "research-request",
    root,
    "--requirements",
    requestOptionsPath,
    "--json",
  ]);
  expect(requestResult).toMatchObject({ code: 0, stderr: "" });
  const requestEnvelope = parseEnvelope(requestResult.stdout) as {
    readonly data: { readonly request: { readonly requestId: string } };
  };

  const bundleRoot = join(fixture, "longtable-bundle");
  const artifactContents: Record<string, string> = {
    "raw/method.json": '{"method":"fixture"}\n',
    "normalized/dataset.json": '{"fieldId":"FIELD-METHOD"}\n',
    "transformations/lineage.json": '{"operation":"formatting"}\n',
    "claims/candidates.json": '{"claimId":"CLAIM-METHOD"}\n',
    "figures/specs.json": '{"figureId":"FIG-SCHEDULE-001"}\n',
    "gaps/gaps.json": '{"gaps":[]}\n',
    "source-manifest.jsonl": '{"sourceId":"SOURCE-OFFICIAL"}\n',
    "handoff.json": `${JSON.stringify({
      schemaVersion: "proposal-research-handoff/v1",
      status: "SUCCEEDED",
      bundleId: `bundle-${proposalClass}`,
      requestId: requestEnvelope.data.request.requestId,
      accountableSynthesis: {
        owner: "LongTable Evidence Synthesizer",
        roles: [],
        unresolvedGapIds: [],
      },
      searchBudget: { fullPassesUsed: 1, deltaPassesUsed: 0 },
    })}\n`,
  };
  for (const [relativePath, contents] of Object.entries(artifactContents)) {
    const path = join(bundleRoot, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  const files = await Promise.all(Object.keys(artifactContents).map(async (path) => ({
    path,
    sha256: await core.sha256File(join(bundleRoot, path)),
    classification: "PUBLIC",
  })));
  const bundlePath = join(bundleRoot, "bundle.json");
  await writeFile(bundlePath, `${JSON.stringify({
    schemaVersion: "proposal-evidence-bundle/v1",
    bundleId: `bundle-${proposalClass}`,
    requestId: requestEnvelope.data.request.requestId,
    contractVersion: "1.0.0",
    files,
    sources: [
      {
        sourceId: "SOURCE-OFFICIAL",
        sourceClass: "institution_official",
        title: "합성 연구기관 공식자료",
        locator: "https://example.test/official",
        rightsStatus: "public",
        verified: true,
        institutionId: "SYNTHETIC-INSTITUTION",
      },
      {
        sourceId: "SOURCE-SCHOLARLY",
        sourceClass: "scholarly_fulltext",
        title: "합성 학술 원문",
        locator: "https://example.test/paper.pdf",
        rightsStatus: "public",
        verified: true,
      },
    ],
    datasets: [{
      datasetId: "DATASET-METHOD",
      name: "연구 수행방법 근거",
      sourceIds: ["SOURCE-OFFICIAL"],
      fieldIds: ["FIELD-METHOD"],
      period: "2026",
      unit: "method",
      grain: "requirement",
      records: [{ method: "fixture" }],
    }],
    transformations: [{
      schemaVersion: "transformation-lineage/v1",
      transformationId: "TRANSFORM-METHOD",
      inputSourceIds: ["SOURCE-OFFICIAL"],
      inputDatasetIds: ["DATASET-METHOD"],
      outputDatasetId: "DATASET-METHOD",
      rawLocator: "SOURCE-OFFICIAL:method",
      normalizationSteps: ["formatting"],
      derivedFormula: null,
      outputCellOrRow: "method",
      claimIds: ["CLAIM-METHOD"],
      figureIds: ["FIG-SCHEDULE-001"],
    }],
    claims: [{
      claimId: "CLAIM-METHOD",
      text: "연구 수행방법 근거를 확인했다.",
      requirementIds: ["REQ-RESEARCH-METHOD"],
      sourceIds: ["SOURCE-OFFICIAL"],
      dataIds: ["DATASET-METHOD"],
      status: "verified",
      caveats: [],
    }],
    figures: [{
      schemaVersion: "semantic-figure-spec/v1",
      figureId: "FIG-SCHEDULE-001",
      requirementIds: ["REQ-RESEARCH-METHOD"],
      analyticalQuestion: "수행방법을 어떻게 확인하는가?",
      readerTask: "검증 단계를 확인한다.",
      supportedTakeaway: "검증 가능한 수행방법을 확인할 수 있다.",
      dataIds: ["DATASET-METHOD"],
      relationship: "process",
      minimumDataConditions: { minimumRecords: 1 },
      uncertainty: [],
      sourceCaption: { text: "출처: 합성 연구기관", sourceIds: ["SOURCE-OFFICIAL"] },
      targetSurface: "A4_DOCX",
      referenceFamily: "gantt",
      rendererVersion: "1.0.0",
      approvalStatus: "reviewed",
    }],
    gaps: [],
    status: "complete",
  }, null, 2)}\n`, "utf8");
  const bundleHash = await core.sha256File(bundlePath);
  const importResult = await runCli([
    "research-import",
    root,
    "--bundle",
    bundlePath,
    "--json",
  ]);
  expect(importResult).toMatchObject({ code: 0, stderr: "" });
  expect(parseEnvelope(importResult.stdout)).toMatchObject({
    ok: true,
    data: { state: "SUCCEEDED", bundleHash },
  });
  return bundleHash;
}

async function materializeTemplate<T>(
  templatePath: string,
  destinationPath: string,
  replacements: Readonly<Record<string, string>>,
): Promise<T> {
  const source = await readFile(templatePath, "utf8");
  const rendered = Object.entries(replacements).reduce(
    (value, [placeholder, replacement]) => value.replaceAll(placeholder, replacement),
    source,
  );
  await writeFile(destinationPath, rendered, "utf8");
  return JSON.parse(rendered) as T;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(args: readonly string[]): Promise<CommandResult> {
  return runProcess(process.execPath, ["--import", "tsx", "apps/kpp-cli/src/main.ts", ...args]);
}

async function runProcess(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error: Error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseEnvelope(output: string): { readonly ok: boolean; readonly code: string; readonly data: unknown } {
  return JSON.parse(output) as { readonly ok: boolean; readonly code: string; readonly data: unknown };
}
