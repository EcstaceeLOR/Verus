import { createServer } from "node:http";

import {
  SafeMetricRegistry,
  StructuredLogger,
  contextFromHeaders,
  propagationHeaders,
  runWithTelemetryContext,
} from "@verus/observability";

import { healthPayload, parsePort } from "./health.js";

const host = process.env.VERUS_API_HOST ?? "127.0.0.1";
const port = parsePort(process.env.VERUS_API_PORT ?? "3001");
const logger = new StructuredLogger("verus-api");
const metrics = new SafeMetricRegistry();

const server = createServer((request, response) => {
  const context = contextFromHeaders(request.headers);
  runWithTelemetryContext(context, () => {
    const startedAt = performance.now();
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    const isHealth =
      request.method === "GET" && ["/health/live", "/health/ready"].includes(requestUrl.pathname);
    const route = isHealth ? requestUrl.pathname.slice(1).replace("/", "_") : "unmatched";
    const status = isHealth ? 200 : 404;
    const propagated = propagationHeaders(context);
    response.setHeader("x-correlation-id", propagated["x-correlation-id"]);
    response.setHeader("traceparent", propagated.traceparent);

    if (isHealth) {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(healthPayload));
    } else {
      response.writeHead(status, { "content-type": "application/problem+json; charset=utf-8" });
      response.end(
        JSON.stringify({
          type: "https://verus.security/problems/not-found",
          title: "Not found",
          status,
          correlation_id: context.correlationId,
        }),
      );
    }

    const outcome = status < 500 ? "success" : "failure";
    const method = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"].includes(
      request.method ?? "",
    )
      ? (request.method as string)
      : "OTHER";
    metrics.increment("verus_http_requests_total", {
      method,
      outcome,
      route,
    });
    logger.emit({
      level: "info",
      event: "request.completed",
      component: "http",
      outcome,
      durationMs: performance.now() - startedAt,
    });
  });
});

server.listen(port, host, () => {
  logger.emit({ level: "info", event: "server.listening", component: "http" });
});

function shutdown(signal: NodeJS.Signals): void {
  server.close((error) => {
    if (error) {
      logger.error("server.shutdown_failed", error, {
        component: "http",
        reasonCode: signal === "SIGINT" ? "SIGINT" : "SIGTERM",
      });
      process.exitCode = 1;
      return;
    }
    logger.emit({
      level: "info",
      event: "server.shutdown_completed",
      component: "http",
      outcome: "success",
      reasonCode: signal === "SIGINT" ? "SIGINT" : "SIGTERM",
    });
    process.exitCode = 0;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
