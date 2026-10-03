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
  readonly findingCount?: number;
  readonly inputDigest?: string;
}

export interface HostedFinding {
  readonly ruleId: string;
  readonly reasonCode: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly location: Readonly<{ line: number; column: number; endLine: number; endColumn: number }>;
}

export interface HostedScanResult {
  readonly scanId: string;
  readonly disposition: "allow" | "review" | "block";
  readonly findings: readonly HostedFinding[];
  readonly inputDigest: string;
  readonly ruleSetDigest: string;
  readonly ruleSetVersion: string;
  readonly processedAt: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function safeHostedScanResult(value: unknown): HostedScanResult | undefined {
  const input = record(value);
  if (input === undefined || !Array.isArray(input.findings)) return undefined;
  if (
    typeof input.scan_id !== "string" ||
    !["allow", "review", "block"].includes(String(input.disposition)) ||
    typeof input.input_digest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(input.input_digest) ||
    typeof input.rule_set_digest !== "string" ||
    typeof input.rule_set_version !== "string" ||
    typeof input.processed_at !== "string"
  )
    return undefined;
  const findings = input.findings.flatMap((candidate): HostedFinding[] => {
    const finding = record(candidate);
    const location = record(finding?.location);
    if (
      finding === undefined ||
      location === undefined ||
      typeof finding.rule_id !== "string" ||
      typeof finding.reason_code !== "string" ||
      !["low", "medium", "high", "critical"].includes(String(finding.severity)) ||
      ![location.line, location.column, location.end_line, location.end_column].every(
        (part) => typeof part === "number" && Number.isSafeInteger(part) && part >= 1,
      )
    )
      return [];
    return [
      {
        ruleId: finding.rule_id,
        reasonCode: finding.reason_code,
        severity: finding.severity as HostedFinding["severity"],
        location: {
          line: location.line as number,
          column: location.column as number,
          endLine: location.end_line as number,
          endColumn: location.end_column as number,
        },
      },
    ];
  });
  if (findings.length !== input.findings.length) return undefined;
  return Object.freeze({
    scanId: input.scan_id,
    disposition: input.disposition as HostedScanResult["disposition"],
    findings: Object.freeze(findings),
    inputDigest: input.input_digest,
    ruleSetDigest: input.rule_set_digest,
    ruleSetVersion: input.rule_set_version,
    processedAt: input.processed_at,
  });
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
        ...(typeof record.findingCount === "number" && Number.isSafeInteger(record.findingCount)
          ? { findingCount: record.findingCount }
          : {}),
        ...(typeof record.inputDigest === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(record.inputDigest)
          ? { inputDigest: record.inputDigest }
          : {}),
      },
    ];
  });
}
