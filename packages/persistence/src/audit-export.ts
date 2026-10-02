import { createHash } from "node:crypto";
export interface SafeAuditEvent {
  readonly id: string;
  readonly action: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly target: string;
}
export function exportAudit(events: readonly SafeAuditEvent[], retentionUntil: string) {
  const payload = JSON.stringify({
    retention_until: retentionUntil,
    events: [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  });
  return Object.freeze({
    payload,
    digest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
    count: events.length,
  });
}
