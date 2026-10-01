import { createHash } from "node:crypto";

import type { VerusError } from "@verus/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  loadMigrations,
  migrate,
  provisionWorkspace,
  withWorkspaceTransaction,
  workspaceId,
  type Migration,
} from "../src/index.js";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined)
  throw new Error("DATABASE_URL is required for integration tests.");

const adminPool = new Pool({ connectionString, max: 4 });
let appPool: Pool | undefined;
const workspaceA = workspaceId("ws_01ARZ3NDEKTSV4RRFFQ69G5FAW");
const workspaceB = workspaceId("ws_01ARZ3NDEKTSV4RRFFQ69G5FAX");
const scanId = "scan_01ARZ3NDEKTSV4RRFFQ69G5FAY";

function testMigration(version: number, up: string, down: string): Migration {
  return Object.freeze({
    version,
    name: "interruption_test",
    up,
    down,
    checksum: createHash("sha256").update(up).update("\0").update(down).digest("hex"),
  });
}

describe("PostgreSQL persistence", () => {
  beforeAll(async () => {
    const existingMigrations = await loadMigrations();
    for (const migration of [...existingMigrations].reverse()) {
      await adminPool.query(migration.down);
    }
    await adminPool.query("DROP TABLE IF EXISTS verus_schema_migrations CASCADE");
    await adminPool.query("DROP OWNED BY verus_test_app").catch(() => undefined);
    await adminPool.query("DROP ROLE IF EXISTS verus_test_app");
  });

  afterAll(async () => {
    if (appPool !== undefined) await appPool.end();
    await migrate(adminPool, { targetVersion: 0 }).catch(() => undefined);
    await adminPool.query("DROP TABLE IF EXISTS verus_schema_migrations");
    await adminPool.query("DROP OWNED BY verus_test_app").catch(() => undefined);
    await adminPool.query("DROP ROLE IF EXISTS verus_test_app").catch(() => undefined);
    await adminPool.end();
  });

  it("migrates a fresh database and is idempotent for an existing database", async () => {
    const fresh = await migrate(adminPool, {
      telemetry: {
        emit: () => {
          throw new Error("telemetry unavailable");
        },
      },
    });
    expect(fresh).toMatchObject({ fromVersion: 0, toVersion: 1, appliedVersions: [1] });

    const existing = await migrate(adminPool);
    expect(existing).toMatchObject({ fromVersion: 1, toVersion: 1, appliedVersions: [] });

    const tables = await adminPool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN
         ('workspaces', 'scans', 'policies', 'findings', 'evidence_records',
          'jobs', 'key_metadata', 'audit_events', 'outbox_events')`,
    );
    expect(tables.rows).toHaveLength(9);
    const forced = await adminPool.query<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname = 'scans'`,
    );
    expect(forced.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("rolls back an interrupted migration and recovers on retry", async () => {
    const base = await loadMigrations();
    const broken = testMigration(
      2,
      "CREATE TABLE interrupted_marker (id integer); SELECT definitely_not_a_function();",
      "DROP TABLE IF EXISTS interrupted_marker;",
    );
    await expect(
      migrate(adminPool, { targetVersion: 2, migrations: [...base, broken] }),
    ).rejects.toThrow("Migration 2 up failed");
    const absent = await adminPool.query<{ present: null | string }>(
      "SELECT to_regclass('public.interrupted_marker') AS present",
    );
    expect(absent.rows[0]?.present).toBeNull();

    const repaired = testMigration(
      2,
      "CREATE TABLE interrupted_marker (id integer PRIMARY KEY);",
      "DROP TABLE IF EXISTS interrupted_marker;",
    );
    await expect(
      migrate(adminPool, { targetVersion: 2, migrations: [...base, repaired] }),
    ).resolves.toMatchObject({ toVersion: 2, appliedVersions: [2] });
    await expect(
      migrate(adminPool, { targetVersion: 1, migrations: [...base, repaired] }),
    ).resolves.toMatchObject({ toVersion: 1, appliedVersions: [2] });
  });

  it("enforces tenant scope in both repositories and PostgreSQL RLS", async () => {
    await adminPool.query("CREATE ROLE verus_test_app LOGIN PASSWORD 'verus-test-password'");
    await adminPool.query("GRANT USAGE ON SCHEMA public TO verus_test_app");
    await adminPool.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO verus_test_app",
    );
    const appUrl = new URL(connectionString);
    appUrl.username = "verus_test_app";
    appUrl.password = "verus-test-password";
    appPool = new Pool({ connectionString: appUrl.toString(), max: 4 });

    await provisionWorkspace(appPool, {
      workspaceId: workspaceA,
      slug: "tenant-a",
      displayName: "Tenant A",
    });
    await provisionWorkspace(appPool, {
      workspaceId: workspaceB,
      slug: "tenant-b",
      displayName: "Tenant B",
    });
    await expect(
      withWorkspaceTransaction(appPool, workspaceA, (store) => store.getWorkspace(), {
        telemetry: {
          emit: () => {
            throw new Error("telemetry unavailable");
          },
        },
      }),
    ).resolves.toMatchObject({ slug: "tenant-a" });
    await withWorkspaceTransaction(appPool, workspaceA, (store) =>
      store.createScan({
        scanId,
        requestId: "req_01ARZ3NDEKTSV4RRFFQ69G5FAZ",
        inputDigest: `sha256:${"0".repeat(64)}`,
      }),
    );
    await withWorkspaceTransaction(appPool, workspaceA, (store) =>
      store.appendAuditEvent({
        eventId: "event_01ARZ3NDEKTSV4RRFFQ69G5FB0",
        actorType: "system",
        actorId: "verus",
        action: "scan.created",
        targetType: "scan",
        targetId: scanId,
        occurredAt: new Date("2026-10-01T00:00:00.000Z"),
      }),
    );

    await expect(
      withWorkspaceTransaction(appPool, workspaceB, (store) => store.getScan(scanId)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<VerusError>);
    const unscoped = await appPool.query<{ count: string }>("SELECT count(*) FROM scans");
    expect(unscoped.rows[0]?.count).toBe("0");

    const rawClient = await appPool.connect();
    try {
      await rawClient.query("BEGIN");
      await rawClient.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceA]);
      await expect(
        rawClient.query("UPDATE audit_events SET action = 'tampered' WHERE workspace_id = $1", [
          workspaceA,
        ]),
      ).rejects.toMatchObject({ code: "55000" });
      await rawClient.query("ROLLBACK");
    } finally {
      rawClient.release();
    }
  });

  it("uses optimistic concurrency for scan state transitions", async () => {
    if (appPool === undefined) throw new Error("Application pool was not initialized.");
    const queued = await withWorkspaceTransaction(appPool, workspaceA, (store) =>
      store.transitionScan({
        scanId,
        expectedVersion: 0,
        from: "accepted",
        to: "queued",
      }),
    );
    expect(queued).toMatchObject({ state: "queued", stateVersion: 1 });

    await expect(
      withWorkspaceTransaction(appPool, workspaceA, (store) =>
        store.transitionScan({
          scanId,
          expectedVersion: 0,
          from: "accepted",
          to: "cancelled",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<VerusError>);
  });

  it("supports a full rollback and clean re-application", async () => {
    if (appPool === undefined) throw new Error("Application pool was not initialized.");
    await appPool.end();
    appPool = undefined;
    const down = await migrate(adminPool, { targetVersion: 0 });
    expect(down).toMatchObject({ fromVersion: 1, toVersion: 0, appliedVersions: [1] });
    const up = await migrate(adminPool);
    expect(up).toMatchObject({ fromVersion: 0, toVersion: 1, appliedVersions: [1] });
  });
});
