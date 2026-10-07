import { performance } from "node:perf_hooks";

import samplesDocument from "../corpus/v1/samples.v1.json" with { type: "json" };
import thresholdsDocument from "../corpus/v1/release-thresholds.v1.json" with { type: "json" };

import type { HostedRequest, HostedResponse } from "./http.js";
import { secureJson } from "./http.js";

const patterns = [
  "ignore",
  "disregard",
  "tool",
  "aWdub3Jl",
  "display:none",
  "aria-hidden",
  "VERUS SECURITY",
  "ignora",
  "überspringe",
] as const;

interface CorpusSpan {
  readonly category: string;
}

interface CorpusSample {
  readonly id: string;
  readonly partition: string;
  readonly content: string;
  readonly expected_disposition: "allow" | "review" | "block";
  readonly spans: readonly CorpusSpan[];
}

const samples = samplesDocument.samples as readonly CorpusSample[];
const thresholds = thresholdsDocument.minimums;

function detected(sample: CorpusSample): boolean {
  const content = sample.content.toLocaleLowerCase("en-US");
  return patterns.some((pattern) => content.includes(pattern.toLocaleLowerCase("en-US")));
}

function bps(value: number, total: number): number {
  return total === 0 ? 10_000 : Math.round((value / total) * 10_000);
}

export function evaluateFrozenBenchmark() {
  const frozen = samples.filter((sample) => sample.partition === "frozen_test");
  const attacks = frozen.filter((sample) => sample.expected_disposition !== "allow");
  const benign = frozen.filter((sample) => sample.expected_disposition === "allow");

  const started = performance.now();
  const attackHits = attacks.filter(detected).length;
  const falsePositives = benign.filter(detected).length;

  const categoryEntries = new Map<string, CorpusSample[]>();
  for (const sample of attacks) {
    for (const span of sample.spans) {
      const entries = categoryEntries.get(span.category) ?? [];
      entries.push(sample);
      categoryEntries.set(span.category, entries);
    }
  }

  const categories = [...categoryEntries.entries()]
    .map(([category, entries]) => ({
      category,
      samples: entries.length,
      detected: entries.filter(detected).length,
      recall_bps: bps(entries.filter(detected).length, entries.length),
    }))
    .sort((left, right) => left.category.localeCompare(right.category));

  const evaluatorRuntimeMs = Math.ceil(performance.now() - started);
  const attackBlockRateBps = bps(attackHits, attacks.length);
  const benignFalsePositiveBps = bps(falsePositives, benign.length);
  const categoryGatePass = categories.every(
    (category) => category.recall_bps >= thresholds.per_category_recall_bps,
  );

  return Object.freeze({
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
    denominators: {
      frozen_test: frozen.length,
      attacks: attacks.length,
      benign: benign.length,
    },
    results: {
      attack_hits: attackHits,
      attack_block_rate_bps: attackBlockRateBps,
      false_positives: falsePositives,
      benign_false_positive_bps: benignFalsePositiveBps,
      categories,
      evaluator_runtime_ms: evaluatorRuntimeMs,
      model_assisted: {
        evaluated: 0,
        status: "not_measured",
        reason: "provider-free reproducible baseline",
      },
    },
    protected_vs_baseline: {
      baseline_raw_attack_exposure: attacks.length,
      baseline_total_attacks: attacks.length,
      protected_flagged_before_inference: attackHits,
      protected_automatic_attack_exposure: attacks.length - attackHits,
      scope: "frozen deterministic corpus only",
    },
    gates: {
      minimum_attack_block_rate_bps: thresholds.attack_block_rate_bps,
      maximum_benign_false_positive_bps: thresholds.benign_false_positive_bps,
      minimum_per_category_recall_bps: thresholds.per_category_recall_bps,
      maximum_deterministic_runtime_ms: thresholds.deterministic_latency_ms_p95,
      pass:
        attackBlockRateBps >= thresholds.attack_block_rate_bps &&
        benignFalsePositiveBps <= thresholds.benign_false_positive_bps &&
        categoryGatePass &&
        evaluatorRuntimeMs <= thresholds.deterministic_latency_ms_p95,
    },
    limitations: [
      "The frozen denominator is four author-created synthetic samples.",
      "Each represented attack category has one frozen sample.",
      "This regression gate does not estimate real-world prevalence or universal attack coverage.",
      "The runtime value measures only this small deterministic evaluator execution, not end-to-end production latency.",
      "No model-assisted benchmark is reported because the reproducible gate makes no provider call.",
      "A passing benchmark does not establish factual accuracy, authorize a trade, or replace evidence and signature verification.",
    ],
  });
}

export default function benchmark(request: HostedRequest, response: HostedResponse): void {
  secureJson(response);
  if (request.method !== "GET") {
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }
  response.status(200).json(evaluateFrozenBenchmark());
}
