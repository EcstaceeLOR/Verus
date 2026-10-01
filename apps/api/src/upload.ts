import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { toProblemDetails, VerusError } from "@verus/domain";
import { withWorkspaceTransaction, workspaceId } from "@verus/persistence";
import { EicarSafetyScanner, FileSystemQuarantineStore } from "@verus/quarantine";
import type { TelemetryContext } from "@verus/observability";
import type { Pool } from "pg";

import type { TrustedWorkspaceResolver } from "./ingestion.js";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function uploadId(): string {
  return `upload_${[...randomBytes(26)].map((byte) => alphabet[byte & 31]).join("")}`;
}

export function createUploadHandler(input: {
  readonly directory: string;
  readonly pool: Pool;
  readonly resolveWorkspace: TrustedWorkspaceResolver;
}) {
  const store = new FileSystemQuarantineStore(input.directory);
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    context: TelemetryContext,
  ): Promise<boolean> => {
    if (
      request.method !== "POST" ||
      new URL(request.url ?? "/", "http://verus.local").pathname !== "/v1/uploads"
    )
      return false;
    try {
      const trusted = input.resolveWorkspace(request);
      if (trusted === undefined)
        throw new VerusError("AUTHENTICATION_REQUIRED", "Trusted tenant context required.");
      const declaredMediaType =
        typeof request.headers["content-type"] === "string"
          ? request.headers["content-type"].split(";", 1)[0]
          : undefined;
      if (declaredMediaType === undefined)
        throw new VerusError("CONTRACT_VALIDATION_FAILED", "Content-Type is required.");
      const uploaded = await store.ingest({
        declaredMediaType,
        scanner: new EicarSafetyScanner(),
        stream: request,
      });
      const id = uploadId();
      const tenant = workspaceId(trusted);
      await withWorkspaceTransaction(
        input.pool,
        tenant,
        (persistence) =>
          persistence.createQuarantineUpload({
            uploadId: id,
            objectRef: uploaded.objectRef,
            digest: uploaded.digest,
            declaredMediaType,
            detectedMediaType: uploaded.mediaType,
            sizeBytes: uploaded.sizeBytes,
            state: uploaded.state,
            ...(uploaded.state === "clean" ? {} : { failureCode: uploaded.state.toUpperCase() }),
            retentionUntil: new Date(uploaded.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000),
          }),
        { operationName: "upload.quarantine" },
      );
      response.writeHead(uploaded.state === "clean" ? 202 : 422, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({
          upload_id: id,
          quarantine_state: uploaded.state,
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
