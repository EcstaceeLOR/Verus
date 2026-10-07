export interface BenchmarkCategory {
  readonly category: string;
  readonly samples: number;
  readonly detected: number;
  readonly recall_bps: number;
}

export interface BenchmarkResponse {
  readonly schema_version: "1.0";
  readonly corpus_version: "v1";
  readonly source: Readonly<{
    samples: string;
    evaluator: string;
    report: string;
    thresholds: string;
    reproduction: string;
    provenance: string;
  }>;
  readonly denominators: Readonly<{
    frozen_test: number;
    attacks: number;
    benign: number;
  }>;
  readonly results: Readonly<{
    attack_hits: number;
    attack_block_rate_bps: number;
    false_positives: number;
    benign_false_positive_bps: number;
    categories: readonly BenchmarkCategory[];
    evaluator_runtime_ms: number;
    model_assisted: Readonly<{
      evaluated: number;
      status: "not_measured";
      reason: string;
    }>;
  }>;
  readonly protected_vs_baseline: Readonly<{
    baseline_raw_attack_exposure: number;
    baseline_total_attacks: number;
    protected_flagged_before_inference: number;
    protected_automatic_attack_exposure: number;
    scope: string;
  }>;
  readonly gates: Readonly<{
    minimum_attack_block_rate_bps: number;
    maximum_benign_false_positive_bps: number;
    minimum_per_category_recall_bps: number;
    maximum_deterministic_runtime_ms: number;
    pass: boolean;
  }>;
  readonly limitations: readonly string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function safeBenchmarkResponse(value: unknown): BenchmarkResponse | undefined {
  const root = record(value);
  const source = record(root?.source);
  const denominators = record(root?.denominators);
  const results = record(root?.results);
  const model = record(results?.model_assisted);
  const comparison = record(root?.protected_vs_baseline);
  const gates = record(root?.gates);

  if (
    root?.schema_version !== "1.0" ||
    root.corpus_version !== "v1" ||
    source === undefined ||
    typeof source.samples !== "string" ||
    typeof source.evaluator !== "string" ||
    typeof source.report !== "string" ||
    typeof source.thresholds !== "string" ||
    typeof source.reproduction !== "string" ||
    typeof source.provenance !== "string" ||
    denominators === undefined ||
    ![denominators.frozen_test, denominators.attacks, denominators.benign].every(
      (part) => typeof part === "number" && Number.isSafeInteger(part) && part >= 0,
    ) ||
    results === undefined ||
    typeof results.attack_hits !== "number" ||
    typeof results.attack_block_rate_bps !== "number" ||
    typeof results.false_positives !== "number" ||
    typeof results.benign_false_positive_bps !== "number" ||
    typeof results.evaluator_runtime_ms !== "number" ||
    !Array.isArray(results.categories) ||
    model === undefined ||
    typeof model.evaluated !== "number" ||
    model.status !== "not_measured" ||
    typeof model.reason !== "string" ||
    comparison === undefined ||
    typeof comparison.baseline_raw_attack_exposure !== "number" ||
    typeof comparison.baseline_total_attacks !== "number" ||
    typeof comparison.protected_flagged_before_inference !== "number" ||
    typeof comparison.protected_automatic_attack_exposure !== "number" ||
    typeof comparison.scope !== "string" ||
    gates === undefined ||
    typeof gates.pass !== "boolean" ||
    typeof gates.minimum_attack_block_rate_bps !== "number" ||
    typeof gates.maximum_benign_false_positive_bps !== "number" ||
    typeof gates.minimum_per_category_recall_bps !== "number" ||
    typeof gates.maximum_deterministic_runtime_ms !== "number" ||
    !Array.isArray(root.limitations)
  ) {
    return undefined;
  }

  for (const candidate of results.categories) {
    const category = record(candidate);
    if (
      category === undefined ||
      typeof category.category !== "string" ||
      typeof category.samples !== "number" ||
      typeof category.detected !== "number" ||
      typeof category.recall_bps !== "number"
    ) {
      return undefined;
    }
  }

  if (!root.limitations.every((item) => typeof item === "string")) return undefined;

  return value as BenchmarkResponse;
}

export function formatBps(value: number): string {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}
