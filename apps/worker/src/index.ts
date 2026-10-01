import type { ClaimedJob, JobFailureCode } from "@verus/jobs";
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
