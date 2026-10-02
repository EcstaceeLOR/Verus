import type { ClaimedJob, JobFailureCode } from "@verus/jobs";
import type { SignedScanProcessingService } from "@verus/ingestion";
import { contextFromHeaders, runWithTelemetryContext } from "@verus/observability";
import type { StructuredLogger } from "@verus/observability";

export type JobExecutionOutcome =
  | Readonly<{ kind: "completed"; resultDigest: string; resultRef: string }>
  | Readonly<{ errorCode: JobFailureCode; kind: "failed"; retryable: boolean }>;

export interface JobCompletionPort {
  complete(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly resultRef: string;
    readonly resultDigest: string;
  }): Promise<void>;
  fail(input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly errorCode: JobFailureCode;
    readonly retryable: boolean;
  }): Promise<unknown>;
}

export interface ScanProcessPort {
  process(
    input: Readonly<{ workspaceId: string; scanId: string }>,
  ): Promise<Readonly<{ capsuleDigest: string }>>;
}

const SCAN_EFFECT_KEY = /^scan-process:(scan_[0-9A-HJKMNP-TV-Z]{26})$/;

/** Creates the durable handler for scan.process jobs and rejects malformed or unsupported jobs. */
export function createScanProcessHandler(
  processor: ScanProcessPort,
): (job: ClaimedJob) => Promise<JobExecutionOutcome> {
  return async (job) => {
    if (job.kind !== "scan.process") {
      return { kind: "failed", errorCode: "JOB_UNSUPPORTED_ENVELOPE", retryable: false };
    }
    const match = SCAN_EFFECT_KEY.exec(job.effectKey);
    if (match === null)
      return { kind: "failed", errorCode: "JOB_UNSUPPORTED_ENVELOPE", retryable: false };
    try {
      const result = await processor.process({
        workspaceId: job.workspaceId,
        scanId: match[1] as string,
      });
      const digest = result.capsuleDigest;
      if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
        return { kind: "failed", errorCode: "JOB_HANDLER_FAILED", retryable: false };
      }
      return {
        kind: "completed",
        resultDigest: digest,
        resultRef: `object://sha256/${digest.slice("sha256:".length)}`,
      };
    } catch {
      return { kind: "failed", errorCode: "JOB_DEPENDENCY_UNAVAILABLE", retryable: true };
    }
  };
}

/** Binds the production signed processor to the durable scan job contract. */
export function createSignedScanProcessHandler(
  processor: SignedScanProcessingService,
): (job: ClaimedJob) => Promise<JobExecutionOutcome> {
  return createScanProcessHandler(processor);
}

export async function executeClaimedJob(
  job: ClaimedJob,
  completion: JobCompletionPort,
  handler: (job: ClaimedJob) => Promise<JobExecutionOutcome>,
  logger: StructuredLogger,
): Promise<JobExecutionOutcome> {
  const context = contextFromHeaders({ "x-correlation-id": job.correlationId });
  return runWithTelemetryContext(context, async () => {
    const startedAt = performance.now();
    logger.emit({
      level: "info",
      event: "job.started",
      component: "worker",
      attempt: job.attempt,
    });
    const outcome = await handler(job);
    if (outcome.kind === "completed") {
      await completion.complete({
        workspaceId: job.workspaceId,
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        resultRef: outcome.resultRef,
        resultDigest: outcome.resultDigest,
      });
      logger.emit({
        level: "info",
        event: "job.completed",
        component: "worker",
        outcome: "success",
        attempt: job.attempt,
        durationMs: performance.now() - startedAt,
      });
      return outcome;
    }
    await completion.fail({
      workspaceId: job.workspaceId,
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      errorCode: outcome.errorCode,
      retryable: outcome.retryable,
    });
    logger.emit({
      level: "warn",
      event: "job.failed",
      component: "worker",
      outcome: "failure",
      errorCode: outcome.errorCode,
      attempt: job.attempt,
      durationMs: performance.now() - startedAt,
    });
    return outcome;
  });
}
