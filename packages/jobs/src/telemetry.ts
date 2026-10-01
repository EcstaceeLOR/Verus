import type { JobFailureCode } from "./state.js";

export type JobOperation =
  | "cancel"
  | "claim"
  | "complete"
  | "enqueue"
  | "fail"
  | "heartbeat"
  | "inspect"
  | "reap"
  | "replay";

export interface JobTelemetryEvent {
  readonly name: "jobs.operation";
  readonly operation: JobOperation;
  readonly outcome: "conflict" | "failure" | "noop" | "success";
  readonly durationMs: number;
  readonly queue?: string;
  readonly kind?: string;
  readonly errorCode?: JobFailureCode;
}

export interface JobTelemetry {
  emit(event: JobTelemetryEvent): void;
}

export const NOOP_JOB_TELEMETRY: JobTelemetry = Object.freeze({ emit: () => undefined });
