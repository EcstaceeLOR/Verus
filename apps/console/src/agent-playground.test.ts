import { describe, expect, it } from "vitest";

import { protectedAgentDelivery, protectedContextPreview } from "./agent-playground.js";
import type { HostedScanResult } from "./scan-workflow.js";

function result(disposition: HostedScanResult["disposition"]): HostedScanResult {
  return {
    scanId: "scan_test",
    disposition,
    findings: [],
    inputDigest: "sha256:" + "a".repeat(64),
    ruleSetDigest: "sha256:" + "b".repeat(64),
    ruleSetVersion: "test",
    processedAt: "2026-10-07T09:00:00.000Z",
  };
}

describe("agent playground trust boundary", () => {
  it("keeps the protected path pending before a scan", () => {
    expect(protectedAgentDelivery().state).toBe("pending");
  });

  it("delivers context only when Verus allows it", () => {
    expect(protectedAgentDelivery(result("allow")).state).toBe("delivered");
    expect(protectedContextPreview("safe text", result("allow"))).toBe("safe text");
  });

  it("withholds review and blocked context from the protected agent", () => {
    expect(protectedAgentDelivery(result("review")).state).toBe("review");
    expect(protectedAgentDelivery(result("block")).state).toBe("withheld");
    expect(protectedContextPreview("hostile", result("block"))).toContain("WITHHELD BY VERUS");
  });
});
