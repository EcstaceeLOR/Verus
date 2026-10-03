import type { ClaimedJob } from "@verus/jobs";
import { StructuredLogger } from "@verus/observability";
import { describe, expect, it } from "vitest";

import {
  createScanProcessHandler,
  executeClaimedJob,
  runWorkerOnce,
  type JobCompletionPort,
  type JobClaimPort,
} from "../src/index.js";
import { runWorkerPollLoop } from "../src/runtime.js";

const job = Object.freeze({
  workspaceId: "ws_01ARZ3NDEKTSV4RRFFQ69G5FC0",
  jobId: "job_01ARZ3NDEKTSV4RRFFQ69G5FC1",
  correlationId: "corr_worker_trace_1234",
  queue: "trusted",
  kind: "scan.process",
  envelopeVersion: 1,
  payloadRef: `object://sha256/${"1".repeat(64)}`,
  idempotencyKey: "scan:worker-trace",
  effectKey: "capsule:worker-trace",
  attempt: 1,
  maxAttempts: 3,
  leaseToken: "12345678-1234-1234-1234-123456789abc",
  leaseExpiresAt: new Date("2026-10-01T00:01:00.000Z"),
  executionExpiresAt: new Date("2026-10-01T00:10:00.000Z"),
  deadlineAt: new Date("2026-10-01T01:00:00.000Z"),
} satisfies ClaimedJob);

describe("worker telemetry composition", () => {
  it("turns a scan-process effect into a durable capsule result", async () => {
    const handler = createScanProcessHandler({
      process: async (input) => {
        expect(input).toEqual({
          workspaceId: job.workspaceId,
          scanId: "scan_01ARZ3NDEKTSV4RRFFQ69G5FC0",
        });
        return { capsuleDigest: `sha256:${"b".repeat(64)}` };
      },
    });
    await expect(
      handler({ ...job, effectKey: "scan-process:scan_01ARZ3NDEKTSV4RRFFQ69G5FC0" }),
    ).resolves.toEqual({
      kind: "completed",
      resultDigest: `sha256:${"b".repeat(64)}`,
      resultRef: `object://sha256/${"b".repeat(64)}`,
    });
  });
  it("retains the durable correlation ID through claim, handler, completion, and logs", async () => {
    const completed: unknown[] = [];
    const lines: string[] = [];
    const completion: JobCompletionPort = {
      complete: async (input) => {
        completed.push(input);
      },
      fail: async () => undefined,
    };
    const logger = new StructuredLogger("verus-worker", { sink: (line) => lines.push(line) });
    await expect(
      executeClaimedJob(
        job,
        completion,
        async (claimed) => {
          expect(claimed.correlationId).toBe(job.correlationId);
          return {
            kind: "completed",
            resultRef: `object://sha256/${"a".repeat(64)}`,
            resultDigest: `sha256:${"a".repeat(64)}`,
          };
        },
        logger,
      ),
    ).resolves.toMatchObject({ kind: "completed" });
    expect(completed).toEqual([
      expect.objectContaining({ workspaceId: job.workspaceId, jobId: job.jobId }),
    ]);
    expect(lines.map((line) => JSON.parse(line).correlation_id)).toEqual([
      job.correlationId,
      job.correlationId,
    ]);
  });

  it("claims no more than one durable job per polling operation", async () => {
    const completed: unknown[] = [];
    const queue: JobClaimPort = {
      claim: async () => job,
      complete: async (input) => {
        completed.push(input);
      },
      fail: async () => undefined,
    };
    const logger = new StructuredLogger("verus-worker", { sink: () => undefined });
    const result = await runWorkerOnce({
      queue,
      workspaceId: job.workspaceId,
      workerId: "worker-test",
      logger,
      handler: async () => ({
        kind: "completed",
        resultRef: `object://sha256/${"c".repeat(64)}`,
        resultDigest: `sha256:${"c".repeat(64)}`,
      }),
    });
    expect(result).toEqual({ claimed: true });
    expect(completed).toHaveLength(1);
  });

  it("backs off while idle and stops without another claim after cancellation", async () => {
    const controller = new AbortController();
    const waits: number[] = [];
    let claims = 0;
    const logger = new StructuredLogger("verus-worker", { sink: () => undefined });
    await runWorkerPollLoop({
      signal: controller.signal,
      logger,
      idleIntervalMs: 7,
      pollIntervalMs: 3,
      runOnce: async () => {
        claims += 1;
        return { claimed: false };
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        controller.abort();
      },
    });
    expect(claims).toBe(1);
    expect(waits).toEqual([7]);
  });
});
