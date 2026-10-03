import type { IncomingMessage, ServerResponse } from "node:http";

import { toProblemDetails, VerusError } from "@verus/domain";
import { INGESTION_LIMITS, type AcceptedIngestion } from "@verus/ingestion";
import type { TelemetryContext } from "@verus/observability";

import { authorizePublicRequest, type PublicRequestAuthorization } from "./public-api.js";

export type TrustedWorkspaceResolver = (request: IncomingMessage) => string | undefined;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const length = request.headers["content-length"];
  if (
    typeof length === "string" &&
    (!/^\d+$/.test(length) || Number(length) > INGESTION_LIMITS.maxRequestBytes)
  ) {
    throw new VerusError("CONTRACT_VALIDATION_FAILED", "Request exceeds ingestion limit.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > INGESTION_LIMITS.maxRequestBytes)
      throw new VerusError("CONTRACT_VALIDATION_FAILED", "Request exceeds ingestion limit.");
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new VerusError("CONTRACT_VALIDATION_FAILED", "Body must be valid JSON.");
  }
}

export interface IngestionAcceptor {
  accept(workspaceId: string, body: unknown): Promise<Readonly<AcceptedIngestion>>;
}

export function createIngestionHandler(input: {
  readonly service: IngestionAcceptor;
  readonly resolveWorkspace: TrustedWorkspaceResolver;
  readonly publicAuthorization?: PublicRequestAuthorization;
}) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    context: TelemetryContext,
  ): Promise<boolean> => {
    if (
      request.method !== "POST" ||
      new URL(request.url ?? "/", "http://verus.local").pathname !== "/v1/ingestions"
    )
      return false;
    try {
      let workspaceId = input.resolveWorkspace(request);
      if (workspaceId === undefined) {
        if (input.publicAuthorization === undefined)
          throw new VerusError(
            "AUTHENTICATION_REQUIRED",
            "A public API key or trusted service token is required.",
          );
        workspaceId = (
          await authorizePublicRequest(input.publicAuthorization, request, response, "scan.create")
        ).workspaceId;
      }
      const accepted = await input.service.accept(workspaceId, await readJson(request));
      response.writeHead(accepted.created ? 202 : 200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        location: `/v1/scans/${accepted.scan.scanId}`,
      });
      response.end(
        JSON.stringify({
          scan_id: accepted.scan.scanId,
          state: accepted.scan.state,
          idempotent_replay: !accepted.created,
          correlation_id: context.correlationId,
        }),
      );
    } catch (error) {
      const problem = toProblemDetails(error, context.correlationId);
      response.writeHead(problem.status, {
        "cache-control": "no-store",
        "content-type": "application/problem+json; charset=utf-8",
      });
      response.end(JSON.stringify(problem));
    }
    return true;
  };
}
