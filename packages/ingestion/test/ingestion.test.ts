import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { IngestionService } from "../src/index.js";

const workspaceId = "ws_01ARZ3NDEKTSV4RRFFQ69G5FAW";
const request = Object.freeze({
  schema_version: "1.0",
  request_id: "req_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  workspace_id: workspaceId,
  submitted_at: "2026-10-01T09:30:00.000Z",
  idempotency_key: "ingestion-test-001",
  provenance: { source_class: "user_supplied", submitted_by: "test" },
  input: { kind: "text", text: "Market context", media_type: "text/plain" },
  extensions: {},
});

function pool(): Pool {
  const jobs: Record<string, unknown>[] = [];
  let scan: Record<string, unknown> | undefined;
  const client = {
    query: async (sql: string, values?: readonly unknown[]) => {
      if (sql.includes("FROM scans WHERE workspace_id") && sql.includes("idempotency_key"))
        return { rows: scan === undefined ? [] : [scan] };
      if (sql.includes("INSERT INTO scans")) {
        scan = {
          workspace_id: workspaceId,
          scan_id: values?.[1],
          request_id: values?.[2],
          input_digest: values?.[3],
          idempotency_key: values?.[4],
          request_digest: values?.[5],
          state: "accepted",
          state_version: "0",
          created_at: new Date(),
          updated_at: new Date(),
        };
        return { rows: [scan] };
      }
      if (sql.includes("INSERT INTO jobs")) {
        jobs.push({
          job_id: values?.[1],
          kind: values?.[4],
          payload_ref: values?.[6],
          idempotency_key: values?.[7],
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE scans") && sql.includes("state_version = state_version + 1")) {
        if (scan === undefined) return { rows: [] };
        scan = { ...scan, state: values?.[3], state_version: "1", updated_at: new Date() };
        return { rows: [scan] };
      }
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined,
  };
  return Object.assign({ connect: async () => client }, { jobs }) as unknown as Pool;
}

describe("ingestion acceptance", () => {
  it("creates one immutable-digest scan and resolves an exact idempotent replay", async () => {
    const database = pool() as Pool & { jobs: Record<string, unknown>[] };
    const service = new IngestionService(database);
    const first = await service.accept(workspaceId, request);
    const replay = await service.accept(workspaceId, request);
    expect(first.created).toBe(true);
    expect(first.scan.state).toBe("queued");
    expect(first.scan.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(database.jobs).toMatchObject([
      {
        kind: "scan.process",
        idempotency_key: `scan-process:${first.scan.scanId}`,
        payload_ref: `object://sha256/${first.scan.inputDigest.slice("sha256:".length)}`,
      },
    ]);
    expect(replay).toMatchObject({ created: false, scan: { scanId: first.scan.scanId } });
  });

  it("does not allow a caller to submit into another tenant", async () => {
    await expect(
      new IngestionService(pool()).accept("ws_01ARZ3NDEKTSV4RRFFQ69G5FAX", request),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("rejects malformed or oversized input before persistence", async () => {
    await expect(
      new IngestionService(pool()).accept(workspaceId, {
        ...request,
        input: { kind: "text", text: "x".repeat(1_000_001), media_type: "text/plain" },
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_VALIDATION_FAILED" });
  });
});
