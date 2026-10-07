export interface BenchmarkMetric {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly kind: "result" | "gate" | "scope";
}

export const benchmarkMetrics: readonly BenchmarkMetric[] = Object.freeze([
  Object.freeze({
    label: "Frozen attack detection",
    value: "3 / 3",
    detail: "10,000 bps attack blocking on the v1 frozen deterministic baseline.",
    kind: "result",
  }),
  Object.freeze({
    label: "Frozen benign false positives",
    value: "0 / 1",
    detail: "0 bps benign false positives on the single frozen benign control.",
    kind: "result",
  }),
  Object.freeze({
    label: "Represented category recall",
    value: "100%",
    detail:
      "10,000 bps recall for direct override, multilingual instruction, and hidden-content categories represented in frozen_test.",
    kind: "result",
  }),
  Object.freeze({
    label: "Deterministic p95 release gate",
    value: "≤ 100 ms",
    detail:
      "This is the frozen release threshold, not an invented measured latency value. The evaluator fails when the measured run exceeds it.",
    kind: "gate",
  }),
  Object.freeze({
    label: "Frozen denominator",
    value: "4 samples",
    detail: "3 adversarial synthetic samples + 1 benign synthetic control.",
    kind: "scope",
  }),
  Object.freeze({
    label: "Model-assisted benchmark",
    value: "Not measured",
    detail: "The reproducible v1 gate intentionally makes no external model-provider call.",
    kind: "scope",
  }),
]);

export const benchmarkCategoryResults = Object.freeze([
  Object.freeze({ category: "Direct instruction override", recall: "100%", samples: 1 }),
  Object.freeze({ category: "Multilingual instruction", recall: "100%", samples: 1 }),
  Object.freeze({ category: "Hidden content", recall: "100%", samples: 1 }),
]);

export const benchmarkProvenance = Object.freeze({
  corpusVersion: "v1",
  license: "Apache-2.0",
  samplesPath: "corpus/v1/samples.v1.json",
  reportPath: "corpus/v1/evaluation-report.v1.md",
  evaluatorPath: "corpus/v1/evaluate-detection.mjs",
  thresholdsPath: "corpus/v1/release-thresholds.v1.json",
  reproduction: "corepack pnpm verify",
});
