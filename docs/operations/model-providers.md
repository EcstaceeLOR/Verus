# Model-provider operations

Verus model calls are optional, bounded adapters for classification, extraction, and explanation.
Deterministic detection and policy remain authoritative: provider failure, timeout, invalid output,
or an unavailable provider causes the classifier's safe-review fallback and cannot downgrade a
deterministic block.

## Production configuration

Treat a provider rollout as an egress and privacy change. Record the approval owner, endpoint,
provider ID, immutable model version, prompt version, maximum data classification, and retention
terms. Store API credentials through the Verus secret-provider lifecycle; never put them in source,
deployment manifests, logs, or support exports.

Qwen uses the DashScope OpenAI-compatible route with an operator-supplied HTTPS endpoint. Each
deployment must set hard limits for timeout, retries, exponential delay, input characters, output
tokens, response bytes, and privacy classification. Retry delay and `Retry-After` are both capped.
Permanent client errors are not retried.

Self-hosted deployments use `OpenAICompatibleProvider` with their provider ID and completion path.
HTTPS is mandatory outside loopback. Network policy must restrict the model-gateway workload to the
approved provider endpoints; it must not share retrieval-worker egress permissions.

## Sensitive-content policy

The default policy permits public content only. Raising `maximumClassification` is an explicit
operator decision, not an application fallback. When sensitive consent is required, confidential and
restricted requests must carry active request-level consent. Withdrawing workspace consent stops
future forwarding.

Credential-like content and private keys are rejected before transport when secret detection is
enabled. Secret assets are never approved for model egress. Provider contracts and retention terms
do not replace this control.

## Observability and incident response

Alert on safe-fallback rate, timeout rate, retry exhaustion, `429`, invalid structured responses,
privacy denial, and model-version drift. Telemetry may contain provider/model/prompt/schema
versions, attempt, duration, safe error code, and status only. It must not contain content, prompts,
output, or credentials.

For an outage or suspected provider compromise:

1. Disable the provider configuration or route model work to the deterministic fake/offline path.
2. Preserve deterministic scanning; uncertain content continues to require review.
3. Revoke the provider credential and inspect content-free egress and request-ID telemetry.
4. If data exposure is suspected, follow the privacy and incident-response runbooks.
5. Restore service with a pinned provider/model/prompt configuration and watch fallback and drift
   metrics.

Provider changes require no database migration. Rollback selects the prior endpoint, model, model
version, and prompt version. Stored decisions keep their original identity, so rollback does not
rewrite history or misrepresent replay fidelity.
