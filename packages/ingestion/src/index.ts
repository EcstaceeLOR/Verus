import { createHash, randomBytes } from "node:crypto";

import { parseIngestionRequest, type IngestionRequest } from "@verus/contracts";
import { VerusError } from "@verus/domain";
import { withWorkspaceTransaction, workspaceId, type ScanRecord } from "@verus/persistence";
import type { Pool } from "pg";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const limits = Object.freeze({
  maxRequestBytes: 1_100_000,
  maxTextBytes: 1_000_000,
  maxUploadBytes: 100_000_000,
});

function identifier(prefix: "env" | "job" | "scan"): string {
  const time = BigInt(Date.now());
  const entropy = randomBytes(16);
  let encoded = "";
  let value = time;
  for (let index = 0; index < 10; index += 1) {
    encoded = alphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  for (const byte of entropy) encoded += alphabet[byte & 31];
  return `${prefix}_${encoded.slice(0, 26)}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
function inputMediaType(input: IngestionRequest["input"]): string | undefined {
  return "media_type" in input ? input.media_type : undefined;
}

export interface AcceptedIngestion {
  readonly scan: Readonly<ScanRecord>;
  readonly created: boolean;
}
export class IngestionService {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async accept(trustedWorkspaceId: string, body: unknown): Promise<Readonly<AcceptedIngestion>> {
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > limits.maxRequestBytes)
      throw new VerusError("CONTRACT_VALIDATION_FAILED", "Request exceeds ingestion limit.");
    const request = parseIngestionRequest(body);
    const tenant = workspaceId(trustedWorkspaceId);
    if (request.workspace_id !== tenant)
      throw new VerusError("AUTHORIZATION_DENIED", "Tenant ownership mismatch.");
    if (
      request.input.kind === "text" &&
      Buffer.byteLength(request.input.text, "utf8") > limits.maxTextBytes
    )
      throw new VerusError("CONTRACT_VALIDATION_FAILED", "Text exceeds ingestion limit.");
    if (request.input.kind === "upload" && request.input.size_bytes > limits.maxUploadBytes)
      throw new VerusError("CONTRACT_VALIDATION_FAILED", "Upload exceeds ingestion limit.");
    const requestDigest = digest(request);
    const inputDigest =
      request.input.kind === "upload"
        ? request.input.digest
        : request.input.kind === "feed_event"
          ? request.input.payload_digest
          : digest(request.input);
    const acceptOnce = () =>
      withWorkspaceTransaction(
        this.#pool,
        tenant,
        async (store) => {
          const existing = await store.getScanByIdempotencyKey(request.idempotency_key);
          if (existing !== undefined) {
            if (existing.requestDigest !== requestDigest)
              throw new VerusError("CONFLICT", "Idempotency key has a different request.");
            return Object.freeze({ scan: existing, created: false });
          }
          const scan = await store.createScan({
            scanId: identifier("scan"),
            requestId: request.request_id,
            inputDigest,
            idempotencyKey: request.idempotency_key,
            requestDigest,
          });
          const mediaType = inputMediaType(request.input);
          await store.createIngestionEnvelope({
            envelopeId: identifier("env"),
            scanId: scan.scanId,
            requestId: request.request_id,
            requestDigest,
            inputDigest,
            inputKind: request.input.kind,
            ...(mediaType === undefined ? {} : { mediaType }),
            provenance: request.provenance,
            envelope: request as unknown as Readonly<Record<string, unknown>>,
          });
          const queued = await store.enqueueJob({
            jobId: identifier("job"),
            correlationId: request.request_id,
            queue: "trusted",
            kind: "scan.process",
            envelopeVersion: 1,
            payloadRef: `object://sha256/${inputDigest.slice("sha256:".length)}`,
            idempotencyKey: `scan-process:${scan.scanId}`,
            effectKey: `scan-process:${scan.scanId}`,
            maxAttempts: 3,
            timeoutMs: 15 * 60_000,
            deadlineAt: new Date(Date.now() + 24 * 60 * 60_000),
          });
          if (!queued)
            throw new VerusError("CONFLICT", "A scan-processing job already exists for this scan.");
          const transitioned = await store.transitionScan({
            scanId: scan.scanId,
            expectedVersion: scan.stateVersion,
            from: "accepted",
            to: "queued",
          });
          return Object.freeze({ scan: transitioned, created: true });
        },
        { isolation: "serializable", operationName: "ingestion.accept" },
      );
    try {
      return await acceptOnce();
    } catch (error) {
      if (!(error instanceof VerusError) || error.code !== "CONFLICT") throw error;
      const existing = await withWorkspaceTransaction(
        this.#pool,
        tenant,
        (store) => store.getScanByIdempotencyKey(request.idempotency_key),
        { isolation: "read committed", operationName: "ingestion.idempotency_replay" },
      );
      if (existing === undefined) throw error;
      if (existing.requestDigest !== requestDigest) {
        throw new VerusError("CONFLICT", "Idempotency key has a different request.");
      }
      return Object.freeze({ scan: existing, created: false });
    }
  }
}
export { limits as INGESTION_LIMITS };
export { ScanProcessingService, type ProcessedScan } from "./processing.js";
