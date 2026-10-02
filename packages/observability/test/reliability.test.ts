import { describe, expect, it } from "vitest";
import { assessCapacity, nextDependencyState } from "../src/index.js";
const budget = {
  maximumConcurrentScans: 8,
  maximumQueueDepth: 100,
  maximumScanCostUnits: 20,
  maximumTenantCostUnitsPerHour: 500,
};
describe("capacity and dependency safety", () => {
  it("rejects overload and cost pressure before accepting a scan", () => {
    expect(
      assessCapacity(budget, {
        activeScans: 7,
        queueDepth: 99,
        scanCostUnits: 20,
        tenantCostUnitsThisHour: 479,
      }),
    ).toEqual({ outcome: "accepted" });
    expect(
      assessCapacity(budget, {
        activeScans: 8,
        queueDepth: 0,
        scanCostUnits: 1,
        tenantCostUnitsThisHour: 0,
      }),
    ).toEqual({ outcome: "overloaded", retryAfterSeconds: 30 });
    expect(
      assessCapacity(budget, {
        activeScans: 0,
        queueDepth: 0,
        scanCostUnits: 21,
        tenantCostUnitsThisHour: 0,
      }),
    ).toEqual({ outcome: "cost_limited", retryAfterSeconds: 3600 });
  });
  it("opens, probes, and recovers dependencies without retry storms", () => {
    expect(nextDependencyState("closed", { consecutiveFailures: 3, coolingElapsed: false })).toBe(
      "open",
    );
    expect(nextDependencyState("open", { consecutiveFailures: 3, coolingElapsed: true })).toBe(
      "half_open",
    );
    expect(
      nextDependencyState("half_open", {
        consecutiveFailures: 3,
        coolingElapsed: true,
        probeSucceeded: false,
      }),
    ).toBe("open");
    expect(
      nextDependencyState("half_open", {
        consecutiveFailures: 0,
        coolingElapsed: true,
        probeSucceeded: true,
      }),
    ).toBe("closed");
  });
});
