import { describe, expect, it } from "vitest";
import {
  EvidenceBindingSchema,
  EvidenceItemSchema,
  ProposalClassSchema,
  ProjectSchema,
  ProjectStateSchema,
  ReceiptSchema,
} from "../src/index.js";

describe("canonical persisted schemas", () => {
  it("accepts only the ordered KPP project states", () => {
    const states = [
      "INIT",
      "SOURCE_LOCKED",
      "REQUIREMENTS_LOCKED",
      "EVIDENCE_LOCKED",
      "DESIGN_LOCKED",
      "CONTENT_APPROVED",
      "BUILT",
      "RENDERED",
      "AUDITED",
      "HUMAN_APPROVED",
      "RELEASED",
    ];

    expect(states.map((state) => ProjectStateSchema.parse(state))).toEqual(states);
    expect(() => ProjectStateSchema.parse("APPROVED")).toThrow();
  });

  it("rejects a verified claim without evidence ids", () => {
    expect(() =>
      EvidenceItemSchema.parse({
        claimId: "C-1",
        status: "verified",
        evidenceIds: [],
      }),
    ).toThrow();
  });

  it("rejects a bounded claim without evidence ids", () => {
    expect(() =>
      EvidenceItemSchema.parse({
        claimId: "C-2",
        status: "bounded",
        evidenceIds: [],
      }),
    ).toThrow();
  });

  it("permits empty evidence ids only for unresolved claim states", () => {
    expect(
      EvidenceItemSchema.parse({
        claimId: "C-3",
        status: "pending_blank",
        evidenceIds: [],
      }).status,
    ).toBe("pending_blank");
    expect(
      EvidenceItemSchema.parse({
        claimId: "C-4",
        status: "blocked",
        evidenceIds: [],
      }).status,
    ).toBe("blocked");
  });

  it("requires complete local provenance and page binding for bounded evidence", () => {
    expect(EvidenceBindingSchema.parse({
      evidenceId: "EVID-001",
      sourcePath: "/tmp/evidence.txt",
      sourceSha256: "a".repeat(64),
      scope: "입찰 자격 보유 여부",
      claimIds: ["CLAIM-001"],
      targetRequirementId: "REQ-001",
      targetPageId: "PAGE-001",
      targetPageRole: "qualification_evidence",
    })).toMatchObject({ evidenceId: "EVID-001", targetPageId: "PAGE-001" });

    expect(() => EvidenceBindingSchema.parse({
      evidenceId: "EVID-001",
      sourcePath: "/tmp/evidence.txt",
      sourceSha256: "not-a-sha",
      scope: "입찰 자격 보유 여부",
      claimIds: [],
      targetRequirementId: "REQ-001",
      targetPageId: "PAGE-001",
      targetPageRole: "qualification_evidence",
    })).toThrow();
  });

  it("accepts a new local project", () => {
    expect(
      ProjectSchema.parse({
        schemaVersion: "1.0.0",
        projectId: "sample",
        proposalClass: "general_procurement",
        state: "INIT",
        issuerPack: null,
        approvalPolicy: "single_owner",
      }).state,
    ).toBe("INIT");
  });

  it("accepts only the supported proposal classes", () => {
    const classes = [
      "academic_research",
      "research_service",
      "policy_research",
      "general_procurement",
      "document_restyle",
    ];

    expect(classes.map((proposalClass) => ProposalClassSchema.parse(proposalClass))).toEqual(classes);
    expect(() =>
      ProjectSchema.parse({
        schemaVersion: "1.0.0",
        projectId: "sample",
        proposalClass: "unknown",
        state: "INIT",
        issuerPack: null,
        approvalPolicy: "single_owner",
      }),
    ).toThrow();
  });

  it("validates receipt records used by downstream state transitions", () => {
    const receipt = ReceiptSchema.parse({
      schemaVersion: "1.0.0",
      stage: "SOURCE_LOCKED",
      createdAt: "2026-08-17T00:00:00.000Z",
      toolVersion: "0.1.0",
      files: [
        {
          path: "sources/rfp.pdf",
          sha256: "a".repeat(64),
        },
      ],
      inputReceiptHashes: [],
      result: "PASS",
    });

    expect(receipt.stage).toBe("SOURCE_LOCKED");
    expect(() =>
      ReceiptSchema.parse({ ...receipt, files: [{ path: "sources/rfp.pdf", sha256: "bad" }] }),
    ).toThrow();
  });

  it("rejects a passing receipt without a SHA-bound file", () => {
    expect(() =>
      ReceiptSchema.parse({
        schemaVersion: "1.0.0",
        stage: "SOURCE_LOCKED",
        createdAt: "2026-08-17T00:00:00.000Z",
        toolVersion: "0.1.0",
        files: [],
        inputReceiptHashes: [],
        result: "PASS",
      }),
    ).toThrow();
  });
});
