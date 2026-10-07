import { describe, expect, it } from "vitest";

import { formatBps, safeBenchmarkResponse } from "./benchmark-proof.js";

describe("benchmark proof parsing", () => {
  it("formats basis points without inflating precision", () => {
    expect(formatBps(10_000)).toBe("100%");
    expect(formatBps(8_000)).toBe("80%");
    expect(formatBps(8_825)).toBe("88.25%");
  });

  it("keeps the frozen denominator and limitations explicit", () => {
    const parsed = safeBenchmarkResponse({
      schema_version: "1.0",
      corpus_version: "v1",
      source: {
        samples: "corpus/v1/samples.v1.json",
        evaluator: "corpus/v1/evaluate-detection.mjs",
        report: "corpus/v1/evaluation-report.v1.md",
        thresholds: "corpus/v1/release-thresholds.v1.json",
        reproduction: "corepack pnpm verify",
        provenance: "author_created_synthetic",
      },
      denominators: { frozen_test: 4, attacks: 3, benign: 1 },
      results: {
        attack_hits: 3,
        attack_block_rate_bps: 10_000,
        false_positives: 0,
        benign_false_positive_bps: 0,
        categories: [
          {
            category: "direct_instruction_override",
            samples: 1,
            detected: 1,
            recall_bps: 10_000,
          },
        ],
        evaluator_runtime_ms: 1,
        model_assisted: {
          evaluated: 0,
          status: "not_measured",
          reason: "provider-free reproducible baseline",
        },
      },
      protected_vs_baseline: {
        baseline_raw_attack_exposure: 3,
        baseline_total_attacks: 3,
        protected_flagged_before_inference: 3,
        protected_automatic_attack_exposure: 0,
        scope: "frozen deterministic corpus only",
      },
      gates: {
        minimum_attack_block_rate_bps: 8_000,
        maximum_benign_false_positive_bps: 1_000,
        minimum_per_category_recall_bps: 7_000,
        maximum_deterministic_runtime_ms: 100,
        pass: true,
      },
      limitations: ["The frozen denominator is four author-created synthetic samples."],
    });

    expect(parsed?.denominators).toEqual({ frozen_test: 4, attacks: 3, benign: 1 });
    expect(parsed?.limitations[0]).toContain("four");
    expect(parsed?.results.model_assisted.status).toBe("not_measured");
  });
});
