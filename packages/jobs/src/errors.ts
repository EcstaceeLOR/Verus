export type JobQueueErrorCode =
  | "JOB_CONFLICT"
  | "JOB_INVALID_INPUT"
  | "JOB_LOST_LEASE"
  | "JOB_NOT_FOUND"
  | "JOB_STORAGE_UNAVAILABLE";

export class JobQueueError extends Error {
  readonly code: JobQueueErrorCode;

  constructor(code: JobQueueErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JobQueueError";
    this.code = code;
  }
}
