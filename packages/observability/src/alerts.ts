import { isValidCorrelationId } from "./context.js";

export type AlertSeverity = "page" | "ticket";

export interface OperationalSnapshot {
  readonly availabilityBurnRate1h: number;
  readonly availabilityBurnRate3d: number;
  readonly availabilityBurnRate6h: number;
  readonly auditCommitHealthy: boolean;
  readonly deadLetterGrowthPerHour: number;
  readonly maintenanceActive: boolean;
  readonly oldestReadyAgeSeconds: number;
  readonly telemetryAgeSeconds: number;
}

export interface OperationalAlert {
  readonly id: string;
  readonly owner: "platform-on-call" | "security-on-call";
  readonly runbook: string;
  readonly severity: AlertSeverity;
}

const ALERTS = Object.freeze({
  availability_burn: {
    owner: "platform-on-call",
    runbook: "docs/operations/observability.md#availability-and-telemetry",
    severity: "page",
  },
  audit_commit_failed: {
    owner: "security-on-call",
    runbook: "docs/operations/observability.md#audit-commit-failure",
    severity: "page",
  },
  dead_letter_growth: {
    owner: "platform-on-call",
    runbook: "docs/operations/durable-jobs.md#telemetry-and-alerts",
    severity: "page",
  },
  error_budget_burn: {
    owner: "platform-on-call",
    runbook: "docs/operations/observability.md#availability-and-telemetry",
    severity: "ticket",
  },
  queue_backlog: {
    owner: "platform-on-call",
    runbook: "docs/operations/durable-jobs.md#telemetry-and-alerts",
    severity: "page",
  },
  telemetry_stale: {
    owner: "platform-on-call",
    runbook: "docs/operations/observability.md#availability-and-telemetry",
    severity: "page",
  },
} as const satisfies Record<string, Omit<OperationalAlert, "id">>);

export type DiagnosticStage =
  "api" | "evidence" | "model" | "parser" | "policy" | "queue" | "worker";
export type DiagnosticOutcome = "failure" | "in_progress" | "success";

export interface DiagnosticStep {
  readonly outcome: DiagnosticOutcome;
  readonly stage: DiagnosticStage;
}

const STAGES = new Set<DiagnosticStage>([
  "api",
  "queue",
  "worker",
  "parser",
  "model",
  "policy",
  "evidence",
]);

function assertFiniteNonNegative(snapshot: OperationalSnapshot): void {
  for (const value of [
    snapshot.availabilityBurnRate1h,
    snapshot.availabilityBurnRate3d,
    snapshot.availabilityBurnRate6h,
    snapshot.deadLetterGrowthPerHour,
    snapshot.oldestReadyAgeSeconds,
    snapshot.telemetryAgeSeconds,
  ]) {
    if (!Number.isFinite(value) || value < 0)
      throw new TypeError("Operational signals must be finite and non-negative.");
  }
}

function alert(id: keyof typeof ALERTS): OperationalAlert {
  return Object.freeze({ id, ...ALERTS[id] });
}

/** Evaluates fixed, low-noise production alert thresholds from aggregate signals only. */
export function evaluateOperationalAlerts(
  snapshot: OperationalSnapshot,
): readonly OperationalAlert[] {
  assertFiniteNonNegative(snapshot);
  const triggered: OperationalAlert[] = [];
  if (
    !snapshot.maintenanceActive &&
    (snapshot.availabilityBurnRate1h > 14 || snapshot.availabilityBurnRate6h > 6)
  )
    triggered.push(alert("availability_burn"));
  if (!snapshot.maintenanceActive && snapshot.availabilityBurnRate3d > 1)
    triggered.push(alert("error_budget_burn"));
  if (snapshot.oldestReadyAgeSeconds > 300) triggered.push(alert("queue_backlog"));
  if (!snapshot.auditCommitHealthy) triggered.push(alert("audit_commit_failed"));
  if (snapshot.deadLetterGrowthPerHour >= 10) triggered.push(alert("dead_letter_growth"));
  if (snapshot.telemetryAgeSeconds > 300) triggered.push(alert("telemetry_stale"));
  return Object.freeze(triggered.sort((left, right) => left.id.localeCompare(right.id)));
}

/** Produces a safe, correlation-only flow summary; scan IDs and content are deliberately excluded. */
export function diagnoseCorrelation(
  correlationId: string,
  steps: readonly DiagnosticStep[],
): Readonly<{ correlationId: string; complete: boolean; terminalStage?: DiagnosticStage }> {
  if (!isValidCorrelationId(correlationId)) throw new TypeError("Invalid correlation ID.");
  if (steps.length === 0) throw new TypeError("At least one diagnostic step is required.");
  const seen = new Set<DiagnosticStage>();
  for (const step of steps) {
    if (!STAGES.has(step.stage) || seen.has(step.stage))
      throw new TypeError("Diagnostic stages must be unique and allowlisted.");
    seen.add(step.stage);
  }
  const terminal = steps.at(-1) as DiagnosticStep;
  return Object.freeze({
    correlationId,
    complete: terminal.outcome !== "in_progress",
    ...(terminal.outcome === "success" ? {} : { terminalStage: terminal.stage }),
  });
}
