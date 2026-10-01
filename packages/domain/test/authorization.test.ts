import { describe, expect, it } from "vitest";

import {
  assertAuthorized,
  isAuthorized,
  permissionsForRole,
  type AuthorizationGrant,
} from "../src/index.js";

const workspaceA = "ws_01ARZ3NDEKTSV4RRFFQ69G5FAW";
const workspaceB = "ws_01ARZ3NDEKTSV4RRFFQ69G5FAX";

function humanGrant(
  overrides: Partial<Extract<AuthorizationGrant, { kind: "human" }>> = {},
): Extract<AuthorizationGrant, { kind: "human" }> {
  return {
    kind: "human",
    workspaceId: workspaceA,
    subjectId: "membership_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    role: "reviewer",
    status: "active",
    currentGrantVersion: 4,
    presentedGrantVersion: 4,
    ...overrides,
  };
}

describe("central authorization policy", () => {
  it("fails closed for cross-workspace access", () => {
    expect(isAuthorized(humanGrant(), workspaceB, "scan.read")).toBe(false);
    expect(() => assertAuthorized(humanGrant(), workspaceB, "scan.read")).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_DENIED" }),
    );
  });

  it("invalidates a stale session grant after a role or status change", () => {
    const stale = humanGrant({ currentGrantVersion: 5, presentedGrantVersion: 4 });
    expect(isAuthorized(stale, workspaceA, "scan.read")).toBe(false);
    expect(() => assertAuthorized(stale, workspaceA, "scan.read")).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_DENIED" }),
    );
  });

  it.each(["suspended", "revoked"] as const)("denies a %s grant", (status) => {
    expect(isAuthorized(humanGrant({ status }), workspaceA, "scan.read")).toBe(false);
  });

  it("applies least privilege to human roles", () => {
    expect(permissionsForRole("reviewer", "human")).toContain("review.resolve");
    expect(permissionsForRole("reviewer", "human")).not.toContain("membership.manage");
    expect(permissionsForRole("admin", "human")).not.toContain("workspace.delete");
    expect(permissionsForRole("owner", "human")).toContain("workspace.delete");
  });

  it("keeps service roles distinct from human administration", () => {
    const service: AuthorizationGrant = {
      kind: "service",
      workspaceId: workspaceA,
      subjectId: "svc_01ARZ3NDEKTSV4RRFFQ69G5FB0",
      role: "scan_worker",
      status: "active",
      currentGrantVersion: 2,
      presentedGrantVersion: 2,
    };
    expect(isAuthorized(service, workspaceA, "scan.process")).toBe(true);
    expect(isAuthorized(service, workspaceA, "membership.manage")).toBe(false);
    expect(isAuthorized(service, workspaceA, "review.resolve")).toBe(false);
  });

  it("denies an absent grant", () => {
    expect(() => assertAuthorized(undefined, workspaceA, "workspace.read")).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_DENIED" }),
    );
  });

  it("emits bounded decisions without identifiers and ignores telemetry failure", () => {
    const decisions: unknown[] = [];
    assertAuthorized(humanGrant(), workspaceA, "scan.read", {
      emit: (event) => decisions.push(event),
    });
    expect(decisions).toEqual([
      { action: "scan.read", outcome: "allow", reason: "ALLOW", subjectKind: "human" },
    ]);
    expect(() =>
      assertAuthorized(humanGrant(), workspaceA, "scan.read", {
        emit: () => {
          throw new Error("telemetry unavailable");
        },
      }),
    ).not.toThrow();
  });
});
