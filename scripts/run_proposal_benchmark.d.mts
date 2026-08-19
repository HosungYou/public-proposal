export const BENCHMARK_PROTOCOL_VERSION: "1.0.0";
export const DEFAULT_BENCHMARK_BUDGETS: Readonly<{
  readonly timeMinutes: 45;
  readonly tokenLimit: 40000;
  readonly toolCallLimit: 20;
}>;

export interface BenchmarkArm {
  readonly fixtureId: string;
  readonly arm: "A" | "B" | "C";
  readonly workflow: string;
  readonly inputHash: string;
  readonly seed: number;
  readonly budgets: typeof DEFAULT_BENCHMARK_BUDGETS;
  readonly outputId: string;
  readonly rawOutputPath: string;
  readonly blindedOutputPath: string;
  readonly harness: "deterministic-placeholder";
  readonly modelExecution: "not-run";
  readonly humanEvaluationRequired: true;
  readonly rawOutputSha256: string;
  readonly longTableInvocations: number;
  readonly researchInvocationExpected: number;
  readonly wallTimeMilliseconds: number;
  readonly tokenUsage: number;
  readonly toolCalls: number;
  readonly duplicateArtifactCount: number;
  readonly unusedResearchCount: number;
  readonly cost: { readonly currency: "USD"; readonly amount: number; readonly status: string };
  readonly structuredReviewConfigured: boolean;
}

export interface BenchmarkRun {
  readonly protocolVersion: typeof BENCHMARK_PROTOCOL_VERSION;
  readonly runId: string;
  readonly harness: "deterministic-placeholder";
  readonly harnessNotice: string;
  readonly humanEvaluationRequired: true;
  readonly fixtures: readonly Array<{
    readonly fixtureId: string;
    readonly proposalClass: string;
    readonly synthetic: true;
    readonly customerData: false;
  }>;
  readonly inputHashes: Readonly<Record<string, string>>;
  readonly arms: readonly BenchmarkArm[];
  readonly humanEvaluationPacketPath: string;
  readonly rawEvidencePreserved: true;
}

export function runBenchmark(input: {
  readonly fixtureSet: string;
  readonly out: string;
  readonly fixture?: string;
  readonly arms?: readonly ("A" | "B" | "C")[];
  readonly seeds?: readonly number[];
  readonly budgets?: typeof DEFAULT_BENCHMARK_BUDGETS;
}): Promise<BenchmarkRun>;
