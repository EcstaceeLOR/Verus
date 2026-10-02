import type { IncomingMessage, ServerResponse } from "node:http";

import { toProblemDetails, VerusError } from "@verus/domain";
import { withWorkspaceTransaction, workspaceId } from "@verus/persistence";
import type { TelemetryContext } from "@verus/observability";
import type { Pool } from "pg";

import type { TrustedWorkspaceResolver } from "./ingestion.js";

export function createScanCommandHandler(input: {
  readonly pool: Pool;
  readonly resolveWorkspace: TrustedWorkspaceResolver;
}) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    context: TelemetryContext,
  ): Promise<boolean> => {
    const match = /^\/v1\/scans\/([A-Za-z0-9_-]+)\/(cancel|retry)$/u.exec(
      new URL(request.url ?? "/", "http://verus.local").pathname,
    );
    if (request.method !== "POST" || !match) return false;
    try {
      const trusted = input.resolveWorkspace(request);
      if (trusted === undefined)
        throw new VerusError("AUTHENTICATION_REQUIRED", "Trusted tenant context required.");
      const scanId = match[1] as string;
      const action = match[2] as "cancel" | "retry";
      if (action === "retry")
        throw new VerusError(
          "CONFLICT",
          "Retry is unavailable until a retryable worker failure is recorded.",
        );
      const scan = await withWorkspaceTransaction(
        input.pool,
        workspaceId(trusted),
        async (store) => {
          const current = await store.getScan(scanId);
          return store.transitionScan({
            scanId,
            expectedVersion: current.stateVersion,
            from: current.state,
            to: "cancelled",
          });
        },
        { operationName: "scan.cancel" },
      );
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          scan_id: scan.scanId,
          state: scan.state,
          correlation_id: context.correlationId,
        }),
      );
    } catch (error) {
      const problem = toProblemDetails(error, context.correlationId);
      response.writeHead(problem.status, {
        "content-type": "application/problem+json; charset=utf-8",
      });
      response.end(JSON.stringify(problem));
    }
    return true;
  };
}
