export interface CapsuleView {
  readonly id: string;
  readonly verification: "valid" | "invalid" | "unavailable";
  readonly createdAt: string;
  readonly disposition: string;
  readonly citations: readonly string[];
  readonly missingEvidence: boolean;
}
export function capsuleView(
  value: unknown,
  verified: boolean | undefined,
): CapsuleView | undefined {
  if (!value || typeof value !== "object") return;
  const r = value as Record<string, unknown>;
  if (typeof r.capsule_id !== "string" || typeof r.created_at !== "string") return;
  const claims = Array.isArray(r.claims) ? r.claims : [];
  const citations: string[] = claims.flatMap((c) => {
    const source =
      typeof c === "object" && c !== null ? (c as Record<string, unknown>).source_id : undefined;
    return typeof source === "string" ? [source] : [];
  });
  return Object.freeze({
    id: r.capsule_id,
    verification: verified === true ? "valid" : verified === false ? "invalid" : "unavailable",
    createdAt: r.created_at,
    disposition: typeof r.disposition === "string" ? r.disposition : "unknown",
    citations: Object.freeze(citations.slice(0, 20)),
    missingEvidence: !Array.isArray(r.evidence) || r.evidence.length === 0,
  });
}
