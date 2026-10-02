# Model gateway

This service is reserved for constrained provider adapters. It has no tool, policy, signing,
database, object-store, or general internet authority.

The classifier returns only validated `review` or `block` signals. Invalid output, provider errors,
and unavailable models resolve to a `review` safe fallback. Provider/model/prompt/classifier
versions are recorded in telemetry without the scanned content.
