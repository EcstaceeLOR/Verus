import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { JobQueueError } from "./errors.js";
import { JOB_FAILURES, assertJobFailure, retryDelayMs, type JobFailureCode } from "./state.js";
import { NOOP_JOB_TELEMETRY, type JobOperation, type JobTelemetry } from "./telemetry.js";

const WORKSPACE_PATTERN = /^ws_[0-9A-HJKMNP-TV-Z]{26}$/;
const JOB_ID_PATTERN = /^job_[0-9A-HJKMNP-TV-Z]{26}$/;
const NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,255}$/;
const OBJECT_REF_PATTERN = /^object:\/\/sha256\/[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface ClaimedJob {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly queue: string;
  readonly kind: string;
  readonly envelopeVersion: number;
  readonly payloadRef: string;
  readonly idempotencyKey: string;
  readonly effectKey: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly executionExpiresAt: Date;
  readonly deadlineAt: Date;
}

export interface EnqueueResult {
  readonly created: boolean;
  readonly jobId: string;
}

export interface DeadLetter {
  readonly jobId: string;
  readonly queue: string;
  readonly kind: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly errorCode: JobFailureCode;
  readonly completedAt: Date;
}

interface JobRow {
  attempt: number;
  cancel_requested_at: Date | null;
  deadline_at: Date;
  effect_key: string;
  envelope_version: number;
  execution_expires_at: Date | null;
  idempotency_key: string;
  job_id: string;
  kind: string;
  lease_expires_at: Date | null;
  lease_token: string | null;
  max_attempts: number;
  payload_ref: string;
  queue_name: string;
  result_digest: string | null;
  result_ref: string | null;
  state: string;
  timeout_ms: number;
}

function assertMatch(value: string, pattern: RegExp, name: string): void {
  if (!pattern.test(value)) throw new JobQueueError("JOB_INVALID_INPUT", `Invalid ${name}.`);
}

function assertInteger(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new JobQueueError("JOB_INVALID_INPUT", `Invalid ${name}.`);
  }
}

function minimumDate(...values: readonly Date[]): Date {
  return new Date(Math.min(...values.map((value) => value.getTime())));
}

function emitSafely(telemetry: JobTelemetry, event: Parameters<JobTelemetry["emit"]>[0]): void {
  try {
    telemetry.emit(event);
  } catch {
    // Telemetry cannot change durable queue semantics.
  }
}

