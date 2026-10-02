export type ScanInputKind = "text" | "url" | "upload";
export type ScanStage =
  "accepted" | "queued" | "processing" | "review" | "allowed" | "blocked" | "cancelled" | "failed";

export interface ScanSummary {
  readonly id: string;
  readonly kind: ScanInputKind;
  readonly preview: string;
  readonly stage: ScanStage;
  readonly submittedAt: string;
  readonly idempotencyKey: string;
  readonly failureCode?: string;
}

const terminal = new Set<ScanStage>(["allowed", "blocked", "cancelled", "failed"]);
const retryableFailureCodes = new Set(["SERVICE_UNAVAILABLE", "TIMEOUT", "RATE_LIMITED"]);

export function scanStageLabel(stage: ScanStage): string {
  return {
    accepted: "Accepted",
    queued: "Queued",
    processing: "Inspecting",
    review: "Needs review",
    allowed: "Allowed",
    blocked: "Blocked",
    cancelled: "Cancelled",
    failed: "Could not complete",
  }[stage];
}

export function canCancel(stage: ScanStage): boolean {
  return !terminal.has(stage);
}

export function canRetry(scan: ScanSummary): boolean {
  return (
    scan.stage === "failed" &&
    scan.failureCode !== undefined &&
    retryableFailureCodes.has(scan.failureCode)
  );
}

export function safePreview(kind: ScanInputKind, value: string): string {
  if (kind === "text") return "Text submission";
  if (kind === "upload") return "File submission";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 180);
  } catch {
    return "URL submission";
  }
}

export function safeHistory(value: unknown): readonly ScanSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      !["text", "url", "upload"].includes(String(record.kind)) ||
      !Object.hasOwn(
        {
          accepted: true,
          queued: true,
          processing: true,
          review: true,
          allowed: true,
          blocked: true,
          cancelled: true,
          failed: true,
        },
        String(record.stage),
      ) ||
      typeof record.submittedAt !== "string" ||
      typeof record.idempotencyKey !== "string"
    )
      return [];
    return [
      {
        id: record.id,
        kind: record.kind as ScanInputKind,
        preview: typeof record.preview === "string" ? record.preview.slice(0, 180) : "Submission",
        stage: record.stage as ScanStage,
        submittedAt: record.submittedAt,
        idempotencyKey: record.idempotencyKey,
        ...(typeof record.failureCode === "string" ? { failureCode: record.failureCode } : {}),
      },
    ];
  });
}
