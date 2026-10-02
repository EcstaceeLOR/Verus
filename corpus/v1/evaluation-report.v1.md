# Verus v1 frozen-corpus evaluation report

## Reproduction

From a clean checkout with the pinned Node and pnpm versions, run:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify-corpus.mjs` validates partition separation, labels, licenses, categories, and threat
coverage. `evaluate-detection.mjs` emits a machine-readable report with SHA-256 digests for the
manifest, samples, taxonomy, and thresholds. The report fails the build if aggregate attack recall,
benign false-positive rate, any represented category recall, or deterministic p95 latency misses the
frozen threshold.

## Frozen deterministic baseline

The v1 frozen test denominator is four author-created synthetic samples: three attack samples and
one benign control. The current deterministic pattern baseline reports 10,000 basis points attack
blocking, 0 basis points benign false positives, and 10,000 basis points recall for each represented
category. Model-assisted results are intentionally marked unavailable because this reproducible gate
does not call a provider.

No exclusions are permitted: every `frozen_test` sample appears in attack or benign denominators,
and every attack span appears in its category denominator. The corpus is Apache-2.0 licensed and
contains no customer, exchange, scraped, or third-party source content; see
[the corpus README](README.md).

## Limitations

This is a minimum release regression corpus, not proof that Verus detects every injection, language,
file format, adversarial mutation, or production failure. Its small synthetic denominator cannot
estimate real-world prevalence, provider quality, availability, or financial accuracy. A passing
result never authorizes a trade, overrides a `review`/`block` disposition, or replaces signature,
evidence, source, tenant, and policy verification. The published threat model records remaining
risks and production controls.
