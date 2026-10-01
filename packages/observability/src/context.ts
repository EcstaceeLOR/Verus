import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export interface TelemetryContext {
  readonly correlationId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: "00" | "01";
}

const storage = new AsyncLocalStorage<Readonly<TelemetryContext>>();
const CORRELATION_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(00|01)$/;

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function createCorrelationId(): string {
  return `corr_${randomBytes(18).toString("base64url")}`;
}

export function isValidCorrelationId(value: string): boolean {
  return CORRELATION_PATTERN.test(value);
}

export function parseTraceparent(value: string | undefined):
  | Readonly<{
      traceId: string;
      parentSpanId: string;
      traceFlags: "00" | "01";
    }>
  | undefined {
  if (value === undefined) return undefined;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (match === null || /^0+$/.test(match[1] as string) || /^0+$/.test(match[2] as string)) {
    return undefined;
  }
  return Object.freeze({
    traceId: match[1] as string,
    parentSpanId: match[2] as string,
    traceFlags: match[3] as "00" | "01",
  });
}

function header(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  name: string,
): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return typeof value === "string" ? value : value?.[0];
}

export function contextFromHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Readonly<TelemetryContext> {
  const suppliedCorrelation = header(headers, "x-correlation-id");
  const parent = parseTraceparent(header(headers, "traceparent"));
  return Object.freeze({
    correlationId:
      suppliedCorrelation !== undefined && isValidCorrelationId(suppliedCorrelation)
        ? suppliedCorrelation
        : createCorrelationId(),
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    traceFlags: parent?.traceFlags ?? "01",
  });
}

export function childContext(parent: TelemetryContext): Readonly<TelemetryContext> {
  return Object.freeze({ ...parent, spanId: randomHex(8) });
}

export function currentTelemetryContext(): Readonly<TelemetryContext> | undefined {
  return storage.getStore();
}

export function runWithTelemetryContext<T>(context: TelemetryContext, operation: () => T): T {
  return storage.run(Object.freeze({ ...context }), operation);
}

export function propagationHeaders(context: TelemetryContext): Readonly<{
  traceparent: string;
  "x-correlation-id": string;
}> {
  return Object.freeze({
    "x-correlation-id": context.correlationId,
    traceparent: `00-${context.traceId}-${context.spanId}-${context.traceFlags}`,
  });
}
