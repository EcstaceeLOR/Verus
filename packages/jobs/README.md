# Jobs

PostgreSQL-backed durable envelopes, fenced leases, bounded retries, cancellation, idempotent result
commits, and dead-letter handling.

`PostgresJobQueue` stores only versioned metadata and immutable object references. Workers claim a
supported envelope version, heartbeat while running, and complete or fail with the lease token.
Every handler failure uses a stable code from `JOB_FAILURES`; free-form exception text and hostile
payload content are never persisted.

See the [durable jobs runbook](../../docs/operations/durable-jobs.md) for worker behavior, alerting,
recovery, replay, and rollback.
