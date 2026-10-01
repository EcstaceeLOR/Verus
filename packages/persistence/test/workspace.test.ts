import { describe, expect, it } from "vitest";

import { canTransitionScan, loadMigrations, workspaceId } from "../src/index.js";

describe("workspace scope", () => {
  it("accepts only canonical workspace identifiers", () => {
    expect(workspaceId("ws_01ARZ3NDEKTSV4RRFFQ69G5FAW")).toBe("ws_01ARZ3NDEKTSV4RRFFQ69G5FAW");
    expect(() => workspaceId("attacker-controlled")).toThrow(TypeError);
  });
});

describe("scan state machine", () => {
  it.each([
    ["accepted", "queued"],
    ["queued", "processing"],
    ["processing", "review"],
    ["review", "allowed"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionScan(from, to)).toBe(true);
  });

  it.each([
    ["accepted", "allowed"],
    ["allowed", "processing"],
    ["blocked", "queued"],
    ["failed", "processing"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransitionScan(from, to)).toBe(false);
  });
});

describe("migration manifest", () => {
  it("loads paired, checksummed migrations in order", async () => {
    const migrations = await loadMigrations();
    expect(migrations.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(migrations[0]?.up).toContain("FORCE ROW LEVEL SECURITY");
    expect(migrations[0]?.down).toContain("DROP TABLE IF EXISTS workspaces");
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(migrations[1]?.up).toContain("verus_revoke_changed_grants");
    expect(migrations[1]?.down).toContain("DROP TABLE IF EXISTS identities");
    expect(migrations[1]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(migrations[2]?.up).toContain("CREATE TABLE api_keys");
    expect(migrations[2]?.down).toContain("DROP TABLE IF EXISTS api_keys");
    expect(migrations[2]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
