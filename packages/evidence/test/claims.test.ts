import { describe, expect, it } from "vitest";
import { createCandidateClaim, extractRevenueCandidate } from "../src/index.js";
describe("typed claim extraction", () => {
  it("creates only span-backed, unverified claims", () => {
    const value = extractRevenueCandidate({
      id: "c1",
      content: "Issuer revenue was $12.4 million this quarter.",
      digest: "sha256:source",
      entity: "Issuer",
      symbol: "ISS",
    });
    expect(value).toMatchObject({
      type: "revenue",
      value: 12_400_000,
      verification: "candidate",
      source: { text: "revenue was $12.4 million" },
      subject: { ambiguity: "resolved" },
    });
  });
  it("rejects spanless claims and preserves ambiguity", () => {
    expect(() =>
      createCandidateClaim({
        id: "x",
        type: "listing",
        subject: { entity: "Issuer", ambiguity: "ambiguous" },
        source: { digest: "d", start: 0, end: 0, text: "" },
        verification: "candidate",
      }),
    ).toThrow("SPAN_INVALID");
    expect(
      extractRevenueCandidate({
        id: "c",
        content: "revenue was 5 million",
        digest: "d",
        entity: "Issuer",
      }),
    ).toMatchObject({ subject: { ambiguity: "ambiguous" } });
  });
});
