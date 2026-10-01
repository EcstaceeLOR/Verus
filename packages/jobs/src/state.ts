export const JOB_STATES = Object.freeze([
  "available",
  "leased",
  "retry_wait",
  "succeeded",
  "dead_lettered",
  "cancelled",
] as const);

export type JobState = (typeof JOB_STATES)[number];

export const JOB_FAILURES = Object.freeze({
  JOB_CANCELLED: { retryable: false },
  JOB_DEADLINE_EXCEEDED: { retryable: false },
  JOB_DEPENDENCY_UNAVAILABLE: { retryable: true },
  JOB_HANDLER_FAILED: { retryable: false },
  JOB_HANDLER_TIMEOUT: { retryable: true },
  JOB_LEASE_EXPIRED: { retryable: true },
  JOB_PAYLOAD_UNAVAILABLE: { retryable: true },
  JOB_UNSUPPORTED_ENVELOPE: { retryable: false },
} as const);

export type JobFailureCode = keyof typeof JOB_FAILURES;

const transitions = Object.freeze({
  available: Object.freeze(["leased", "cancelled", "dead_lettered"]),
  leased: Object.freeze(["leased", "retry_wait", "succeeded", "dead_lettered", "cancelled"]),
  retry_wait: Object.freeze(["leased", "cancelled", "dead_lettered"]),
  succeeded: Object.freeze([]),
  dead_lettered: Object.freeze([]),
  cancelled: Object.freeze([]),
} satisfies Readonly<Record<JobState, readonly JobState[]>>);

export function canTransitionJob(from: JobState, to: JobState): boolean {
  const allowed: readonly JobState[] = transitions[from];
  return allowed.includes(to);
}

export function retryDelayMs(
  attempt: number,
  options: {
    readonly baseMs?: number;
    readonly maximumMs?: number;
  } = {},
): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new TypeError("Invalid job attempt.");
  const baseMs = options.baseMs ?? 1_000;
  const maximumMs = options.maximumMs ?? 15 * 60_000;
  if (!Number.isSafeInteger(baseMs) || baseMs < 1) throw new TypeError("Invalid retry base.");
  if (!Number.isSafeInteger(maximumMs) || maximumMs < baseMs) {
    throw new TypeError("Invalid retry maximum.");
  }
  return Math.min(maximumMs, baseMs * 2 ** Math.min(attempt - 1, 30));
}

export function assertJobFailure(code: string, retryable: boolean): asserts code is JobFailureCode {
  const definition = JOB_FAILURES[code as JobFailureCode];
  if (definition === undefined || definition.retryable !== retryable) {
    throw new TypeError("Job failure code and retry policy do not match.");
  }
}
