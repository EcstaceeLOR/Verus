import { toProblemDetails } from "@verus/domain";

import { currentTelemetryContext, type TelemetryContext } from "./context.js";

const NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export type LogLevel = "debug" | "error" | "info" | "warn";
export type LogOutcome = "cancelled" | "failure" | "success";

export interface SafeLogInput {
  readonly level: LogLevel;
  readonly event: string;
  readonly component?: string;
  readonly outcome?: LogOutcome;
  readonly errorCode?: string;
  readonly reasonCode?: string;
  readonly durationMs?: number;
  readonly attempt?: number;
  readonly context?: TelemetryContext;
}

export interface StructuredLogEvent {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly event: string;
  readonly correlation_id?: string;
  readonly trace_id?: string;
  readonly span_id?: string;
  readonly component?: string;
  readonly outcome?: LogOutcome;
  readonly error_code?: string;
  readonly reason_code?: string;
  readonly duration_ms?: number;
  readonly attempt?: number;
}

export type LogSink = (serializedEvent: string) => void;

function validateName(value: string, field: string): void {
  if (!NAME_PATTERN.test(value)) throw new TypeError(`Invalid structured log ${field}.`);
}

function validateCode(value: string, field: string): void {
  if (!CODE_PATTERN.test(value)) throw new TypeError(`Invalid structured log ${field}.`);
}

export class StructuredLogger {
  readonly #service: string;
  readonly #sink: LogSink;
  readonly #clock: () => Date;

  constructor(
    service: string,
    options: { readonly sink?: LogSink; readonly clock?: () => Date } = {},
  ) {
    validateName(service, "service");
    this.#service = service;
    this.#sink = options.sink ?? ((line) => process.stdout.write(`${line}\n`));
    this.#clock = options.clock ?? (() => new Date());
  }

  emit(input: SafeLogInput): void {
    validateName(input.event, "event");
    if (input.component !== undefined) validateName(input.component, "component");
    if (input.errorCode !== undefined) validateCode(input.errorCode, "error code");
    if (input.reasonCode !== undefined) validateCode(input.reasonCode, "reason code");
    if (
      input.durationMs !== undefined &&
      (!Number.isFinite(input.durationMs) || input.durationMs < 0)
    ) {
      throw new TypeError("Invalid structured log duration.");
    }
    if (
      input.attempt !== undefined &&
      (!Number.isSafeInteger(input.attempt) || input.attempt < 1)
    ) {
      throw new TypeError("Invalid structured log attempt.");
    }
    const context = input.context ?? currentTelemetryContext();
    const event: StructuredLogEvent = Object.freeze({
      timestamp: this.#clock().toISOString(),
      level: input.level,
      service: this.#service,
      event: input.event,
      ...(context === undefined
        ? {}
        : {
            correlation_id: context.correlationId,
            trace_id: context.traceId,
            span_id: context.spanId,
          }),
      ...(input.component === undefined ? {} : { component: input.component }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.errorCode === undefined ? {} : { error_code: input.errorCode }),
      ...(input.reasonCode === undefined ? {} : { reason_code: input.reasonCode }),
      ...(input.durationMs === undefined ? {} : { duration_ms: input.durationMs }),
      ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    });
    try {
      this.#sink(JSON.stringify(event));
    } catch {
      // Logging must not alter request, job, or shutdown behavior.
    }
  }

  error(
    event: string,
    error: unknown,
    options: Omit<SafeLogInput, "errorCode" | "event" | "level"> = {},
  ): void {
    const problem = toProblemDetails(error);
    this.emit({ ...options, level: "error", event, errorCode: problem.code, outcome: "failure" });
  }
}
