# `@verus/webhooks`

Production webhook delivery and receiver verification for Verus. The package provides canonical
versioned envelopes, HMAC key rotation, replay-window verification, bounded retry and dead-letter
behavior, safe manual replay, an SSRF-aware HTTP transport, and PostgreSQL-backed delivery state.

Use `PostgresDeliveryStore` with migration `0010` in deployed workers. `InMemoryDeliveryStore` and
`InMemoryReplayWindow` are test and single-process development adapters only. See the
[webhook operations guide](../../docs/operations/webhooks.md) for the wire contract, rotation,
receiver rules, monitoring, and recovery.
