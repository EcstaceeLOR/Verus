# Webhooks

Webhook bodies use canonical JSON and `X-Verus-Signature-SHA256`. Receivers verify against the
current and retiring secret during a rotation overlap, deduplicate `X-Verus-Delivery-Id`, and may
replay failed deliveries safely. Producers never include raw quarantined content. v1 changes are
additive; a breaking contract change requires a new major route/event version and a published
deprecation window.
