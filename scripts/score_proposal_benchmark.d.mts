export const SCORE_PROTOCOL_VERSION: "1.0.0";

export interface MachineArmScore {
  readonly requirementDirectAnswerCoverage: number;
  readonly supportedClaimPrecision: number;
  readonly unsupportedInstitutionClaims: number;
  readonly wrongInstitutionClaims: number;
  readonly sourcePageTraceability: number;
  readonly mandatoryClaimTraceability: number;
  readonly figureLineage: number;
  readonly researchInvocationCorrectness: number | null;
  readonly evaluatorUsefulness: null;
  readonly koreanNaturalness: null;
  readonly sendReady: null;
  readonly revisionBurdenMinutes: null;
  readonly wallTimeMilliseconds: number | null;
  readonly toolCalls: number | null;
  readonly duplicateArtifacts: number;
  readonly unusedResearch: number;
}

export function scoreArm(output: Record<string, unknown>): MachineArmScore;

export function scoreBenchmark(input: {
  readonly input: string;
  readonly output: string;
  readonly humanPacket?: string;
}): Promise<{
  readonly protocolVersion: string;
  readonly scorerVersion: typeof SCORE_PROTOCOL_VERSION;
  readonly humanEvaluationRequired: boolean;
  readonly effectivenessValidated: boolean;
  readonly thresholds: Record<string, { readonly passed: boolean; readonly [key: string]: unknown }>;
  readonly humanScores: readonly Array<{
    readonly outputId: string;
    readonly fixtureId: string;
    readonly arm: "A" | "B" | "C";
    readonly evaluatorUsefulness: number;
    readonly koreanNaturalness: number;
    readonly sendReadyRate: number;
    readonly revisionBurdenMinutes: number;
    readonly compositeScore: number;
  }>;
  readonly rawEvidencePreserved: boolean;
}>;
