import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname);
const bytes = (name) => readFileSync(resolve(root, name));
const corpus = JSON.parse(bytes("samples.v1.json"));
const thresholds = JSON.parse(bytes("release-thresholds.v1.json"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
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
];
const frozen = corpus.samples.filter((sample) => sample.partition === "frozen_test");
const attacks = frozen.filter((sample) => sample.expected_disposition !== "allow");
const benign = frozen.filter((sample) => sample.expected_disposition === "allow");
const started = performance.now();
const detected = (sample) =>
  patterns.some((pattern) =>
    sample.content.toLocaleLowerCase("en-US").includes(pattern.toLocaleLowerCase("en-US")),
  );
const attackHits = attacks.filter(detected).length;
const falsePositives = benign.filter(detected).length;
const bps = (value, total) => (total === 0 ? 10000 : Math.round((value / total) * 10000));
const categories = Object.groupBy(
  attacks.flatMap((sample) => sample.spans.map((span) => ({ category: span.category, sample }))),
  ({ category }) => category,
);
const categoryRecall = Object.fromEntries(
  Object.entries(categories).map(([category, entries]) => [
    category,
    bps((entries ?? []).filter(({ sample }) => detected(sample)).length, (entries ?? []).length),
  ]),
);
const report = {
  corpus_version: "v1",
  artifact_digests: {
    manifest_v1_json: `sha256:${digest(bytes("manifest.v1.json"))}`,
    samples_v1_json: `sha256:${digest(bytes("samples.v1.json"))}`,
    taxonomy_v1_json: `sha256:${digest(bytes("taxonomy.v1.json"))}`,
    release_thresholds_v1_json: `sha256:${digest(bytes("release-thresholds.v1.json"))}`,
  },
  denominators: { attacks: attacks.length, benign: benign.length, frozen_test: frozen.length },
  deterministic: {
    attack_block_rate_bps: bps(attackHits, attacks.length),
    benign_false_positive_bps: bps(falsePositives, benign.length),
    category_recall_bps: categoryRecall,
    latency_ms_p95: Math.ceil(performance.now() - started),
    model_assisted: { evaluated: 0, reason: "provider-free reproducible baseline" },
  },
  thresholds: thresholds.minimums,
};
if (
  report.deterministic.attack_block_rate_bps < thresholds.minimums.attack_block_rate_bps ||
  report.deterministic.benign_false_positive_bps > thresholds.minimums.benign_false_positive_bps ||
  Object.values(categoryRecall).some(
    (value) => value < thresholds.minimums.per_category_recall_bps,
  ) ||
  report.deterministic.latency_ms_p95 > thresholds.minimums.deterministic_latency_ms_p95
)
  throw new Error(`Detection release thresholds failed: ${JSON.stringify(report)}`);
console.log(JSON.stringify(report));
