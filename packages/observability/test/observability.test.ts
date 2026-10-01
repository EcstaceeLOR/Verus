import { VerusError } from "@verus/domain";
import { describe, expect, it } from "vitest";

import {
  SafeMetricRegistry,
  StructuredLogger,
  childContext,
  contextFromHeaders,
  currentTelemetryContext,
  parseTraceparent,
  propagationHeaders,
  runWithTelemetryContext,
} from "../src/index.js";

describe("telemetry context", () => {
  it("continues valid correlation and trace context across asynchronous work", async () => {
    const context = contextFromHeaders({
      "x-correlation-id": "corr_external_1234",
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    });
    expect(context).toMatchObject({
      correlationId: "corr_external_1234",
      traceId: "0123456789abcdef0123456789abcdef",
      traceFlags: "01",
    });
    await runWithTelemetryContext(context, async () => {
      await Promise.resolve();
      expect(currentTelemetryContext()).toEqual(context);
    });
    const child = childContext(context);
    expect(child.correlationId).toBe(context.correlationId);
    expect(child.traceId).toBe(context.traceId);
    expect(child.spanId).not.toBe(context.spanId);
    expect(propagationHeaders(child)).toEqual({
      "x-correlation-id": context.correlationId,
      traceparent: `00-${context.traceId}-${child.spanId}-01`,
    });
  });

  it("replaces malformed or all-zero external identifiers", () => {
    const context = contextFromHeaders({
      "x-correlation-id": "secret with spaces",
      traceparent: "00-00000000000000000000000000000000-0000000000000000-01",
    });
    expect(context.correlationId).toMatch(/^corr_[A-Za-z0-9_-]{24}$/);
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parseTraceparent("unsupported")).toBeUndefined();
  });
});

describe("structured logger", () => {
  it("emits only allowlisted fields and correlation metadata", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger("verus-api", {
      sink: (line) => lines.push(line),
      clock: () => new Date("2026-10-01T00:00:00.000Z"),
    });
    const context = contextFromHeaders({ "x-correlation-id": "corr_safe_123456" });
    runWithTelemetryContext(context, () => {
      logger.emit({
        level: "info",
        event: "request.completed",
        component: "http",
        outcome: "success",
        durationMs: 12.5,
      });
    });
    expect(JSON.parse(lines[0] as string)).toEqual(
      expect.objectContaining({
        service: "verus-api",
        event: "request.completed",
        correlation_id: context.correlationId,
        trace_id: context.traceId,
        duration_ms: 12.5,
      }),
    );
  });

  it("maps errors to stable codes without serializing messages, causes, or payloads", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger("verus-worker", { sink: (line) => lines.push(line) });
    const hostile = "API_KEY=very-secret <script>alert(1)</script>";
    logger.error(
      "job.failed",
      new VerusError("SERVICE_UNAVAILABLE", hostile, { cause: new Error(hostile) }),
      { component: "worker" },
    );
    expect(lines[0]).toContain("SERVICE_UNAVAILABLE");
    expect(lines[0]).not.toContain("very-secret");
    expect(lines[0]).not.toContain("script");
  });

  it("isolates sink failures and rejects unsafe free-form fields", () => {
    const logger = new StructuredLogger("verus-api", {
      sink: () => {
        throw new Error("collector unavailable");
      },
    });
    expect(() => logger.emit({ level: "info", event: "request.completed" })).not.toThrow();
    expect(() => logger.emit({ level: "info", event: "raw content" })).toThrow(TypeError);
  });
});

describe("safe metrics", () => {
  it("uses fixed low-cardinality labels and OpenMetrics output", () => {
    const metrics = new SafeMetricRegistry();
    expect(
      metrics.increment("verus_http_requests_total", {
        method: "GET",
        outcome: "success",
        route: "health_ready",
      }),
    ).toBe(true);
    metrics.observe("verus_scan_duration_ms", { outcome: "success", stage: "policy" }, 42);
    const output = metrics.renderOpenMetrics();
    expect(output).toContain("verus_http_requests_total");
    expect(output).toContain('route="health_ready"');
    expect(output).toContain('le="50"');
    expect(output.endsWith("# EOF\n")).toBe(true);
  });

  it("rejects identifier labels and bounds series cardinality", () => {
    const metrics = new SafeMetricRegistry({ maximumSeriesPerMetric: 1 });
    expect(() =>
      metrics.increment("verus_failures_total", {
        component: "worker",
        error_code: "bad value with spaces",
      }),
    ).toThrow("Invalid metric label value");
    expect(
      metrics.increment("verus_failures_total", {
        component: "worker",
        error_code: "INTERNAL_ERROR",
      }),
    ).toBe(true);
    expect(
      metrics.increment("verus_failures_total", {
        component: "api",
        error_code: "INTERNAL_ERROR",
      }),
    ).toBe(false);
    expect(() =>
      metrics.increment("verus_failures_total", { component: "worker", tenant_id: "tenant-a" }),
    ).toThrow("fixed definition");
  });
});
