export interface SafeFinding {
  readonly id: string;
  readonly category: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly location: string;
  readonly reason: string;
}
export function safeFinding(value: unknown): SafeFinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  const severity = String(r.severity);
  if (
    typeof r.id !== "string" ||
    typeof r.category !== "string" ||
    !["low", "medium", "high", "critical"].includes(severity)
  )
    return undefined;
  return Object.freeze({
    id: r.id.slice(0, 80),
    category: r.category.slice(0, 80),
    severity: severity as SafeFinding["severity"],
    location:
      typeof r.location === "string"
        ? r.location.replace(/[<>]/gu, "").slice(0, 160)
        : "Unavailable",
    reason: typeof r.reason === "string" ? r.reason.slice(0, 120) : "POLICY_REVIEW",
  });
}
