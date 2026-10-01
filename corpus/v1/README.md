# Verus Injection and Content-Manipulation Corpus v1

This small, versioned corpus establishes minimum detector requirements for Verus. It is a safety
evaluation asset, not a source of trading advice or executable instructions.

All samples are author-created synthetic text and licensed under [Apache-2.0](../../LICENSE). They
contain no customer data, scraped content, exchange data, or third-party copyrighted material.

`train` may be used to develop detectors. `calibration` may be used solely to select thresholds.
`frozen_test` is evaluation-only: it must not be included in training, prompt iteration, threshold
selection, or manual tuning. A new corpus version is required to change a frozen sample.

Run `corepack pnpm verify` to validate labels, spans, partition isolation, provenance, taxonomy
coverage, and the mapping to the published threat model.