function mapDatabaseError(error: unknown): JobQueueError {
  if (error instanceof JobQueueError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  if (["23503", "23505", "23514", "55000"].includes(code ?? "")) {
    return new JobQueueError("JOB_CONFLICT", "Durable job invariant rejected the operation.", {
      cause: error,
    });
  }
  return new JobQueueError("JOB_STORAGE_UNAVAILABLE", "Durable job storage is unavailable.", {
    cause: error,
  });
}

export class PostgresJobQueue {
  readonly #pool: Pool;
  readonly #telemetry: JobTelemetry;

  constructor(pool: Pool, options: { readonly telemetry?: JobTelemetry } = {}) {
    this.#pool = pool;
    this.#telemetry = options.telemetry ?? NOOP_JOB_TELEMETRY;
  }

  async enqueue(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly queue: string;
    readonly kind: string;
    readonly envelopeVersion: number;
    readonly payloadRef: string;
    readonly idempotencyKey: string;
    readonly effectKey: string;
    readonly maxAttempts: number;
    readonly timeoutMs: number;
    readonly deadlineAt: Date;
    readonly availableAt?: Date;
  }): Promise<Readonly<EnqueueResult>> {
    this.#validateEnvelope(input);
    return this.#observe("enqueue", input.queue, input.kind, async () =>
      this.#transaction(input.workspaceId, async (client) => {
        const inserted = await client.query<{ job_id: string }>(
          `INSERT INTO jobs
             (workspace_id, job_id, queue_name, kind, envelope_version, payload_ref,
              idempotency_key, effect_key, max_attempts, timeout_ms, deadline_at, available_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (workspace_id, kind, idempotency_key) DO NOTHING
           RETURNING job_id`,
          [
            input.workspaceId,
            input.jobId,
            input.queue,
            input.kind,
            input.envelopeVersion,
            input.payloadRef,
            input.idempotencyKey,
            input.effectKey,
            input.maxAttempts,
            input.timeoutMs,
            input.deadlineAt,
            input.availableAt ?? new Date(),
          ],
        );
        if (inserted.rows[0] !== undefined) {
          return Object.freeze({ created: true, jobId: inserted.rows[0].job_id });
        }
        const existing = await client.query<JobRow>(
          `SELECT * FROM jobs WHERE workspace_id = $1 AND kind = $2 AND idempotency_key = $3`,
          [input.workspaceId, input.kind, input.idempotencyKey],
        );
        const row = existing.rows[0];
        if (
          row === undefined ||
          row.queue_name !== input.queue ||
          row.envelope_version !== input.envelopeVersion ||
          row.payload_ref !== input.payloadRef ||
          row.effect_key !== input.effectKey
        ) {
          throw new JobQueueError("JOB_CONFLICT", "Idempotency key is bound to another intent.");
        }
        return Object.freeze({ created: false, jobId: row.job_id });
      }),
    );
  }

  async claim(input: {
    readonly workspaceId: string;
    readonly queue: string;
    readonly workerId: string;
    readonly supportedEnvelopeVersions: readonly number[];
    readonly leaseMs: number;
    readonly now?: Date;
  }): Promise<Readonly<ClaimedJob> | undefined> {
    assertMatch(input.workspaceId, WORKSPACE_PATTERN, "workspace ID");
    assertMatch(input.queue, NAME_PATTERN, "queue name");
    assertMatch(input.workerId, WORKER_PATTERN, "worker ID");
    assertInteger(input.leaseMs, 1_000, 5 * 60_000, "lease duration");
    if (
      input.supportedEnvelopeVersions.length === 0 ||
      input.supportedEnvelopeVersions.length > 16 ||
      input.supportedEnvelopeVersions.some((version) => !Number.isSafeInteger(version))
    ) {
      throw new JobQueueError("JOB_INVALID_INPUT", "Invalid supported envelope versions.");
    }
    const now = input.now ?? new Date();
    return this.#observe("claim", input.queue, undefined, async () =>
      this.#transaction(input.workspaceId, async (client) => {
        await this.#reapWithClient(client, input.workspaceId, input.queue, now, 100);
        const candidate = await client.query<JobRow>(
          `SELECT * FROM jobs
           WHERE workspace_id = $1 AND queue_name = $2
             AND state IN ('available', 'retry_wait') AND available_at <= $3
             AND deadline_at > $3 AND attempt < max_attempts
             AND envelope_version = ANY($4::integer[])
           ORDER BY available_at, created_at, job_id
           FOR UPDATE SKIP LOCKED LIMIT 1`,
          [input.workspaceId, input.queue, now, input.supportedEnvelopeVersions],
        );
        const row = candidate.rows[0];
        if (row === undefined) return undefined;
        const leaseToken = randomUUID();
        const executionExpiresAt = minimumDate(
          new Date(now.getTime() + row.timeout_ms),
          row.deadline_at,
        );
        const leaseExpiresAt = minimumDate(
          new Date(now.getTime() + input.leaseMs),
          executionExpiresAt,
        );
        const attempt = row.attempt + 1;
        await client.query(
          `UPDATE jobs
           SET state = 'leased', attempt = $4, lease_owner = $5, lease_token = $6,
               lease_expires_at = $7, execution_expires_at = $8,
               cancel_requested_at = NULL, updated_at = $3
           WHERE workspace_id = $1 AND job_id = $2`,
          [
            input.workspaceId,
            row.job_id,
            now,
            attempt,
            input.workerId,
            leaseToken,
            leaseExpiresAt,
            executionExpiresAt,
          ],
        );
        await client.query(
          `INSERT INTO job_attempts
             (workspace_id, job_id, attempt_number, worker_id, lease_token, started_at,
              heartbeat_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [input.workspaceId, row.job_id, attempt, input.workerId, leaseToken, now],
        );
        return Object.freeze({
          workspaceId: input.workspaceId,
          jobId: row.job_id,
          queue: row.queue_name,
          kind: row.kind,
          envelopeVersion: row.envelope_version,
          payloadRef: row.payload_ref,
          idempotencyKey: row.idempotency_key,
          effectKey: row.effect_key,
          attempt,
          maxAttempts: row.max_attempts,
          leaseToken,
          leaseExpiresAt,
          executionExpiresAt,
          deadlineAt: row.deadline_at,
        });
      }),
    );
  }

  async heartbeat(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly leaseMs: number;
    readonly now?: Date;
  }): Promise<Readonly<{ cancelRequested: boolean; leaseExpiresAt: Date }>> {
    this.#validateLeaseInput(input);
    assertInteger(input.leaseMs, 1_000, 5 * 60_000, "lease duration");
    const now = input.now ?? new Date();
    return this.#observe("heartbeat", undefined, undefined, async () =>
      this.#transaction(input.workspaceId, async (client) => {
        const locked = await this.#leasedJob(client, input, now);
        const execution = locked.execution_expires_at as Date;
        const leaseExpiresAt = minimumDate(new Date(now.getTime() + input.leaseMs), execution);
        await client.query(
          `UPDATE jobs SET lease_expires_at = $4, updated_at = $3
           WHERE workspace_id = $1 AND job_id = $2`,
          [input.workspaceId, input.jobId, now, leaseExpiresAt],
        );
        await client.query(
          `UPDATE job_attempts SET heartbeat_at = $4
           WHERE workspace_id = $1 AND job_id = $2 AND attempt_number = $3`,
          [input.workspaceId, input.jobId, locked.attempt, now],
        );
        return Object.freeze({
          cancelRequested: locked.cancel_requested_at !== null,
          leaseExpiresAt,
        });
      }),
    );
  }

  async complete(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly resultRef: string;
    readonly resultDigest: string;
    readonly now?: Date;
  }): Promise<void> {
    this.#validateLeaseInput(input);
    assertMatch(input.resultRef, OBJECT_REF_PATTERN, "result reference");
    assertMatch(input.resultDigest, DIGEST_PATTERN, "result digest");
    const now = input.now ?? new Date();
    await this.#observe("complete", undefined, undefined, async () =>
      this.#transaction(input.workspaceId, async (client) => {
        const result = await client.query<JobRow>(
          `SELECT * FROM jobs WHERE workspace_id = $1 AND job_id = $2 FOR UPDATE`,
          [input.workspaceId, input.jobId],
        );
        const row = result.rows[0];
        if (row === undefined) throw new JobQueueError("JOB_NOT_FOUND", "Job does not exist.");
        if (row.state === "succeeded") {
          if (row.result_ref === input.resultRef && row.result_digest === input.resultDigest)
            return;
          throw new JobQueueError("JOB_CONFLICT", "Job already committed another result.");
        }
        this.#assertLease(row, input.leaseToken, now);
        const committed = await client.query<{ result_ref: string; result_digest: string }>(
          `INSERT INTO job_results
             (workspace_id, effect_key, job_id, result_ref, result_digest, committed_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_id, effect_key) DO NOTHING
           RETURNING result_ref, result_digest`,
          [
            input.workspaceId,
            row.effect_key,
            input.jobId,
            input.resultRef,
            input.resultDigest,
            now,
          ],
        );
        if (committed.rows[0] === undefined) {
          const prior = await client.query<{ result_ref: string; result_digest: string }>(
            `SELECT result_ref, result_digest FROM job_results
             WHERE workspace_id = $1 AND effect_key = $2`,
            [input.workspaceId, row.effect_key],
          );
          if (
            prior.rows[0]?.result_ref !== input.resultRef ||
            prior.rows[0]?.result_digest !== input.resultDigest
          ) {
            throw new JobQueueError("JOB_CONFLICT", "Effect already committed another result.");
          }
        }
        await client.query(
          `UPDATE jobs
           SET state = 'succeeded', result_ref = $4, result_digest = $5, completed_at = $3,
               lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
               execution_expires_at = NULL, updated_at = $3
           WHERE workspace_id = $1 AND job_id = $2`,
          [input.workspaceId, input.jobId, now, input.resultRef, input.resultDigest],
        );
        await this.#finishAttempt(client, input.workspaceId, row, "succeeded", undefined, now);
      }),
    );
  }

  async fail(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly errorCode: JobFailureCode;
    readonly retryable: boolean;
    readonly now?: Date;
  }): Promise<Readonly<{ state: "cancelled" | "dead_lettered" | "retry_wait" }>> {
    this.#validateLeaseInput(input);
    assertJobFailure(input.errorCode, input.retryable);
    const now = input.now ?? new Date();
    return this.#observe(
      "fail",
      undefined,
      undefined,
      async () =>
        this.#transaction(input.workspaceId, async (client) => {
          const row = await this.#leasedJob(client, input, now);
          if (row.cancel_requested_at !== null || input.errorCode === "JOB_CANCELLED") {
            await this.#settle(client, input.workspaceId, row, "cancelled", "JOB_CANCELLED", now);
            return Object.freeze({ state: "cancelled" as const });
          }
          const delay = retryDelayMs(row.attempt);
          const retryAt = new Date(now.getTime() + delay);
          if (input.retryable && row.attempt < row.max_attempts && retryAt < row.deadline_at) {
            await this.#settle(
              client,
              input.workspaceId,
              row,
              "retry_wait",
              input.errorCode,
              now,
              retryAt,
            );
            return Object.freeze({ state: "retry_wait" as const });
          }
          const terminalCode =
            retryAt >= row.deadline_at ? "JOB_DEADLINE_EXCEEDED" : input.errorCode;
          await this.#settle(client, input.workspaceId, row, "dead_lettered", terminalCode, now);
          return Object.freeze({ state: "dead_lettered" as const });
        }),
      input.errorCode,
    );
  }

  async requestCancellation(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly now?: Date;
  }): Promise<"cancelled" | "requested" | "terminal"> {
    assertMatch(input.workspaceId, WORKSPACE_PATTERN, "workspace ID");
    assertMatch(input.jobId, JOB_ID_PATTERN, "job ID");
    const now = input.now ?? new Date();
    return this.#observe("cancel", undefined, undefined, async () =>
      this.#transaction(input.workspaceId, async (client) => {
        const result = await client.query<{ state: string }>(
          `SELECT state FROM jobs WHERE workspace_id = $1 AND job_id = $2 FOR UPDATE`,
          [input.workspaceId, input.jobId],
        );
        const state = result.rows[0]?.state;
        if (state === undefined) throw new JobQueueError("JOB_NOT_FOUND", "Job does not exist.");
        if (state === "available" || state === "retry_wait") {
          await client.query(
            `UPDATE jobs SET state = 'cancelled', cancel_requested_at = $3,
             completed_at = $3, last_error_code = 'JOB_CANCELLED',
             last_error_retryable = false, updated_at = $3
           WHERE workspace_id = $1 AND job_id = $2`,
            [input.workspaceId, input.jobId, now],
          );
          return "cancelled";
        }
        if (state === "leased") {
          await client.query(
            `UPDATE jobs SET cancel_requested_at = $3, updated_at = $3
           WHERE workspace_id = $1 AND job_id = $2`,
            [input.workspaceId, input.jobId, now],
          );
          return "requested";
        }
        return "terminal";
      }),
    );
  }

  async reapExpired(input: {
    readonly workspaceId: string;
    readonly queue: string;
    readonly limit?: number;
    readonly now?: Date;
  }): Promise<number> {
    assertMatch(input.workspaceId, WORKSPACE_PATTERN, "workspace ID");
    assertMatch(input.queue, NAME_PATTERN, "queue name");
    const limit = input.limit ?? 100;
    assertInteger(limit, 1, 1_000, "reap limit");
    const now = input.now ?? new Date();
    return this.#observe("reap", input.queue, undefined, async () =>
      this.#transaction(input.workspaceId, (client) =>
        this.#reapWithClient(client, input.workspaceId, input.queue, now, limit),
      ),
    );
  }

  async inspectDeadLetters(input: {
    readonly workspaceId: string;
    readonly queue: string;
    readonly limit?: number;
  }): Promise<readonly Readonly<DeadLetter>[]> {
    assertMatch(input.workspaceId, WORKSPACE_PATTERN, "workspace ID");
    assertMatch(input.queue, NAME_PATTERN, "queue name");
    const limit = input.limit ?? 100;
    assertInteger(limit, 1, 500, "dead-letter limit");
    return this.#observe("inspect", input.queue, undefined, async () =>
      this.#transaction(input.workspaceId, async (client) => {
        const result = await client.query<{
          attempt: number;
          completed_at: Date;
          job_id: string;
          kind: string;
          last_error_code: JobFailureCode;
          max_attempts: number;
          queue_name: string;
        }>(
          `SELECT job_id, queue_name, kind, attempt, max_attempts, last_error_code, completed_at
         FROM jobs WHERE workspace_id = $1 AND queue_name = $2 AND state = 'dead_lettered'
         ORDER BY completed_at DESC, job_id LIMIT $3`,
          [input.workspaceId, input.queue, limit],
        );
        return Object.freeze(
          result.rows.map((row) =>
            Object.freeze({
              jobId: row.job_id,
              queue: row.queue_name,
              kind: row.kind,
              attempt: row.attempt,
              maxAttempts: row.max_attempts,
              errorCode: row.last_error_code,
              completedAt: row.completed_at,
            }),
          ),
        );
      }),
    );
  }

  async replayDeadLetter(input: {
    readonly workspaceId: string;
    readonly deadJobId: string;
    readonly newJobId: string;
    readonly idempotencyKey: string;
    readonly deadlineAt: Date;
    readonly actorType: "service" | "system" | "user";
    readonly actorId: string;
    readonly auditEventId: string;
    readonly now?: Date;
  }): Promise<void> {
    assertMatch(input.workspaceId, WORKSPACE_PATTERN, "workspace ID");
    assertMatch(input.deadJobId, JOB_ID_PATTERN, "dead-letter job ID");
    assertMatch(input.newJobId, JOB_ID_PATTERN, "replay job ID");
    assertMatch(input.idempotencyKey, KEY_PATTERN, "idempotency key");
    assertMatch(input.actorId, WORKER_PATTERN, "actor ID");
    assertMatch(input.auditEventId, KEY_PATTERN, "audit event ID");
    if (Number.isNaN(input.deadlineAt.getTime())) {
      throw new JobQueueError("JOB_INVALID_INPUT", "Invalid replay deadline.");
    }
    const now = input.now ?? new Date();
    if (input.deadlineAt <= now) {
      throw new JobQueueError("JOB_INVALID_INPUT", "Replay deadline must be in the future.");
    }
    await this.#observe("replay", undefined, undefined, async () =>
      this.#transaction(input.workspaceId, async (client) => {
        const result = await client.query<JobRow>(
          `SELECT * FROM jobs WHERE workspace_id = $1 AND job_id = $2 FOR UPDATE`,
          [input.workspaceId, input.deadJobId],
        );
        const row = result.rows[0];
        if (row === undefined)
          throw new JobQueueError("JOB_NOT_FOUND", "Dead letter does not exist.");
        if (row.state !== "dead_lettered") {
          throw new JobQueueError("JOB_CONFLICT", "Only a dead-lettered job can be replayed.");
        }
        await client.query(
          `INSERT INTO jobs
           (workspace_id, job_id, queue_name, kind, envelope_version, payload_ref,
            idempotency_key, effect_key, max_attempts, timeout_ms, deadline_at,
            available_at, replayed_from_job_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            input.workspaceId,
            input.newJobId,
            row.queue_name,
            row.kind,
            row.envelope_version,
            row.payload_ref,
            input.idempotencyKey,
            row.effect_key,
            row.max_attempts,
            row.timeout_ms,
            input.deadlineAt,
            now,
            input.deadJobId,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
           (workspace_id, event_id, actor_type, actor_id, action, target_type, target_id,
            new_state, occurred_at)
         VALUES ($1, $2, $3, $4, 'job.dead_letter_replayed', 'job', $5,
                 jsonb_build_object('replayed_from_job_id', $6), $7)`,
          [
            input.workspaceId,
            input.auditEventId,
            input.actorType,
            input.actorId,
            input.newJobId,
            input.deadJobId,
            now,
          ],
        );
      }),
    );
  }

  async #reapWithClient(
    client: PoolClient,
    workspaceId: string,
    queue: string,
    now: Date,
    limit: number,
  ): Promise<number> {
    const pendingExpired = await client.query(
      `WITH expired AS (
         SELECT job_id FROM jobs
         WHERE workspace_id = $1 AND queue_name = $2
           AND state IN ('available', 'retry_wait') AND deadline_at <= $3
         ORDER BY deadline_at, job_id FOR UPDATE SKIP LOCKED LIMIT $4
       )
       UPDATE jobs j SET state = 'dead_lettered', completed_at = $3,
          last_error_code = 'JOB_DEADLINE_EXCEEDED', last_error_retryable = false,
          updated_at = $3
       FROM expired
       WHERE j.workspace_id = $1 AND j.job_id = expired.job_id`,
      [workspaceId, queue, now, limit],
    );
    const remaining = limit - (pendingExpired.rowCount ?? 0);
    if (remaining === 0) return pendingExpired.rowCount ?? 0;
    const expired = await client.query<JobRow>(
      `SELECT * FROM jobs
       WHERE workspace_id = $1 AND queue_name = $2 AND state = 'leased'
         AND (lease_expires_at <= $3 OR execution_expires_at <= $3 OR deadline_at <= $3)
       ORDER BY lease_expires_at, job_id FOR UPDATE SKIP LOCKED LIMIT $4`,
      [workspaceId, queue, now, remaining],
    );
    for (const row of expired.rows) {
      const timedOut =
        (row.execution_expires_at?.getTime() ?? Number.POSITIVE_INFINITY) <= now.getTime();
      const deadlineExpired = row.deadline_at <= now;
      const code: JobFailureCode = deadlineExpired
        ? "JOB_DEADLINE_EXCEEDED"
        : timedOut
          ? "JOB_HANDLER_TIMEOUT"
          : "JOB_LEASE_EXPIRED";
      const retryAt = new Date(now.getTime() + retryDelayMs(row.attempt));
      if (
        !deadlineExpired &&
        row.attempt < row.max_attempts &&
        retryAt < row.deadline_at &&
        row.cancel_requested_at === null
      ) {
        await this.#settle(client, workspaceId, row, "retry_wait", code, now, retryAt);
      } else {
        await this.#settle(
          client,
          workspaceId,
          row,
          row.cancel_requested_at === null ? "dead_lettered" : "cancelled",
          row.cancel_requested_at === null ? code : "JOB_CANCELLED",
          now,
        );
      }
    }
    return (pendingExpired.rowCount ?? 0) + expired.rows.length;
  }

  async #settle(
    client: PoolClient,
    workspaceId: string,
    row: JobRow,
    state: "cancelled" | "dead_lettered" | "retry_wait",
    errorCode: JobFailureCode,
    now: Date,
    availableAt?: Date,
  ): Promise<void> {
    const retryable = JOB_FAILURES[errorCode].retryable;
    await client.query(
      `UPDATE jobs
       SET state = $3, available_at = COALESCE($4, available_at),
           last_error_code = $5, last_error_retryable = $6,
           completed_at = CASE WHEN $3 IN ('cancelled', 'dead_lettered') THEN $7 ELSE NULL END,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           execution_expires_at = NULL, updated_at = $7
       WHERE workspace_id = $1 AND job_id = $2`,
      [workspaceId, row.job_id, state, availableAt ?? null, errorCode, retryable, now],
    );
    await this.#finishAttempt(client, workspaceId, row, state, errorCode, now);
  }

  async #finishAttempt(
    client: PoolClient,
    workspaceId: string,
    row: JobRow,
    outcome: "cancelled" | "dead_lettered" | "retry_wait" | "succeeded",
    errorCode: JobFailureCode | undefined,
    now: Date,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE job_attempts
       SET heartbeat_at = $4, finished_at = $4, outcome = $5, error_code = $6
       WHERE workspace_id = $1 AND job_id = $2 AND attempt_number = $3
         AND finished_at IS NULL`,
      [workspaceId, row.job_id, row.attempt, now, outcome, errorCode ?? null],
    );
    if (result.rowCount !== 1) {
      throw new JobQueueError("JOB_CONFLICT", "Job attempt is already settled.");
    }
  }

  async #leasedJob(
    client: PoolClient,
    input: { readonly workspaceId: string; readonly jobId: string; readonly leaseToken: string },
    now: Date,
  ): Promise<JobRow> {
    const result = await client.query<JobRow>(
      `SELECT * FROM jobs WHERE workspace_id = $1 AND job_id = $2 FOR UPDATE`,
      [input.workspaceId, input.jobId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new JobQueueError("JOB_NOT_FOUND", "Job does not exist.");
    this.#assertLease(row, input.leaseToken, now);
    return row;
  }

  #assertLease(row: JobRow, leaseToken: string, now: Date): void {
    if (
      row.state !== "leased" ||
      row.lease_token !== leaseToken ||
      row.lease_expires_at === null ||
      row.execution_expires_at === null ||
      row.lease_expires_at <= now ||
      row.execution_expires_at <= now ||
      row.deadline_at <= now
    ) {
      throw new JobQueueError("JOB_LOST_LEASE", "Job lease is no longer valid.");
    }
  }

  #validateEnvelope(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly queue: string;
    readonly kind: string;
    readonly envelopeVersion: number;
    readonly payloadRef: string;
    readonly idempotencyKey: string;
    readonly effectKey: string;
    readonly maxAttempts: number;
    readonly timeoutMs: number;
    readonly deadlineAt: Date;
    readonly availableAt?: Date;
  }): void {
    assertMatch(input.workspaceId, WORKSPACE_PATTERN, "workspace ID");
    assertMatch(input.jobId, JOB_ID_PATTERN, "job ID");
    assertMatch(input.queue, NAME_PATTERN, "queue name");
    assertMatch(input.kind, NAME_PATTERN, "job kind");
    assertMatch(input.payloadRef, OBJECT_REF_PATTERN, "payload reference");
    assertMatch(input.idempotencyKey, KEY_PATTERN, "idempotency key");
    assertMatch(input.effectKey, KEY_PATTERN, "effect key");
    assertInteger(input.envelopeVersion, 1, 1_000, "envelope version");
    assertInteger(input.maxAttempts, 1, 20, "maximum attempts");
    assertInteger(input.timeoutMs, 1_000, 60 * 60_000, "job timeout");
    if (Number.isNaN(input.deadlineAt.getTime())) {
      throw new JobQueueError("JOB_INVALID_INPUT", "Invalid job deadline.");
    }
    if (input.availableAt !== undefined && Number.isNaN(input.availableAt.getTime())) {
      throw new JobQueueError("JOB_INVALID_INPUT", "Invalid availability time.");
    }
  }

  #validateLeaseInput(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly leaseToken: string;
  }): void {
    assertMatch(input.workspaceId, WORKSPACE_PATTERN, "workspace ID");
    assertMatch(input.jobId, JOB_ID_PATTERN, "job ID");
    assertMatch(input.leaseToken, /^[0-9a-f-]{36}$/, "lease token");
  }

  async #transaction<T>(
    workspaceId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  async #observe<T>(
    operation: JobOperation,
    queue: string | undefined,
    kind: string | undefined,
    action: () => Promise<T>,
    errorCode?: JobFailureCode,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await action();
      emitSafely(this.#telemetry, {
        name: "jobs.operation",
        operation,
        outcome: "success",
        durationMs: performance.now() - startedAt,
        ...(queue === undefined ? {} : { queue }),
        ...(kind === undefined ? {} : { kind }),
        ...(errorCode === undefined ? {} : { errorCode }),
      });
      return result;
    } catch (error) {
      emitSafely(this.#telemetry, {
        name: "jobs.operation",
        operation,
        outcome:
          error instanceof JobQueueError && error.code.includes("CONFLICT")
            ? "conflict"
            : "failure",
        durationMs: performance.now() - startedAt,
        ...(queue === undefined ? {} : { queue }),
        ...(kind === undefined ? {} : { kind }),
        ...(errorCode === undefined ? {} : { errorCode }),
      });
      throw error;
    }
  }
}
