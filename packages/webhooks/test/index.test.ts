import { describe, expect, it, vi } from "vitest";
import {
  createSignatureHeaders,
  FetchWebhookTransport,
  InMemoryDeliveryStore,
  InMemoryReplayWindow,
  validateWebhookEndpoint,
  verifyWebhook,
  WebhookDispatcher,
  type WebhookTelemetryEvent,
  type WebhookTransport,
} from "../src/index.js";

const currentKey = { keyId: "key_current", secret: "current-secret-material-is-at-least-32-bytes" };
const retiringKey = {
  keyId: "key_retiring",
  secret: "retiring-secret-material-is-at-least-32-bytes",
};
const signedAt = new Date("2026-10-04T08:00:00.000Z");

describe("webhook receiver verification", () => {
  it("accepts a retiring key once and rejects replay", async () => {
    const body =
      '{"audience":"agent.example","data":{},"delivery_id":"whd_123","event_id":"evt_123","event_type":"scan.completed","occurred_at":"2026-10-04T08:00:00.000Z","schema_version":"1.0"}';
    const headers = createSignatureHeaders({
      attempt: 2,
      body,
      deliveryId: "whd_123",
      key: retiringKey,
      now: signedAt,
    });
    const replayWindow = new InMemoryReplayWindow(() => signedAt.getTime());
    await expect(
      verifyWebhook({
        audience: "agent.example",
        body,
        headers,
        keys: [currentKey, retiringKey],
        now: signedAt,
        replayWindow,
      }),
    ).resolves.toMatchObject({ attempt: 2, deliveryId: "whd_123", keyId: "key_retiring" });
    await expect(
      verifyWebhook({
        audience: "agent.example",
        body,
        headers,
        keys: [currentKey, retiringKey],
        now: signedAt,
        replayWindow,
      }),
    ).rejects.toMatchObject({ code: "REPLAYED_DELIVERY" });
  });
  it("rejects tampering, stale timestamps, and the wrong audience", async () => {
    const body =
      '{"audience":"agent.example","data":{},"delivery_id":"whd_456","event_id":"evt_456","event_type":"scan.completed","occurred_at":"2026-10-04T08:00:00.000Z","schema_version":"1.0"}';
    const headers = createSignatureHeaders({
      attempt: 1,
      body,
      deliveryId: "whd_456",
      key: currentKey,
      now: signedAt,
    });
    const replayWindow = new InMemoryReplayWindow(() => signedAt.getTime());
    await expect(
      verifyWebhook({
        audience: "agent.example",
        body: `${body} `,
        headers,
        keys: [currentKey],
        now: signedAt,
        replayWindow,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    await expect(
      verifyWebhook({
        audience: "other.example",
        body,
        headers,
        keys: [currentKey],
        now: signedAt,
        replayWindow,
      }),
    ).rejects.toMatchObject({ code: "AUDIENCE_MISMATCH" });
    await expect(
      verifyWebhook({
        audience: "agent.example",
        body,
        headers,
        keys: [currentKey],
        now: new Date(signedAt.getTime() + 301_000),
        replayWindow,
      }),
    ).rejects.toMatchObject({ code: "EXPIRED_SIGNATURE" });
  });
});

describe("durable webhook dispatch", () => {
  it("deduplicates, retries retryable responses, signs each attempt, and delivers", async () => {
    let now = new Date(signedAt);
    const store = new InMemoryDeliveryStore();
    const attempts: Array<Readonly<{ body: string; headers: Readonly<Record<string, string>> }>> =
      [];
    const telemetry: WebhookTelemetryEvent[] = [];
    const transport: WebhookTransport = {
      send: async (_delivery, input) => {
        attempts.push(input);
        return attempts.length === 1 ? { status: 503, retryAfterSeconds: 2 } : { status: 204 };
      },
    };
    const dispatcher = new WebhookDispatcher({
      audience: "agent.example",
      endpointId: "wh_ep",
      endpointUrl: "https://hooks.example/verus",
      key: currentKey,
      now: () => now,
      onTelemetry: (event) => telemetry.push(event),
      random: () => 0.5,
      store,
      transport,
      workspaceId: "ws_example",
    });
    const event = {
      data: { disposition: "review" },
      eventId: "evt_123",
      eventType: "scan.completed",
      occurredAt: signedAt.toISOString(),
      orderingKey: "scan_123",
      sequence: 7,
    } as const;
    const queued = await dispatcher.enqueue(event, { deliveryId: "whd_delivery_123" });
    await expect(dispatcher.enqueue(event, { deliveryId: "whd_different" })).resolves.toMatchObject(
      { status: "duplicate" },
    );
    await expect(dispatcher.runOnce()).resolves.toBe("retry");
    await expect(dispatcher.runOnce()).resolves.toBe("idle");
    now = new Date(signedAt.getTime() + 2_001);
    await expect(dispatcher.runOnce()).resolves.toBe("delivered");
    expect(await store.get("ws_example", queued.deliveryId)).toMatchObject({
      attempt: 2,
      state: "delivered",
    });
    expect(attempts.map(({ headers }) => headers["x-verus-attempt"])).toEqual(["1", "2"]);
    expect(telemetry.map(({ name }) => name)).toEqual([
      "webhook.queued",
      "webhook.delivery_failed",
      "webhook.delivered",
    ]);
    expect(JSON.stringify(telemetry)).not.toContain("ws_example");
  });
  it("dead-letters permanent failures, permits explicit replay, and rejects sensitive payloads", async () => {
    const store = new InMemoryDeliveryStore();
    const dispatcher = new WebhookDispatcher({
      audience: "agent.example",
      endpointId: "wh_ep",
      endpointUrl: "https://hooks.example/verus",
      key: currentKey,
      maxAttempts: 2,
      now: () => signedAt,
      store,
      transport: { send: async () => ({ status: 400 }) },
      workspaceId: "ws_example",
    });
    const original = await dispatcher.enqueue(
      {
        data: { reason_code: "POLICY_BLOCK" },
        eventId: "evt_block",
        eventType: "scan.blocked",
        occurredAt: signedAt.toISOString(),
      },
      { deliveryId: "whd_block" },
    );
    await expect(dispatcher.runOnce()).resolves.toBe("dead_letter");
    const replay = await dispatcher.replay(original.deliveryId, "Operator approved replay");
    expect(replay).toMatchObject({ status: "queued" });
    expect(await store.get("ws_example", replay.deliveryId)).toMatchObject({
      replayOf: "whd_block",
      replayReason: "Operator approved replay",
    });
    await expect(
      dispatcher.enqueue({
        data: { raw_content: "hostile source" },
        eventId: "evt_unsafe",
        eventType: "scan.completed",
        occurredAt: signedAt.toISOString(),
      }),
    ).rejects.toThrow("forbidden field");
  });

  it("recovers expired claims without violating an ordering key", async () => {
    const store = new InMemoryDeliveryStore();
    const dispatcher = new WebhookDispatcher({
      audience: "agent.example",
      endpointId: "wh_ep",
      endpointUrl: "https://hooks.example/verus",
      key: currentKey,
      now: () => signedAt,
      store,
      transport: { send: async () => ({ status: 204 }) },
      workspaceId: "ws_example",
    });
    await dispatcher.enqueue(
      {
        data: {},
        eventId: "evt_order_1",
        eventType: "scan.started",
        occurredAt: signedAt.toISOString(),
        orderingKey: "scan_ordered",
        sequence: 1,
      },
      { deliveryId: "whd_order_1" },
    );
    await dispatcher.enqueue(
      {
        data: {},
        eventId: "evt_order_2",
        eventType: "scan.completed",
        occurredAt: signedAt.toISOString(),
        orderingKey: "scan_ordered",
        sequence: 2,
      },
      { deliveryId: "whd_order_2" },
    );
    const leaseEnd = new Date(signedAt.getTime() + 30_000);
    await expect(store.claim("ws_example", signedAt, leaseEnd)).resolves.toMatchObject({
      attempt: 1,
      deliveryId: "whd_order_1",
    });
    await expect(
      store.claim(
        "ws_example",
        new Date(signedAt.getTime() + 1_000),
        new Date(signedAt.getTime() + 31_000),
      ),
    ).resolves.toBeUndefined();
    const recovered = await store.claim(
      "ws_example",
      new Date(signedAt.getTime() + 30_001),
      new Date(signedAt.getTime() + 60_001),
    );
    expect(recovered).toMatchObject({ attempt: 2, deliveryId: "whd_order_1" });
    await store.delivered("ws_example", "whd_order_1", new Date(), 204);
    await expect(
      store.claim(
        "ws_example",
        new Date(signedAt.getTime() + 30_002),
        new Date(signedAt.getTime() + 60_002),
      ),
    ).resolves.toMatchObject({ deliveryId: "whd_order_2" });
  });
});

describe("webhook transport policy", () => {
  it("requires a public allowlisted HTTPS endpoint and disables redirects", async () => {
    expect(() => validateWebhookEndpoint("http://hooks.example/verus")).toThrow();
    expect(() => validateWebhookEndpoint("https://127.0.0.1/verus")).toThrow();
    expect(() =>
      validateWebhookEndpoint("https://other.example/verus", new Set(["hooks.example"])),
    ).toThrow();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const transport = new FetchWebhookTransport({
      allowedHosts: new Set(["hooks.example"]),
      fetch,
    });
    await transport.send(
      {
        attempt: 1,
        audience: "agent.example",
        body: "{}",
        createdAt: signedAt,
        deliveryId: "whd_1",
        endpointId: "wh_ep",
        endpointUrl: "https://hooks.example/verus",
        eventId: "evt_1",
        eventType: "scan.completed",
        idempotencyKey: "idem_1",
        maxAttempts: 8,
        nextAttemptAt: signedAt,
        state: "delivering",
        workspaceId: "ws_example",
      },
      { body: "{}", headers: {} },
    );
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://hooks.example/verus"),
      expect.objectContaining({ method: "POST", redirect: "manual" }),
    );
  });
});
