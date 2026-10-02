import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueApiKey, SecretValue } from "@verus/crypto";
import { ApiKeyAuthenticator } from "../src/auth.js";
import {
  createPublicApiHandler,
  FixedWindowRateLimiter,
  type ApiPrincipal,
} from "../src/public-api.js";

const principal: ApiPrincipal = {
  workspaceId: "ws_01ARZ3NDEKTSV4RRFFQ69G5FAW",
  keyId: "key_01ARZ3NDEKTSV4RRFFQ69G5FB5",
  scopes: ["scan.read"],
};
async function invoke(path: string, limiter = new FixedWindowRateLimiter(10, 1_000)) {
  const request = Object.assign(new PassThrough(), {
    method: "GET",
    url: path,
    headers: {},
  }) as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  const response = {
    setHeader: () => undefined,
    writeHead: (status: number) => {
      (response as { status: number }).status = status;
    },
    end: (body: string) => chunks.push(Buffer.from(body)),
    status: 0,
  } as unknown as ServerResponse & { status: number };
  const handler = createPublicApiHandler({
    authenticator: { authenticate: async () => principal },
    limiter,
    data: {
      getScan: async () => ({ scan_id: "scan_1", raw_content: "never expose" }),
      listScans: async () => ({ items: [{ scan_id: "scan_1", content: "never expose" }] }),
      getFindings: async () => [],
      getEvidence: async () => [],
      getCapsule: async () => ({ capsule_id: "cap_1" }),
    },
  });
  await handler(request, response, {
    correlationId: "corr_12345678",
    traceId: "trace",
    spanId: "span",
    traceFlags: "01",
  });
  return {
    status: response.status,
    body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
  };
}
describe("public API contract", () => {
  it("paginates and never serializes hostile raw content", async () => {
    const result = await invoke("/v1/scans?limit=25");
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain("never expose");
  });
  it("returns safe problem details for limits and unknown routes", async () => {
    expect((await invoke("/v1/scans?limit=101")).status).toBe(400);
    expect((await invoke("/v1/unknown")).status).toBe(404);
  });
  it("returns retry semantics when rate limited", async () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);
    await invoke("/v1/scans", limiter);
    const result = await invoke("/v1/scans", limiter);
    expect(result.status).toBe(429);
    expect(result.body.code).toBe("RATE_LIMITED");
  });
});
describe("API key authentication", () => {
  it("requires a workspace-bound, scoped bearer token", async () => {
    const pepper = new SecretValue(randomBytes(32));
    try {
      const issued = issueApiKey("key_01ARZ3NDEKTSV4RRFFQ69G5FB5", ["scan.read"], pepper);
      const lookup = { find: async () => issued.metadata, recordUse: async () => undefined };
      const auth = new ApiKeyAuthenticator(lookup, pepper);
      const request = {
        headers: {
          authorization: `Bearer ${issued.revealOnce()}`,
          "x-verus-workspace-id": principal.workspaceId,
        },
      } as unknown as IncomingMessage;
      await expect(auth.authenticate(request, "scan.read")).resolves.toMatchObject({
        workspaceId: principal.workspaceId,
      });
      await expect(auth.authenticate(request, "capsule.read")).rejects.toMatchObject({
        code: "AUTHORIZATION_DENIED",
      });
    } finally {
      pepper.destroy();
    }
  });
});
