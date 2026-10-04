import { describe, expect, it, vi } from "vitest";

import {
  VerusClient,
  VerusConfigurationError,
  VerusWaitTimeoutError,
  verifyCapsuleOffline,
} from "../src/index.js";
import { signedCapsule } from "./fixtures.js";

const options = {
  baseUrl: "https://verus.test",
  apiKey: "vrk.secret-value",
  workspaceId: "ws_01ARZ3NDEKTSV4RRFFQ69G5FAW",
};

describe("Verus client", () => {
  it("sends tenant headers and paginates typed records", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ scan_id: "one" }], next: "two" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ scan_id: "two" }] })));
    const client = new VerusClient({ ...options, fetch });
    const scans: unknown[] = [];
    for await (const scan of client.iterateScans()) scans.push(scan);
    expect(scans).toEqual([{ scan_id: "one" }, { scan_id: "two" }]);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer vrk.secret-value",
      "x-verus-workspace-id": options.workspaceId,
    });
  });

  it("retries transient failures with bounded Retry-After but not authorization errors", async () => {
    const sleep = vi.fn(async () => undefined);
    const retry = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "RATE_LIMITED" }), {
          status: 429,
          headers: { "retry-after": "30" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { state: "review" } })));
    await expect(
      new VerusClient({
        ...options,
        fetch: retry,
        sleep,
        maximumRetryDelayMs: 1_500,
      }).status("scan_1"),
    ).resolves.toEqual({ state: "review" });
    expect(sleep).toHaveBeenCalledWith(1_500);

    const denied = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "AUTHORIZATION_DENIED", title: "Access denied" }), {
        status: 403,
      }),
    );
    await expect(
      new VerusClient({ ...options, fetch: denied }).status("scan_1"),
    ).rejects.toMatchObject({ status: 403, retryable: false });
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it("waits for terminal state and exposes a stable timeout error", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { state: "processing" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { state: "allowed" } })));
    const client = new VerusClient({ ...options, fetch, sleep: async () => undefined });
    await expect(client.wait("scan_1", { intervalMs: 1 })).resolves.toEqual({ state: "allowed" });

    const waiting = new VerusClient({
      ...options,
      fetch: vi.fn(async () => new Response(JSON.stringify({ data: { state: "processing" } }))),
      sleep: async () => undefined,
    });
    await expect(waiting.wait("scan_1", { intervalMs: 1, timeoutMs: 1 })).rejects.toBeInstanceOf(
      VerusWaitTimeoutError,
    );
  });

  it("verifies valid and tampered capsules completely offline", async () => {
    const { capsule, key } = await signedCapsule();
    expect(verifyCapsuleOffline(capsule, [key])).toMatchObject({
      valid: true,
      key_id: key.keyId,
    });
    expect(verifyCapsuleOffline({ ...capsule, disposition: "block" }, [key])).toMatchObject({
      valid: false,
      reason: "SIGNATURE_INVALID",
    });
    expect(verifyCapsuleOffline(capsule, [])).toEqual({
      valid: false,
      reason: "SIGNING_KEY_UNAVAILABLE",
    });
  }, 30_000);

  it("requires safe configuration and never serializes credentials", () => {
    expect(() => new VerusClient({ ...options, baseUrl: "http://verus.example" })).toThrow(
      VerusConfigurationError,
    );
    expect(() => new VerusClient({ ...options, baseUrl: "https://user:pass@verus.test" })).toThrow(
      VerusConfigurationError,
    );
    const client = new VerusClient({ ...options, fetch: vi.fn() });
    expect(JSON.stringify(client)).not.toContain(options.apiKey);
  });

  it("emits bounded telemetry without allowing the observer to break requests", async () => {
    const telemetry = vi.fn(() => {
      throw new Error("telemetry unavailable");
    });
    const client = new VerusClient({
      ...options,
      telemetry,
      fetch: vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ data: { state: "allowed" } }))),
    });
    await expect(client.status("scan_sensitive_identifier")).resolves.toEqual({ state: "allowed" });
    expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "GET /v1/scans/:scan_id",
        outcome: "success",
      }),
    );
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("sensitive_identifier");
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain(options.apiKey);
  });

  it("rejects a replay that created a new scan", async () => {
    const client = new VerusClient({
      ...options,
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              scan_id: "scan_1",
              state: "queued",
              idempotent_replay: false,
              correlation_id: "corr_1",
            },
          }),
        ),
      ),
    });
    await expect(client.replay({} as never)).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENT_REPLAY_NOT_FOUND",
    });
  });
});
