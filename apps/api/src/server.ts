import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";

import {
  SafeMetricRegistry,
  StructuredLogger,
  contextFromHeaders,
  propagationHeaders,
  runWithTelemetryContext,
} from "@verus/observability";
import { IngestionService } from "@verus/ingestion";
import { Pool } from "pg";

import { healthPayload, parsePort } from "./health.js";
import { createIngestionHandler } from "./ingestion.js";
import { createScanCommandHandler } from "./scan-commands.js";
import { applySecurityHeaders } from "./security-headers.js";
import { createUploadHandler } from "./upload.js";

const host = process.env.VERUS_API_HOST ?? "127.0.0.1";
const port = parsePort(process.env.VERUS_API_PORT ?? "3001");
const logger = new StructuredLogger("verus-api");
const metrics = new SafeMetricRegistry();
const databaseUrl = process.env.VERUS_DATABASE_URL;
const internalWorkspace = process.env.VERUS_INTERNAL_WORKSPACE_ID;
const internalToken = process.env.VERUS_INTERNAL_INGESTION_TOKEN;
const quarantineDirectory = process.env.VERUS_QUARANTINE_DIRECTORY;
const enforceHttps = process.env.VERUS_ENFORCE_HTTPS === "true";
const pool =
  databaseUrl === undefined ? undefined : new Pool({ connectionString: databaseUrl, max: 10 });
const resolveInternalWorkspace = (request: IncomingMessage): string | undefined =>
  request.headers["x-verus-internal-token"] === internalToken ? internalWorkspace : undefined;
const ingestion =
  pool === undefined
    ? undefined
    : createIngestionHandler({
        service: new IngestionService(pool),
        resolveWorkspace: resolveInternalWorkspace,
      });
const uploads =
  pool === undefined || quarantineDirectory === undefined
    ? undefined
    : createUploadHandler({
        directory: quarantineDirectory,
        pool,
        resolveWorkspace: resolveInternalWorkspace,
      });
const scanCommands =
  pool === undefined
    ? undefined
    : createScanCommandHandler({ pool, resolveWorkspace: resolveInternalWorkspace });

const server = createServer((request, response) => {
  applySecurityHeaders(response, { https: enforceHttps });
  const context = contextFromHeaders(request.headers);
  void runWithTelemetryContext(context, async () => {
    const startedAt = performance.now();
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    const isHealth =
      request.method === "GET" && ["/health/live", "/health/ready"].includes(requestUrl.pathname);
    if (uploads !== undefined && (await uploads(request, response, context))) return;
    if (ingestion !== undefined && (await ingestion(request, response, context))) return;
    if (scanCommands !== undefined && (await scanCommands(request, response, context))) return;
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
    void pool?.end().finally(() => {
      process.exitCode = 0;
    });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
