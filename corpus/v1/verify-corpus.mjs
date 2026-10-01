import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const readJson = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
const taxonomy = readJson("taxonomy.v1.json");
const corpus = readJson("samples.v1.json");
const manifest = readJson("manifest.v1.json");
const categories = new Map(taxonomy.categories.map((category) => [category.id, category]));
const ids = new Set();
const contents = new Set();
const partitions = new Set(["train", "calibration", "frozen_test"]);
const covered = new Set();
const threats = new Set();

if (!manifest.partition_policy.frozen_test.includes("MUST NOT")) {
  throw new Error("frozen_test partition policy must explicitly prohibit detector tuning");
}

for (const sample of corpus.samples) {
  if (!ids.add(sample.id) || !contents.add(sample.content))
    throw new Error(`duplicate sample: ${sample.id}`);
  if (!partitions.has(sample.partition)) throw new Error(`invalid partition: ${sample.id}`);
  if (sample.provenance !== "author_created_synthetic" || sample.license !== manifest.license) {
    throw new Error(`invalid provenance or license: ${sample.id}`);
  }
  if (!sample.spans.length && sample.expected_disposition !== "allow") {
    throw new Error(`non-benign sample needs a labeled span: ${sample.id}`);
  }
  for (const span of sample.spans) {
    const category = categories.get(span.category);
    if (!category || !sample.content.includes(span.text))
      throw new Error(`invalid span: ${sample.id}`);
    if (sample.expected_disposition !== category.default_disposition) {
      throw new Error(`unexpected disposition for ${sample.id}`);
    }
    covered.add(span.category);
    category.threats.forEach((threat) => threats.add(threat));
  }
  if (!sample.spans.length) covered.add("benign_control");
}

for (const category of manifest.required_categories) {
  if (!covered.has(category)) throw new Error(`missing required category: ${category}`);
}
for (const threat of manifest.required_threats) {
  if (!threats.has(threat)) throw new Error(`missing threat coverage: ${threat}`);
}
for (const partition of partitions) {
  if (!corpus.samples.some((sample) => sample.partition === partition))
    throw new Error(`empty partition: ${partition}`);
}

console.log(
  `Verified corpus ${manifest.corpus_version}: ${corpus.samples.length} synthetic samples across ${partitions.size} partitions.`,
);
