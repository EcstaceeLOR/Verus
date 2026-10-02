export interface BenchmarkRun {
  readonly runId: string;
  readonly corpusVersion: string;
  readonly protectedBlocked: number;
  readonly baselineBlocked: number;
  readonly total: number;
  readonly artifact: string;
}
export function benchmarkSummary(
  input: BenchmarkRun,
): Readonly<{
  readonly protectedRate: number;
  readonly baselineRate: number;
  readonly delta: number;
  readonly artifact: string;
}> {
  if (input.total < 1) throw new RangeError("BENCHMARK_EMPTY");
  const protectedRate = input.protectedBlocked / input.total;
  const baselineRate = input.baselineBlocked / input.total;
  return Object.freeze({
    protectedRate,
    baselineRate,
    delta: protectedRate - baselineRate,
    artifact: input.artifact,
  });
}
