# Webhooks

Verus webhooks are durable notifications for safe, derived events. A successful API request does not
imply successful webhook delivery. Each endpoint must be a public HTTPS URL, and production workers
should use an outbound host allowlist plus network-level DNS and private-address blocking. Redirects
are never followed.

## Envelope and delivery headers

The body is canonical JSON with this v1 shape:

```json
{
  "audience": "agent.example",
  "data": { "disposition": "review" },
  "delivery_id": "whd_...",
  "event_id": "evt_...",
  "event_type": "scan.completed",
  "occurred_at": "2026-10-04T08:00:00.000Z",
  "ordering_key": "scan_...",
  "schema_version": "1.0",
  "sequence": 7
}
```

`data` cannot contain raw source content, credentials, cookies, tokens, or private keys. Receivers
must use the body bytes exactly as received when verifying these headers:

| Header                    | Meaning                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `X-Verus-Webhook-Version` | Signature protocol version, currently `1`                    |
| `X-Verus-Delivery-Id`     | Unique delivery and receiver-deduplication key               |
| `X-Verus-Event`           | Event type                                                   |
| `X-Verus-Attempt`         | One-based attempt number                                     |
| `X-Verus-Key-Id`          | Key to select from the current and retiring verification set |
| `X-Verus-Timestamp`       | Unix seconds used for replay-window enforcement              |
| `X-Verus-Signature`       | `v1=` followed by a lowercase HMAC-SHA256 digest             |

The signed input is `timestamp + "." + delivery_id + "." + raw_body`. Compare signatures in constant
time. Verify the timestamp, signature, audience, and delivery ID before parsing or acting on `data`.
Atomically consume `(audience, delivery_id)` in shared durable storage for at least the five-minute
signature window; an in-process set is not sufficient for a clustered receiver.

## Delivery, ordering, and replay

The producer persists a delivery before sending it. Idempotency is scoped to the configured endpoint
ID and event ID, so retries collapse without suppressing the same event for another endpoint.
Workers claim records with a 30-second lease, so another worker can recover work after a crash. HTTP
`408`, `425`, `429`, `5xx`, timeouts, and network failures retry with bounded exponential jitter.
`Retry-After` is honored up to one hour. Other `4xx` responses are permanent failures. Delivery
stops after eight attempts by default and enters `dead_letter`.

Ordering is guaranteed only when events share an `ordering_key` and increasing `sequence`. A later
event is not claimed while an earlier event for that key is pending, retrying, or actively leased.
Endpoints must nevertheless be idempotent because an ambiguous network failure can produce an
at-least-once delivery.

Manual replay is allowed only for `delivered` or `dead_letter` records. It creates a new delivery ID
and records the original delivery plus an operator reason while preserving the event ID. Never edit
or reset the original row.

## Key rotation

Generate at least 32 random bytes, keep plaintext secrets in the deployment secret manager, and
persist only key metadata. Publish the new key ID to the receiver, verify that it is trusted, switch
the producer current key, and retain the old key through the maximum retry plus replay window. Then
remove and destroy the old secret. A receiver can pass current and retiring `SigningKey` values to
`verifyWebhook`; validity bounds prevent use outside the overlap.

## Operations

Alert on sustained retry rate, dead letters, expired leases, and delivery latency without logging
payloads, endpoint URLs, workspace IDs, delivery IDs, or secrets. To pause delivery, stop workers;
queued records remain durable. To roll back application code, keep migration `0010` in place and run
a compatible worker. Delete delivery history only under the product retention policy and after
required audit export.

Webhook v1 changes are additive. A breaking envelope, signature, or event semantic change requires a
new major protocol and the support process in [compatibility policy](../compatibility.md).
