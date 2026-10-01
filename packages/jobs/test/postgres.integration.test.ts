import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresJobQueue, type JobQueueError } from "../src/index.js";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined)
  throw new Error("DATABASE_URL is required for integration tests.");
const databaseName = new URL(connectionString).pathname.slice(1);
if (!databaseName.endsWith("_test")) {
  throw new Error("Integration tests require a disposable database whose name ends in _test.");
}

const pool = new Pool({ connectionString, max: 4 });
const workspaceId = "ws_01ARZ3NDEKTSV4RRFFQ69G5FC0";
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const reference = (character: string): string => `object://sha256/${character.repeat(64)}`;
const instant = new Date("2026-10-01T10:00:00.000Z");
const later = (milliseconds: number): Date => new Date(instant.getTime() + milliseconds);

describe("PostgreSQL durable job queue", () => {
  let queue: PostgresJobQueue;

  beforeAll(async () => {
    const migrated = await pool.query<{ present: string | null }>(
      "SELECT to_regclass('public.job_attempts') AS present",
    );
    if (migrated.rows[0]?.present === null) {
      throw new Error("Run persistence migrations before the jobs integration suite.");
    }
    await pool.query(
      `INSERT INTO workspaces (workspace_id, slug, display_name)
       VALUES ($1, 'jobs-integration', 'Jobs integration')`,
      [workspaceId],
    );
    queue = new PostgresJobQueue(pool, {
      telemetry: { emit: () => undefined },
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("deduplicates intent and commits a final effect exactly once after a restart", async () => {
    const envelope = {
      workspaceId,
      jobId: "job_01ARZ3NDEKTSV4RRFFQ69G5FC1",
      queue: "trusted",
      kind: "scan.process",
      envelopeVersion: 1,
      payloadRef: reference("1"),
      idempotencyKey: "scan:restart-safe",
      effectKey: "capsule:restart-safe",
      maxAttempts: 3,
      timeoutMs: 60_000,
      deadlineAt: later(60 * 60_000),
      availableAt: instant,
    } as const;
    await expect(queue.enqueue(envelope)).resolves.toEqual({
      created: true,
      jobId: envelope.jobId,
    });
    await expect(
      queue.enqueue({ ...envelope, jobId: "job_01ARZ3NDEKTSV4RRFFQ69G5FC2" }),
    ).resolves.toEqual({ created: false, jobId: envelope.jobId });
    await expect(
      queue.enqueue({
        ...envelope,
        jobId: "job_01ARZ3NDEKTSV4RRFFQ69G5FC2",
        payloadRef: reference("2"),
      }),
    ).rejects.toMatchObject({ code: "JOB_CONFLICT" } satisfies Partial<JobQueueError>);

    const abandoned = await queue.claim({
      workspaceId,
      queue: "trusted",
      workerId: "worker-a",
      supportedEnvelopeVersions: [1],
      leaseMs: 5_000,
      now: instant,
    });
    expect(abandoned).toMatchObject({ attempt: 1, payloadRef: reference("1") });

    await expect(
      queue.reapExpired({ workspaceId, queue: "trusted", now: later(5_001) }),
    ).resolves.toBe(1);
    const recovered = await queue.claim({
      workspaceId,
      queue: "trusted",
      workerId: "worker-b",
      supportedEnvelopeVersions: [1],
      leaseMs: 5_000,
      now: later(6_001),
    });
    expect(recovered).toMatchObject({ attempt: 2 });
    if (recovered === undefined) throw new Error("Expected recovered job.");

    const resultRef = reference("a");
    const resultDigest = digest("a");
    await queue.complete({
      workspaceId,
      jobId: recovered.jobId,
      leaseToken: recovered.leaseToken,
      resultRef,
      resultDigest,
      now: later(6_500),
    });
    await expect(
      queue.complete({
        workspaceId,
        jobId: recovered.jobId,
        leaseToken: recovered.leaseToken,
        resultRef,
        resultDigest,
        now: later(6_600),
      }),
    ).resolves.toBeUndefined();
    const committed = await pool.query<{ count: string }>(
      "SELECT count(*) FROM job_results WHERE workspace_id = $1 AND effect_key = $2",
      [workspaceId, envelope.effectKey],
    );
    expect(committed.rows[0]?.count).toBe("1");
  });

  it("bounds retries and exposes poison jobs without hostile payload content", async () => {
    await queue.enqueue({
      workspaceId,
      jobId: "job_01ARZ3NDEKTSV4RRFFQ69G5FC3",
      queue: "parser",
      kind: "document.parse",
      envelopeVersion: 1,
      payloadRef: reference("3"),
      idempotencyKey: "parse:poison-safe",
      effectKey: "parse-result:poison-safe",
      maxAttempts: 2,
      timeoutMs: 10_000,
      deadlineAt: later(60_000),
      availableAt: instant,
    });
    const first = await queue.claim({
      workspaceId,
      queue: "parser",
      workerId: "parser-1",
      supportedEnvelopeVersions: [1],
      leaseMs: 5_000,
      now: instant,
    });
    if (first === undefined) throw new Error("Expected first poison attempt.");
    await expect(
      queue.fail({
        workspaceId,
        jobId: first.jobId,
        leaseToken: first.leaseToken,
        errorCode: "JOB_DEPENDENCY_UNAVAILABLE",
        retryable: true,
        now: later(100),
      }),
    ).resolves.toEqual({ state: "retry_wait" });

    const second = await queue.claim({
      workspaceId,
      queue: "parser",
      workerId: "parser-2",
      supportedEnvelopeVersions: [1],
      leaseMs: 5_000,
      now: later(1_100),
    });
    if (second === undefined) throw new Error("Expected second poison attempt.");
    await expect(
      queue.fail({
        workspaceId,
        jobId: second.jobId,
        leaseToken: second.leaseToken,
        errorCode: "JOB_HANDLER_FAILED",
        retryable: false,
        now: later(1_200),
      }),
    ).resolves.toEqual({ state: "dead_lettered" });

    const deadLetters = await queue.inspectDeadLetters({ workspaceId, queue: "parser" });
    expect(deadLetters).toEqual([
      expect.objectContaining({
        jobId: second.jobId,
        attempt: 2,
        errorCode: "JOB_HANDLER_FAILED",
      }),
    ]);
    expect(JSON.stringify(deadLetters)).not.toContain(reference("3"));
    const attempts = await pool.query<{ error_code: string; outcome: string }>(
      `SELECT outcome, error_code FROM job_attempts
       WHERE workspace_id = $1 AND job_id = $2 ORDER BY attempt_number`,
      [workspaceId, second.jobId],
    );
    expect(attempts.rows).toEqual([
      { outcome: "retry_wait", error_code: "JOB_DEPENDENCY_UNAVAILABLE" },
      { outcome: "dead_lettered", error_code: "JOB_HANDLER_FAILED" },
    ]);

    await queue.replayDeadLetter({
      workspaceId,
      deadJobId: second.jobId,
      newJobId: "job_01ARZ3NDEKTSV4RRFFQ69G5FC5",
      idempotencyKey: "parse:poison-safe:replay-1",
      deadlineAt: later(120_000),
      actorType: "system",
      actorId: "jobs-operator",
      auditEventId: "jobs-replay-event-1",
      now: later(2_000),
    });
    const replay = await pool.query<{ replayed_from_job_id: string }>(
      `SELECT replayed_from_job_id FROM jobs
       WHERE workspace_id = $1 AND job_id = 'job_01ARZ3NDEKTSV4RRFFQ69G5FC5'`,
      [workspaceId],
    );
    expect(replay.rows[0]?.replayed_from_job_id).toBe(second.jobId);
    const audit = await pool.query<{ count: string }>(
      `SELECT count(*) FROM audit_events
       WHERE workspace_id = $1 AND action = 'job.dead_letter_replayed'`,
      [workspaceId],
    );
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("cooperatively cancels leased work and rejects stale completion", async () => {
    await queue.enqueue({
      workspaceId,
      jobId: "job_01ARZ3NDEKTSV4RRFFQ69G5FC4",
      queue: "retriever",
      kind: "source.retrieve",
      envelopeVersion: 1,
      payloadRef: reference("4"),
      idempotencyKey: "retrieve:cancel-safe",
      effectKey: "retrieve-result:cancel-safe",
      maxAttempts: 3,
      timeoutMs: 30_000,
      deadlineAt: later(60_000),
      availableAt: instant,
    });
    const claimed = await queue.claim({
      workspaceId,
      queue: "retriever",
      workerId: "retriever-1",
      supportedEnvelopeVersions: [1],
      leaseMs: 5_000,
      now: instant,
    });
    if (claimed === undefined) throw new Error("Expected retriever job.");
    await expect(
      queue.requestCancellation({ workspaceId, jobId: claimed.jobId, now: later(100) }),
    ).resolves.toBe("requested");
    await expect(
      queue.heartbeat({
        workspaceId,
        jobId: claimed.jobId,
        leaseToken: claimed.leaseToken,
        leaseMs: 5_000,
        now: later(200),
      }),
    ).resolves.toMatchObject({ cancelRequested: true });
    await expect(
      queue.fail({
        workspaceId,
        jobId: claimed.jobId,
        leaseToken: claimed.leaseToken,
        errorCode: "JOB_CANCELLED",
        retryable: false,
        now: later(300),
      }),
    ).resolves.toEqual({ state: "cancelled" });
    await expect(
      queue.complete({
        workspaceId,
        jobId: claimed.jobId,
        leaseToken: claimed.leaseToken,
        resultRef: reference("b"),
        resultDigest: digest("b"),
        now: later(400),
      }),
    ).rejects.toMatchObject({ code: "JOB_LOST_LEASE" } satisfies Partial<JobQueueError>);
  });

  it("enforces execution timeouts independently of heartbeat leases", async () => {
    await queue.enqueue({
      workspaceId,
      jobId: "job_01ARZ3NDEKTSV4RRFFQ69G5FC6",
      queue: "model",
      kind: "model.evaluate",
      envelopeVersion: 1,
      payloadRef: reference("6"),
      idempotencyKey: "model:timeout-safe",
      effectKey: "model-result:timeout-safe",
      maxAttempts: 1,
      timeoutMs: 1_000,
      deadlineAt: later(60_000),
      availableAt: instant,
    });
    const claimed = await queue.claim({
      workspaceId,
      queue: "model",
      workerId: "model-1",
      supportedEnvelopeVersions: [1],
      leaseMs: 5_000,
      now: instant,
    });
    expect(claimed?.executionExpiresAt).toEqual(later(1_000));
    await expect(
      queue.reapExpired({ workspaceId, queue: "model", now: later(1_001) }),
    ).resolves.toBe(1);
    await expect(queue.inspectDeadLetters({ workspaceId, queue: "model" })).resolves.toEqual([
      expect.objectContaining({ errorCode: "JOB_HANDLER_TIMEOUT", attempt: 1 }),
    ]);
  });
});
