# Verus model gateway

The model gateway is the deliberately narrow boundary between untrusted trading content and an
optional language-model provider. It supports bounded classification, extraction, and explanation
requests without giving a model access to tools, policy, signing keys, databases, object storage, or
general network retrieval.

Model output is advisory. The deterministic policy engine remains authoritative. The isolated
classifier accepts only `review` or `block`, converts provider failure or invalid output to
`review`, and preserves an existing deterministic `block` regardless of the provider result.

## Provider contract

Every `ModelRequest` declares:

- task, immutable prompt version, and response-schema ID;
- input content and its data classification;
- maximum output tokens and optional cancellation signal; and
- explicit sensitive-content consent when required.

Every accepted response records provider, model, immutable model version, prompt version, schema,
provider request ID when present, and token usage when reported. The caller supplies the schema
parser, so syntactically valid JSON with an invalid shape is rejected.

`OpenAICompatibleProvider` is the self-hosting hook. It supports an HTTPS OpenAI-compatible endpoint
without provider-specific code. Plain HTTP is rejected except for an explicitly enabled loopback
endpoint. `QwenProvider` fixes the provider identity and DashScope compatible-mode route while
retaining an operator-configured endpoint.

```ts
import { QwenProvider } from "@verus/model-gateway";

const provider = new QwenProvider({
  apiKey: secretProviderValue,
  endpoint: "https://dashscope.aliyuncs.com",
  model: "qwen-plus",
  modelVersion: "qwen-plus-2026-09-01",
  timeoutMs: 10_000,
  maximumRetries: 2,
  retryBaseDelayMs: 250,
  maximumRetryDelayMs: 5_000,
  maximumInputCharacters: 100_000,
  maximumOutputTokens: 1_024,
  maximumResponseBytes: 256_000,
  privacy: {
    maximumClassification: "internal",
    requireSensitiveContentConsent: true,
    rejectDetectedSecrets: true,
  },
});
```

Do not source `apiKey` from checked-in configuration. Resolve it from the platform secret provider
at process startup and discard the plaintext reference after construction. Provider configuration is
private and is not serialized by the adapter.

## Safety and budgets

The gateway enforces constructor bounds, input characters, requested output tokens, response bytes,
one response choice, JSON parsing, and caller-supplied schema validation. Calls have a hard timeout.
Only `408`, `429`, `500`, `502`, `503`, and `504`, transport failures, timeouts, and invalid
provider output are retryable. Exponential delay, retry count, and `Retry-After` are capped;
permanent `4xx` responses are never retried.

The default privacy policy is public-only. A deployment can approve a higher classification, but
confidential or restricted requests require explicit request-level consent when configured. Common
credential and private-key patterns are denied before transport. Secret assets must never be sent to
a model provider, even when a workspace has consented to other sensitive content.

Telemetry contains only outcome, provider/model versions, prompt/schema versions, attempt, duration,
safe error code, and HTTP status. It never contains source content, prompts, model output, or API
keys.

## Testing and rollback

`DeterministicFakeProvider` exercises the exact schema boundary with no network and is suitable for
repeatable tests and offline installations. The package test suite covers privacy denial, bounded
retry, timeout, cancellation, response-size limits, schema rejection, safe fallback, deterministic
precedence, telemetry redaction, and self-hosted transport rules.

Provider changes require no data migration. Roll back by restoring the prior endpoint, provider,
model version, and prompt version configuration. Previously stored decisions remain attributable
because all four identities are recorded with the result. During a provider incident, select the
fake/offline path or disable model calls; deterministic policy continues to operate and uncertain
content resolves to human review.
