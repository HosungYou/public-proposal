export type ProposalClass =
  | "academic_research"
  | "research_service"
  | "policy_research"
  | "general_procurement"
  | "document_restyle";

export interface VerificationCommand {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly startedAt: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CleanInstallReport {
  readonly ok: boolean;
  readonly fixtureRoot: string;
  readonly home: string;
  readonly installRoot: string;
  readonly reportPath: string;
  readonly manifestPath: string;
  readonly manifest: null | {
    readonly kppVersion?: string;
    readonly longtableVersion?: string;
    readonly workerProtocol?: string;
  };
  readonly plugin: {
    readonly name: string | null;
    readonly version: string | null;
    readonly marketplaceSource: string | null;
  };
  readonly commands: readonly VerificationCommand[];
  readonly paths: readonly string[];
  readonly isolation: FixtureIsolation;
}

export interface FixtureIsolation {
  readonly environmentMode: "allowlist";
  readonly environmentKeys: readonly string[];
  readonly allowedWriteRoot: string;
  readonly writeGuard: string;
  readonly deniedWriteProbe: { readonly exitCode: number; readonly detected: string | null };
  readonly deniedHostReadProbe: { readonly exitCode: number; readonly detected: string | null };
  readonly fakeRunnerEvents: readonly unknown[];
  readonly violations: readonly unknown[];
}

export interface ResearchBinding {
  readonly researchLockPath: string;
  readonly contentApprovalPath: string;
  readonly researchLockSha256: string;
  readonly researchLockValid: boolean;
  readonly contentApprovalValid: boolean;
  readonly boundToContentApproval: boolean;
}

export function runCleanEnvironmentFixture(): Promise<{
  readonly exitCode: number;
  readonly report: CleanInstallReport;
}>;

export function runProposalClassFixture(input: {
  readonly proposalClass: ProposalClass;
  readonly researchLock: boolean;
  readonly academicEvidence?: boolean;
}): Promise<{
  readonly fixtureRoot: string;
  readonly envelope: {
    readonly ok: boolean;
    readonly code: string;
    readonly message: string;
    readonly data: unknown;
  };
  readonly researchBinding: ResearchBinding | null;
  readonly isolation: FixtureIsolation;
  readonly commands: readonly VerificationCommand[];
}>;

export function verifyPackageContracts(): Promise<unknown>;
export function makeReleaseReport(input: {
  readonly localArtifactVerified: boolean;
  readonly registryAvailable: boolean;
  readonly effectivenessValidated: boolean;
}): {
  readonly localArtifactVerified: boolean;
  readonly registryAvailable: boolean;
  readonly effectivenessValidated: boolean;
  readonly releaseReady: boolean;
};
export function evaluateRegistryProbe(input: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly expectedVersion: string;
  readonly expectedIntegrity: string;
}): {
  readonly versionVisible: boolean;
  readonly artifactMatches: boolean;
  readonly available: boolean;
  readonly blocker: null | string;
};
export function runReleaseGate(input: {
  readonly localArtifactVerified: boolean;
  readonly registryAvailable: boolean;
  readonly effectivenessValidated: boolean;
  readonly researchInvocations?: { readonly generalProcurement?: number };
}): {
  readonly ok: boolean;
  readonly code: string;
  readonly localArtifactVerified: boolean;
  readonly registryAvailable: boolean;
  readonly effectivenessValidated: boolean;
  readonly releaseReady: boolean;
};
export function runReleaseVerification(input?: { readonly benchmarkHumanPacket?: string }): Promise<unknown>;
export function validateBenchmarkEvidence(report: unknown): {
  readonly ok: boolean;
  readonly code:
    | "PP_BENCHMARK_EVIDENCE_INVALID"
    | "PP_EFFECTIVENESS_HUMAN_EVALUATION_REQUIRED"
    | "PP_EFFECTIVENESS_VALIDATED";
};
