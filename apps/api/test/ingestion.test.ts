import { PassThrough } from "node:stream";

import type { IncomingMessage, ServerResponse } from "node:http";
import { VerusError } from "@verus/domain";
import { describe, expect, it, vi } from "vitest";

import { createIngestionHandler, type IngestionAcceptor } from "../src/ingestion.js";

const workspaceId = "ws_01ARZ3NDEKTSV4RRFFQ69G5FAW";
const requestBody = {
  schema_version: "1.0",
  request_id: "req_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  workspace_id: workspaceId,
  submitted_at: "2026-10-03T12:00:00.000Z",
  idempotency_key: "public-api-example-001",
  provenance: { source_class: "user_supplied", submitted_by: "api-example" },
  input: { kind: "text", text: "Market conditions remain stable.", media_type: "text/plain" },
  extensions: {},
};

function service(created = true) {
  const accept = vi.fn(async () => ({
    created,
    scan: { scanId: "scan_01ARZ3NDEKTSV4RRFFQ69G5FAX", state: "queued" },
  }));
  return { accept } as unknown as IngestionAcceptor & { accept: typeof accept };
}

async function invoke(
  options: Readonly<{
    body?: unknown;
    created?: boolean;
    publicAuthenticated?: boolean;
    publicAllowed?: boolean;
    trustedWorkspace?: string;
  }> = {},
) {
  const stream = new PassThrough();
  const request = Object.assign(stream, {
    headers: {
      authorization: "Bearer vrk.key_01ARZ3NDEKTSV4RRFFQ69G5FB5.secret",
      "content-type": "application/json",
      "x-verus-workspace-id": workspaceId,
    },
    method: "POST",
    url: "/v1/ingestions",
  }) as unknown as IncomingMessage;
  stream.end(JSON.stringify(options.body ?? requestBody));
  const headers = new Map<string, string>();
  const chunks: Buffer[] = [];
  const response = {
    end: (body: string) => chunks.push(Buffer.from(body)),
    setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
    status: 0,
    writeHead: (status: number, values: Record<string, string> = {}) => {
      response.status = status;
      Object.entries(values).forEach(([name, value]) => headers.set(name.toLowerCase(), value));
    },
  } as unknown as ServerResponse & { status: number };
  const acceptor = service(options.created);
  const authenticate = vi.fn(async () => {
    if (options.publicAuthenticated === false)
      throw new VerusError("AUTHENTICATION_REQUIRED", "API key is unavailable.");
    return {
      keyId: "key_01ARZ3NDEKTSV4RRFFQ69G5FB5",
      scopes: ["scan.create" as const],
      workspaceId,
    };
  });
  const handler = createIngestionHandler({
    service: acceptor,
    resolveWorkspace: () => options.trustedWorkspace,
    publicAuthorization: {
      authenticator: { authenticate },
      limiter: { check: async () => ({ allowed: options.publicAllowed !== false }) },
    },
  });
  await handler(request, response, {
    correlationId: "corr_12345678",
    spanId: "span",
    traceFlags: "01",
    traceId: "trace",
  });
  return {
    authenticate,
    body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
    headers,
    service: acceptor,
    status: response.status,
  };
}

describe("authenticated ingestion API", () => {
  it("accepts a scoped public API key and returns an addressable queued scan", async () => {
    const result = await invoke();
    expect(result.authenticate).toHaveBeenCalledWith(expect.anything(), "scan.create");
    expect(result.service.accept).toHaveBeenCalledWith(workspaceId, requestBody);
    expect(result.status).toBe(202);
    expect(result.headers.get("location")).toBe("/v1/scans/scan_01ARZ3NDEKTSV4RRFFQ69G5FAX");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.body).toMatchObject({
      scan_id: "scan_01ARZ3NDEKTSV4RRFFQ69G5FAX",
      state: "queued",
      idempotent_replay: false,
    });
  });

  it("returns the original scan for an idempotent replay", async () => {
    const result = await invoke({ created: false });
    expect(result.status).toBe(200);
    expect(result.body.idempotent_replay).toBe(true);
  });

  it("retains the trusted service-token path without invoking public authentication", async () => {
    const result = await invoke({ trustedWorkspace: workspaceId });
    expect(result.status).toBe(202);
    expect(result.authenticate).not.toHaveBeenCalled();
  });

  it("fails before persistence when the public request limit is exhausted", async () => {
    const result = await invoke({ publicAllowed: false });
    expect(result.status).toBe(429);
    expect(result.body.code).toBe("RATE_LIMITED");
    expect(result.service.accept).not.toHaveBeenCalled();
  });

  it("fails before persistence when public authentication is unavailable", async () => {
    const result = await invoke({ publicAuthenticated: false });
    expect(result.status).toBe(401);
    expect(result.body.code).toBe("AUTHENTICATION_REQUIRED");
    expect(result.service.accept).not.toHaveBeenCalled();
  });
});
