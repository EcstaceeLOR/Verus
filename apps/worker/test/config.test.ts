import { describe, expect, it } from "vitest";

import { parseWorkerRuntimeConfig } from "../src/config.js";

const environment = {
  VERUS_DATABASE_URL: "postgresql://verus:verus@localhost:5432/verus",
  VERUS_WORKER_WORKSPACE_ID: "ws_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  VERUS_WORKER_POLICY_ID: "policy_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  VERUS_WORKER_RULESET_JSON: JSON.stringify({
    schemaVersion: "1.0",
    version: "2026-10-03",
    rules: [],
  }),
  VERUS_WORKER_SECRETS_DIRECTORY: "C:\\verus\\secrets",
  VERUS_WORKER_SEALING_MASTER_KEY: "a".repeat(43),
  VERUS_WORKER_ID: "worker-test",
};

describe("worker runtime configuration", () => {
  it("requires a valid detector ruleset before startup", () => {
    expect(parseWorkerRuntimeConfig(environment)).toMatchObject({
      workspaceId: environment.VERUS_WORKER_WORKSPACE_ID,
      policyId: environment.VERUS_WORKER_POLICY_ID,
    });
    expect(() =>
      parseWorkerRuntimeConfig({
        ...environment,
        VERUS_WORKER_RULESET_JSON: JSON.stringify({ schemaVersion: "1.0", version: "bad" }),
      }),
    ).toThrow("Worker database URL or detector rules are invalid.");
  });
});
