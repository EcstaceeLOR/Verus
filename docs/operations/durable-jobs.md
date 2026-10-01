# Durable jobs

Verus uses PostgreSQL for at-least-once job delivery. A job envelope contains a queue, kind,
version, deadline, idempotency and effect keys, and an immutable content-addressed object reference.
It never contains source bytes, extracted text, prompts, credentials, or arbitrary exception text.

## Worker protocol

1. Claim only the queues and envelope versions the worker implements. Claims use
   `FOR UPDATE SKIP LOCKED`, increment the attempt, and return an unguessable fencing token.
2. Load the payload from the object reference under the worker's scoped capability. Validate its
   digest and contract before processing.
3. Heartbeat before the lease expires. Stop work when the response requests cancellation. A
   heartbeat cannot extend the per-attempt execution timeout or overall deadline.
4. Commit immutable output to content-addressed storage, then call `complete` with its reference and
   digest. The effect-key ledger permits exactly one logical result. Repeating the same completion
   is safe; a different result fails closed.
5. Report failures with one stable code from `JOB_FAILURES` and its defined retry policy. Never pass
   an exception message, URL, document fragment, model output, or provider response to job storage
   or telemetry.

Workers must stop immediately after `JOB_LOST_LEASE`. The result is no longer theirs to commit.
Long-running operations should poll cancellation between bounded phases and use abort signals for
network and sandbox calls.

## Retry and recovery

Retries use bounded exponential delay and cannot exceed `max_attempts` or the overall deadline. A
worker crash leaves a lease behind; the reaper records `JOB_LEASE_EXPIRED` and either schedules the
next attempt or dead-letters the job. Passing the execution limit records `JOB_HANDLER_TIMEOUT`.
Jobs waiting past their deadline terminate with `JOB_DEADLINE_EXCEEDED`.

Run at least one reaper per active queue. Claim also performs a bounded reap so recovery does not
depend on one scheduler. Rolling restarts require no lease handoff: stop claims, allow a drain
window, terminate workers, and let any remaining leases expire for another worker.

## Dead letters and replay

The dead-letter view exposes only job ID, safe kind, queue, attempt counts, stable error code, and
completion time. Operators inspect the associated sanitized service logs and separately authorized
payload tooling when needed. Do not add payload previews to the view.

Fix the underlying cause before replay. `replayDeadLetter` creates a new envelope linked to the
original, retains the original effect key, assigns a new idempotency key and deadline, and appends
an immutable audit event. A dead letter is never moved back to an active state, preserving history.

## Telemetry and alerts

Emit counts and latency for enqueue, claim, heartbeat, completion, failure, and reap, partitioned by
bounded queue, kind, outcome, and stable error code only. Never attach workspace IDs, job IDs,
object references, lease tokens, effect keys, exception text, or payload fields.

Alert on sustained oldest-ready age, dead-letter growth, repeated lease expiry, timeout rate,
attempt exhaustion, claim latency, and workers with missed heartbeats. Capacity controls must bound
queue depth and concurrency per workspace before public admission is enabled.

## Deployment and rollback

Migration `0004_durable_jobs` resets any pre-migration live lease to retry wait; no worker may run
during that migration. Deploy schema and compatible readers before new envelope writers. On
application rollback, stop new claims and use workers that understand every queued version. Retain
the expanded schema and attempt/result history. Run the down migration only on an empty installation
or approved restore drill because it removes job history and deduplication records.
