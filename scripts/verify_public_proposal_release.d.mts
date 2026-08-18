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
}

export function runCleanEnvironmentFixture(): Promise<{
  readonly exitCode: number;
  readonly report: CleanInstallReport;
}>;

export function runProposalClassFixture(input: {
  readonly proposalClass: ProposalClass;
  readonly researchLock: boolean;
}): Promise<{
  readonly fixtureRoot: string;
  readonly envelope: {
    readonly ok: boolean;
    readonly code: string;
    readonly message: string;
    readonly data: unknown;
  };
}>;

export function verifyPackageContracts(): Promise<unknown>;
export function runReleaseVerification(): Promise<unknown>;
