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
const databaseName = new URL(connectionString).pathname.slice(1);
if (!databaseName.endsWith("_test")) {
  throw new Error("Integration tests require a disposable database whose name ends in _test.");
}

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
    await adminPool.query("DROP OWNED BY verus_test_app").catch(() => undefined);
    await adminPool.query("DROP ROLE IF EXISTS verus_test_app");
    await adminPool.query("DROP SCHEMA public CASCADE");
    await adminPool.query("CREATE SCHEMA public");
    await adminPool.query("GRANT USAGE ON SCHEMA public TO PUBLIC");
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
    expect(fresh).toMatchObject({ fromVersion: 0, toVersion: 2, appliedVersions: [1, 2] });

    const existing = await migrate(adminPool);
    expect(existing).toMatchObject({ fromVersion: 2, toVersion: 2, appliedVersions: [] });

    const tables = await adminPool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN
         ('workspaces', 'scans', 'policies', 'findings', 'evidence_records',
          'jobs', 'key_metadata', 'audit_events', 'outbox_events', 'identities',
          'memberships', 'invitations', 'service_accounts', 'authorization_sessions')`,
    );
    expect(tables.rows).toHaveLength(14);
    const forced = await adminPool.query<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname = 'scans'`,
    );
    expect(forced.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("rolls back an interrupted migration and recovers on retry", async () => {
    const base = await loadMigrations();
    const interruptedVersion = (base.at(-1)?.version ?? 0) + 1;
    const broken = testMigration(
      interruptedVersion,
      "CREATE TABLE interrupted_marker (id integer); SELECT definitely_not_a_function();",
      "DROP TABLE IF EXISTS interrupted_marker;",
    );
    await expect(
      migrate(adminPool, { targetVersion: interruptedVersion, migrations: [...base, broken] }),
    ).rejects.toThrow(`Migration ${interruptedVersion} up failed`);
    const absent = await adminPool.query<{ present: null | string }>(
      "SELECT to_regclass('public.interrupted_marker') AS present",
    );
    expect(absent.rows[0]?.present).toBeNull();

    const repaired = testMigration(
      interruptedVersion,
      "CREATE TABLE interrupted_marker (id integer PRIMARY KEY);",
      "DROP TABLE IF EXISTS interrupted_marker;",
    );
    await expect(
      migrate(adminPool, { targetVersion: interruptedVersion, migrations: [...base, repaired] }),
    ).resolves.toMatchObject({
      toVersion: interruptedVersion,
      appliedVersions: [interruptedVersion],
    });
    await expect(
      migrate(adminPool, { targetVersion: 2, migrations: [...base, repaired] }),
    ).resolves.toMatchObject({ toVersion: 2, appliedVersions: [interruptedVersion] });
  });

  it("enforces tenant scope in both repositories and PostgreSQL RLS", async () => {
    await adminPool.query("CREATE ROLE verus_test_app LOGIN PASSWORD 'verus-test-password'");
    await adminPool.query("GRANT USAGE ON SCHEMA public TO verus_test_app");
    await adminPool.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO verus_test_app",
    );
    await adminPool.query("REVOKE INSERT, UPDATE, DELETE ON identities FROM verus_test_app");
    await adminPool.query(
      "GRANT EXECUTE ON FUNCTION verus_resolve_identity(text, text, text) TO verus_test_app",
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

  it("enforces membership, invitation, session, and service-account lifecycles", async () => {
    if (appPool === undefined) throw new Error("Application pool was not initialized.");
    const digest = (character: string): string => `sha256:${character.repeat(64)}`;
    const ownerIdentityId = "user_01ARZ3NDEKTSV4RRFFQ69G5FB1";
    const ownerMembershipId = "member_01ARZ3NDEKTSV4RRFFQ69G5FB2";
    const ownerSessionId = "session_01ARZ3NDEKTSV4RRFFQ69G5FB3";
    const invitedIdentityId = "user_01ARZ3NDEKTSV4RRFFQ69G5FB4";
    const invitedMembershipId = "member_01ARZ3NDEKTSV4RRFFQ69G5FB5";
    const invitedSessionId = "session_01ARZ3NDEKTSV4RRFFQ69G5FB6";
    const serviceAccountId = "svc_01ARZ3NDEKTSV4RRFFQ69G5FB7";
    const serviceSessionId = "session_01ARZ3NDEKTSV4RRFFQ69G5FB8";
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const occurredAt = new Date("2026-10-01T01:00:00.000Z");

    await withWorkspaceTransaction(appPool, workspaceA, async (store) => {
      const identity = store.identity();
      const resolved = await identity.resolveIdentity({
        identityId: ownerIdentityId,
        provider: "oidc",
        providerSubjectDigest: digest("1"),
      });
      await identity.createOwnerMembership({
        membershipId: ownerMembershipId,
        identityId: resolved,
        auditEventId: "event_01ARZ3NDEKTSV4RRFFQ69G5FB9",
        occurredAt,
      });
      await identity.createHumanSession({
        sessionId: ownerSessionId,
        identityId: ownerIdentityId,
        provider: "oidc",
        providerSubjectDigest: digest("1"),
        expiresAt,
      });
      await identity.createInvitation({
        actorSessionId: ownerSessionId,
        invitationId: "invite_01ARZ3NDEKTSV4RRFFQ69G5FBA",
        emailDigest: digest("2"),
        tokenDigest: digest("3"),
        role: "reviewer",
        expiresAt,
        auditEventId: "event_01ARZ3NDEKTSV4RRFFQ69G5FBB",
        occurredAt,
      });
    });

    await withWorkspaceTransaction(appPool, workspaceA, async (store) => {
      const identity = store.identity();
      await identity.acceptInvitation({
        invitationId: "invite_01ARZ3NDEKTSV4RRFFQ69G5FBA",
        tokenDigest: digest("3"),
        emailDigest: digest("2"),
        identityId: invitedIdentityId,
        provider: "oidc",
        providerSubjectDigest: digest("4"),
        membershipId: invitedMembershipId,
        auditEventId: "event_01ARZ3NDEKTSV4RRFFQ69G5FBC",
        occurredAt,
      });
      await identity.createHumanSession({
        sessionId: invitedSessionId,
        identityId: invitedIdentityId,
        provider: "oidc",
        providerSubjectDigest: digest("4"),
        expiresAt,
      });
      await identity.createServiceAccount({
        actorSessionId: ownerSessionId,
        serviceAccountId,
        displayName: "Scanner",
        role: "scan_worker",
        auditEventId: "event_01ARZ3NDEKTSV4RRFFQ69G5FBD",
        occurredAt,
      });
      await identity.createServiceSession({
        sessionId: serviceSessionId,
        serviceAccountId,
        expiresAt,
      });
    });

    await expect(
      withWorkspaceTransaction(appPool, workspaceB, (store) =>
        store.identity().resolveHumanGrant(ownerSessionId),
      ),
    ).resolves.toBeUndefined();
    await expect(appPool.query("INSERT INTO identities DEFAULT VALUES")).rejects.toMatchObject({
      code: "42501",
    });

    await withWorkspaceTransaction(appPool, workspaceA, async (store) => {
      const identity = store.identity();
      await identity.changeMembership({
        actorSessionId: ownerSessionId,
        membershipId: invitedMembershipId,
        role: "analyst",
        status: "active",
        auditEventId: "event_01ARZ3NDEKTSV4RRFFQ69G5FBE",
        occurredAt,
      });
      expect(await identity.resolveHumanGrant(invitedSessionId)).toBeUndefined();
      await identity.changeServiceAccount({
        actorSessionId: ownerSessionId,
        serviceAccountId,
        role: "audit_exporter",
        status: "suspended",
        auditEventId: "event_01ARZ3NDEKTSV4RRFFQ69G5FBF",
        occurredAt,
      });
      expect(await identity.resolveServiceGrant(serviceSessionId)).toBeUndefined();
    });

    await expect(
      withWorkspaceTransaction(appPool, workspaceA, (store) =>
        store.identity().changeMembership({
          actorSessionId: ownerSessionId,
          membershipId: ownerMembershipId,
          role: "admin",
          status: "active",
          auditEventId: "event_01ARZ3NDEKTSV4RRFFQ69G5FBG",
          occurredAt,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<VerusError>);

    const audited = await adminPool.query<{ count: string }>(
      `SELECT count(*) FROM audit_events
       WHERE workspace_id = $1 AND action IN
         ('membership.invited', 'membership.invitation_accepted', 'membership.changed',
          'service_account.created', 'service_account.changed')`,
      [workspaceA],
    );
    expect(audited.rows[0]?.count).toBe("5");
  });

  it("supports a full rollback and clean re-application", async () => {
    if (appPool === undefined) throw new Error("Application pool was not initialized.");
    await appPool.end();
    appPool = undefined;
    const down = await migrate(adminPool, { targetVersion: 0 });
    expect(down).toMatchObject({ fromVersion: 2, toVersion: 0, appliedVersions: [2, 1] });
    const up = await migrate(adminPool);
    expect(up).toMatchObject({ fromVersion: 0, toVersion: 2, appliedVersions: [1, 2] });
  });
});
