import type { ClaimType } from "./claims.js";

export type EvidenceSourceType = "regulatory_filing" | "issuer_ir" | "exchange" | "other";
export type EvidenceTemporalState = "current" | "superseded" | "stale" | "future" | "invalid";

/** Immutable source observation. A correction never mutates the observation it replaces. */
export interface TemporalEvidence {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly sourceType: EvidenceSourceType;
  readonly claimType: ClaimType;
  readonly entity: string;
  readonly value?: number;
  readonly currency?: string;
  readonly period?: string;
  readonly publishedAt: string;
  readonly corrects?: string;
}

export interface FreshnessPolicy {
  readonly version: string;
  readonly defaultMaximumAgeMs: number;
  readonly maximumAgeMsByClaimType: Readonly<Partial<Record<ClaimType, number>>>;
  readonly maximumAgeMsBySourceType: Readonly<Partial<Record<EvidenceSourceType, number>>>;
}

export interface EvidenceTimelineTelemetry {
  readonly emit: (
    event: "evidence.temporal_invalid" | "evidence.temporal_stale",
    attributes: Readonly<Record<string, string>>,
  ) => void;
}

export interface EvidenceTimelineResult {
  readonly asOf: string;
  readonly policyVersion: string;
  readonly records: readonly Readonly<{
    id: string;
    state: EvidenceTemporalState;
    reasons: readonly string[];
  }>[];
  readonly current: readonly string[];
  readonly superseded: readonly string[];
  readonly contradictions: readonly string[];
}

const timestamp = (value: string): number | undefined => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const maximumAge = (evidence: TemporalEvidence, policy: FreshnessPolicy): number =>
  policy.maximumAgeMsByClaimType[evidence.claimType] ??
  policy.maximumAgeMsBySourceType[evidence.sourceType] ??
  policy.defaultMaximumAgeMs;

/**
 * Applies temporal policy without rewriting history. Callers must use `current` only
 * when constructing decision context; disagreement is returned as a conflict, never averaged.
 */
export function evaluateEvidenceTimeline(
  evidence: readonly TemporalEvidence[],
  policy: FreshnessPolicy,
  asOf: string,
  telemetry?: EvidenceTimelineTelemetry,
): Readonly<EvidenceTimelineResult> {
  const asOfTime = timestamp(asOf);
  const states = new Map<string, { state: EvidenceTemporalState; reasons: string[] }>();
  if (asOfTime === undefined || policy.defaultMaximumAgeMs < 0) {
    for (const item of evidence)
      states.set(item.id, { state: "invalid", reasons: ["TEMPORAL_POLICY_INVALID"] });
    telemetry?.emit("evidence.temporal_invalid", { reason: "TEMPORAL_POLICY_INVALID" });
    return freezeTimeline(asOf, policy.version, states, []);
  }

  const published = new Map<string, number>();
  for (const item of evidence) {
    const publishedAt = timestamp(item.publishedAt);
    if (publishedAt === undefined || maximumAge(item, policy) < 0) {
      states.set(item.id, { state: "invalid", reasons: ["PUBLISHED_AT_INVALID"] });
      telemetry?.emit("evidence.temporal_invalid", {
        sourceType: item.sourceType,
        reason: "PUBLISHED_AT_INVALID",
      });
    } else if (publishedAt > asOfTime) {
      states.set(item.id, { state: "future", reasons: ["PUBLISHED_AFTER_AS_OF"] });
    } else {
      published.set(item.id, publishedAt);
      states.set(item.id, { state: "current", reasons: [] });
    }
  }
  for (const item of evidence) {
    if (!item.corrects || !published.has(item.id) || !states.has(item.corrects)) continue;
    const prior = states.get(item.corrects);
    if (prior?.state === "current") {
      prior.state = "superseded";
      prior.reasons.push("CORRECTED_BY_NEWER_EVIDENCE");
    }
  }
  for (const item of evidence) {
    const state = states.get(item.id);
    const publishedAt = published.get(item.id);
    if (!state || state.state !== "current" || publishedAt === undefined) continue;
    if (asOfTime - publishedAt > maximumAge(item, policy)) {
      state.state = "stale";
      state.reasons.push("FRESHNESS_WINDOW_EXCEEDED");
      telemetry?.emit("evidence.temporal_stale", {
        sourceType: item.sourceType,
        claimType: item.claimType,
      });
    }
  }
  const currentItems = evidence.filter((item) => states.get(item.id)?.state === "current");
  const contradictions = currentItems.flatMap((item, index) =>
    currentItems
      .slice(index + 1)
      .flatMap((other) =>
        item.entity === other.entity &&
        item.claimType === other.claimType &&
        item.period === other.period &&
        item.currency === other.currency &&
        item.value !== undefined &&
        other.value !== undefined &&
        item.value !== other.value
          ? [`${item.id}:${other.id}`]
          : [],
      ),
  );
  return freezeTimeline(asOf, policy.version, states, contradictions);
}

function freezeTimeline(
  asOf: string,
  policyVersion: string,
  states: ReadonlyMap<string, { state: EvidenceTemporalState; reasons: readonly string[] }>,
  contradictions: readonly string[],
): Readonly<EvidenceTimelineResult> {
  const records = [...states.entries()]
    .map(([id, value]) =>
      Object.freeze({ id, state: value.state, reasons: Object.freeze([...value.reasons].sort()) }),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    asOf,
    policyVersion,
    records: Object.freeze(records),
    current: Object.freeze(
      records.filter((record) => record.state === "current").map((record) => record.id),
    ),
    superseded: Object.freeze(
      records.filter((record) => record.state === "superseded").map((record) => record.id),
    ),
    contradictions: Object.freeze([...contradictions].sort()),
  });
}
