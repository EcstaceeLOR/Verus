export type PersistenceEventName =
  | "persistence.migration.completed"
  | "persistence.migration.failed"
  | "persistence.transaction.completed"
  | "persistence.transaction.failed";

export interface PersistenceEvent {
  readonly name: PersistenceEventName;
  readonly durationMs: number;
  readonly operation: string;
  readonly outcome: "success" | "failure";
  readonly version?: number;
}

export interface PersistenceTelemetry {
  emit(event: PersistenceEvent): void;
}

export const NOOP_PERSISTENCE_TELEMETRY: PersistenceTelemetry = Object.freeze({
  emit: () => undefined,
});
