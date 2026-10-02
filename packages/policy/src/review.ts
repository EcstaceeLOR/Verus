import type { Disposition } from "./index.js";

export interface SafeVerdictView {
  readonly disposition: Disposition;
  readonly primaryReason: string;
  readonly evidenceFreshness: "current" | "stale" | "unavailable";
  readonly nextAction: "release" | "request_review" | "blocked";
  readonly preview: Readonly<{ text: string; redacted: true }>;
}
export interface ReviewResolution {
  readonly verdictId: string;
  readonly reviewerId: string;
  readonly outcome: "approved" | "rejected";
  readonly reasonCode: string;
  readonly occurredAt: string;
}
export interface ReviewAudit {
  append(event: ReviewResolution): void;
}
export function explainVerdict(
  input: Readonly<{
    disposition: Disposition;
    reasonCodes: readonly string[];
    evidenceFreshness: "current" | "stale" | "unavailable";
    safeExcerpt?: string;
  }>,
): SafeVerdictView {
  const reason =
    input.reasonCodes[0] ??
    (input.disposition === "allow" ? "POLICY_PASSED" : "POLICY_EVALUATION_FAILED");
  return Object.freeze({
    disposition: input.disposition,
    primaryReason: reason,
    evidenceFreshness: input.evidenceFreshness,
    nextAction:
      input.disposition === "allow"
        ? "release"
        : input.disposition === "review"
          ? "request_review"
          : "blocked",
    preview: Object.freeze({
      text: (input.safeExcerpt ?? "").replace(/[<>]/gu, "").slice(0, 280),
      redacted: true,
    }),
  });
}
export function resolveReview(
  input: Readonly<{
    authorized: boolean;
    verdictId: string;
    reviewerId: string;
    originalDisposition: Disposition;
    nonOverridable: boolean;
    outcome: "approved" | "rejected";
    reasonCode: string;
    occurredAt: string;
  }>,
  audit: ReviewAudit,
): Readonly<ReviewResolution> {
  if (!input.authorized) throw new Error("REVIEW_NOT_AUTHORIZED");
  if (input.originalDisposition !== "review" || input.nonOverridable)
    throw new Error("REVIEW_NOT_ELIGIBLE");
  const event = Object.freeze({
    verdictId: input.verdictId,
    reviewerId: input.reviewerId,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    occurredAt: input.occurredAt,
  });
  audit.append(event);
  return event;
}
