# Model providers

Verus model calls are bounded adapters for classification, extraction, and explanation.
Deterministic policy remains authoritative: provider failure, timeout, invalid output, or
unavailable provider causes the classifier's safe-review fallback.

Qwen uses a configurable endpoint, explicit model and prompt versions, timeouts, retry cap, and
maximum token budget. Provider request identifiers may be recorded; API keys, prompts, and source
content never enter telemetry. Sensitive-content forwarding is disabled by default and must be
explicitly enabled for an approved provider deployment.

Self-hosted deployments can substitute any `ModelProvider`; `DeterministicFakeProvider` exists for
repeatable tests and no-network validation. Roll back by selecting the prior provider/model/prompt
configuration; stored decisions retain their recorded versions.
