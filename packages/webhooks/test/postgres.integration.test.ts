import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDeliveryStore, type DeliveryRecord } from "../src/index.js";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined)
  throw new Error("DATABASE_URL is required for integration tests.");
if (!new URL(connectionString).pathname.slice(1).endsWith("_test"))
  throw new Error("Integration tests require a disposable database whose name ends in _test.");

const pool = new Pool({ connectionString, max: 3 });
const store = new PostgresDeliveryStore(pool);
const workspaceId = "ws_01ARZ3NDEKTSV4RRFFQ69G5FZZ";
const now = new Date("2026-10-04T08:00:00.000Z");

function record(): DeliveryRecord {
  return Object.freeze({
    attempt: 0,
    audience: "agent.example",
    body: '{"audience":"agent.example","data":{},"delivery_id":"whd_pg_1","event_id":"evt_pg_1","event_type":"scan.completed","occurred_at":"2026-10-04T08:00:00.000Z","schema_version":"1.0"}',
    createdAt: now,
    deliveryId: "whd_pg_1",
    endpointId: "wh_ep_pg",
    endpointUrl: "https://hooks.example/verus",
    eventId: "evt_pg_1",
    eventType: "scan.completed",
    idempotencyKey: "agent.example:evt_pg_1",
    maxAttempts: 8,
    nextAttemptAt: now,
    orderingKey: "scan_pg_1",
    sequence: 1,
    state: "pending",
    workspaceId,
  });
}

describe("PostgreSQL webhook delivery store", () => {
  beforeAll(async () => {
    await pool.query("DELETE FROM webhook_deliveries WHERE workspace_id=$1", [workspaceId]);
    await pool.query("DELETE FROM workspaces WHERE workspace_id=$1", [workspaceId]);
    await pool.query(
      "INSERT INTO workspaces (workspace_id, slug, display_name) VALUES ($1, 'webhook-integration', 'Webhook Integration')",
      [workspaceId],
    );
  });
  afterAll(async () => {
    await pool.query("DELETE FROM webhook_deliveries WHERE workspace_id=$1", [workspaceId]);
    await pool.query("DELETE FROM workspaces WHERE workspace_id=$1", [workspaceId]);
    await pool.end();
  });

  it("persists idempotency, retry state, leases, and completion", async () => {
    await expect(store.enqueue(record())).resolves.toBe("queued");
    await expect(store.enqueue({ ...record(), deliveryId: "whd_pg_duplicate" })).resolves.toBe(
      "duplicate",
    );
    const first = await store.claim(workspaceId, now, new Date(now.getTime() + 30_000));
    expect(first).toMatchObject({ attempt: 1, deliveryId: "whd_pg_1", state: "delivering" });
    await store.failed(workspaceId, "whd_pg_1", {
      errorCode: "HTTP_503",
      nextAttemptAt: new Date(now.getTime() + 1_000),
      status: 503,
      terminal: false,
    });
    await expect(
      store.claim(workspaceId, now, new Date(now.getTime() + 30_000)),
    ).resolves.toBeUndefined();
    const second = await store.claim(
      workspaceId,
      new Date(now.getTime() + 1_001),
      new Date(now.getTime() + 31_001),
    );
    expect(second).toMatchObject({ attempt: 2, state: "delivering" });
    await store.delivered(workspaceId, "whd_pg_1", new Date(now.getTime() + 1_002), 204);
    await expect(store.get(workspaceId, "whd_pg_1")).resolves.toMatchObject({
      attempt: 2,
      state: "delivered",
    });
  });
});
