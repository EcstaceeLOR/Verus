# Trusted worker

This composition root restores a durable job's correlation ID into the safe telemetry context before
invoking a handler, then completes or fails the fenced lease with a stable outcome. It contains no
fallback in-memory production path.
