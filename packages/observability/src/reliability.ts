export interface CapacityBudget {
  readonly maximumConcurrentScans: number;
  readonly maximumQueueDepth: number;
  readonly maximumScanCostUnits: number;
  readonly maximumTenantCostUnitsPerHour: number;
}
export interface CapacitySnapshot {
  readonly activeScans: number;
  readonly queueDepth: number;
  readonly scanCostUnits: number;
  readonly tenantCostUnitsThisHour: number;
}
export type AdmissionOutcome = "accepted" | "cost_limited" | "overloaded";
export type DependencyState = "closed" | "open" | "half_open";

function assertFinite(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError("Capacity values must be non-negative integers.");
}

/** Fails closed before durable acceptance when concurrency, queue, or cost budget is exhausted. */
export function assessCapacity(
  budget: CapacityBudget,
  snapshot: CapacitySnapshot,
): Readonly<{ outcome: AdmissionOutcome; retryAfterSeconds?: number }> {
  for (const value of [...Object.values(budget), ...Object.values(snapshot)]) assertFinite(value);
  if (
    snapshot.scanCostUnits > budget.maximumScanCostUnits ||
    snapshot.tenantCostUnitsThisHour + snapshot.scanCostUnits > budget.maximumTenantCostUnitsPerHour
  )
    return Object.freeze({ outcome: "cost_limited", retryAfterSeconds: 3_600 });
  if (
    snapshot.activeScans >= budget.maximumConcurrentScans ||
    snapshot.queueDepth >= budget.maximumQueueDepth
  )
    return Object.freeze({ outcome: "overloaded", retryAfterSeconds: 30 });
  return Object.freeze({ outcome: "accepted" });
}

/** Stops dependency retry storms; only one cooled-down probe can restore service. */
export function nextDependencyState(
  state: DependencyState,
  input: Readonly<{
    consecutiveFailures: number;
    coolingElapsed: boolean;
    probeSucceeded?: boolean;
  }>,
): DependencyState {
  if (!Number.isSafeInteger(input.consecutiveFailures) || input.consecutiveFailures < 0)
    throw new TypeError("Failure count must be non-negative.");
  if (state === "closed") return input.consecutiveFailures >= 3 ? "open" : "closed";
  if (state === "open") return input.coolingElapsed ? "half_open" : "open";
  return input.probeSucceeded === true ? "closed" : "open";
}
