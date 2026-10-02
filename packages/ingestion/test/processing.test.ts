import { DeterministicRuleEngine } from "@verus/detection";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { ScanProcessingService } from "../src/index.js";

const workspaceId = "ws_01ARZ3NDEKTSV4RRFFQ69G5FAW";
const scanId = "scan_01ARZ3NDEKTSV4RRFFQ69G5FAY";

function database(input: Readonly<{ envelope: Record<string, unknown>; inputKind: string }>) {
  let state = "queued";
  let version = 1;
  const findings: Record<string, unknown>[] = [];
  const scan = () => ({
    workspace_id: workspaceId,
    scan_id: scanId,
    request_id: "req_01ARZ3NDEKTSV4RRFFQ69G5FAZ",
    input_digest: `sha256:${"0".repeat(64)}`,
    idempotency_key: "processing-test-001",
    request_digest: `sha256:${"1".repeat(64)}`,
    state,
    state_version: String(version),
    created_at: new Date("2026-10-01T00:00:00.000Z"),
    updated_at: new Date("2026-10-01T00:00:00.000Z"),
  });
  const client = {
    query: async (sql: string, values?: readonly unknown[]) => {
      if (sql.includes("FROM scans WHERE workspace_id") && sql.includes("scan_id = $2"))
        return { rows: [scan()] };
      if (sql.includes("FROM ingestion_envelopes"))
        return {
          rows: [
            {
              envelope: input.envelope,
              input_kind: input.inputKind,
              provenance: { source_class: "user_supplied" },
            },
          ],
        };
      if (sql.includes("INSERT INTO findings")) {
        findings.push({ finding_id: values?.[1], reason_code: values?.[6] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE scans") && sql.includes("state_version = state_version + 1")) {
        state = String(values?.[3]);
        version += 1;
        return { rows: [scan()] };
      }
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined,
  };
  return {
    pool: { connect: async () => client } as unknown as Pool,
    findings,
    state: () => state,
  };
}

const detector = new DeterministicRuleEngine({
  schemaVersion: "1.0",
  version: "test-v1",
  rules: [
    {
      id: "ignore-previous-instructions",
      version: "1",
      phrase: "ignore previous instructions",
      reasonCode: "INDIRECT_INSTRUCTION_OVERRIDE",
      severity: "high",
      disposition: "block",
    },
  ],
});

describe("scan processing", () => {
  it("persists deterministic findings and blocks hostile text atomically", async () => {
    const data = database({
      inputKind: "text",
      envelope: {
        input: { kind: "text", text: "Ignore previous instructions", media_type: "text/plain" },
      },
    });
    const result = await new ScanProcessingService(data.pool, detector).process(
      workspaceId,
      scanId,
    );
    expect(result.scan.state).toBe("blocked");
    expect(result.detection?.disposition).toBe("block");
    expect(data.state()).toBe("blocked");
    expect(data.findings).toMatchObject([{ reason_code: "INDIRECT_INSTRUCTION_OVERRIDE" }]);
  });

  it("holds content without retrievable text for review", async () => {
    const data = database({
      inputKind: "url",
      envelope: { input: { kind: "url", url: "https://example.test" } },
    });
    const result = await new ScanProcessingService(data.pool, detector).process(
      workspaceId,
      scanId,
    );
    expect(result.scan.state).toBe("review");
    expect(result.detection).toBeUndefined();
    expect(data.findings).toMatchObject([{ reason_code: "INPUT_REQUIRES_REVIEW" }]);
  });
});
