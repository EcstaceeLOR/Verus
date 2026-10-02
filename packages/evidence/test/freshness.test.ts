import { describe, expect, it, vi } from "vitest";
import {
  evaluateEvidenceTimeline,
  type FreshnessPolicy,
  type TemporalEvidence,
} from "../src/index.js";

const policy: FreshnessPolicy = {
  version: "freshness-v1",
  defaultMaximumAgeMs: 86_400_000,
  maximumAgeMsByClaimType: {},
  maximumAgeMsBySourceType: {},
};
const base: TemporalEvidence = {
  id: "filing-v1",
  sourceId: "sec",
  sourceVersion: "v1",
  sourceType: "regulatory_filing",
  claimType: "revenue",
  entity: "Issuer",
  value: 10,
  currency: "USD",
  period: "2026-Q1",
  publishedAt: "2026-01-01T00:00:00.000Z",
};

describe("evidence timeline", () => {
  it("preserves corrected history and returns a versioned current record", () => {
    const result = evaluateEvidenceTimeline(
      [
        base,
        {
          ...base,
          id: "filing-v2",
          sourceVersion: "v2",
          value: 11,
          publishedAt: "2026-01-02T00:00:00.000Z",
          corrects: "filing-v1",
        },
      ],
      policy,
      "2026-01-02T12:00:00.000Z",
    );
    expect(result).toMatchObject({
      asOf: "2026-01-02T12:00:00.000Z",
      policyVersion: "freshness-v1",
      current: ["filing-v2"],
      superseded: ["filing-v1"],
    });
    expect(result.records).toContainEqual({
      id: "filing-v1",
      state: "superseded",
      reasons: ["CORRECTED_BY_NEWER_EVIDENCE"],
    });
  });

  it("flags stale, future, and malformed observations without fabricating current context", () => {
    const emit = vi.fn();
    const result = evaluateEvidenceTimeline(
      [
        base,
        { ...base, id: "future", publishedAt: "2026-01-04T00:00:00.000Z" },
        { ...base, id: "bad", publishedAt: "not-a-date" },
      ],
      policy,
      "2026-01-03T00:00:00.000Z",
      { emit },
    );
    expect(result.current).toEqual([]);
    expect(result.records).toContainEqual({
      id: "filing-v1",
      state: "stale",
      reasons: ["FRESHNESS_WINDOW_EXCEEDED"],
    });
    expect(result.records).toContainEqual({
      id: "future",
      state: "future",
      reasons: ["PUBLISHED_AFTER_AS_OF"],
    });
    expect(result.records).toContainEqual({
      id: "bad",
      state: "invalid",
      reasons: ["PUBLISHED_AT_INVALID"],
    });
    expect(emit).toHaveBeenCalled();
  });

  it("reports genuine disagreement instead of averaging source values", () => {
    const result = evaluateEvidenceTimeline(
      [base, { ...base, id: "issuer", sourceId: "ir", sourceType: "issuer_ir", value: 12 }],
      policy,
      "2026-01-01T12:00:00.000Z",
    );
    expect(result.contradictions).toEqual(["filing-v1:issuer"]);
  });
});
