import { describe, expect, it } from "vitest";
import { createCandidateClaim, verifyClaim } from "../src/index.js";
const claim = createCandidateClaim({
  id: "c",
  type: "revenue",
  subject: { entity: "Issuer", ambiguity: "resolved" },
  value: 12,
  currency: "USD",
  source: { digest: "d", start: 0, end: 1, text: "x" },
  verification: "candidate",
});
const policy = {
  version: "v1",
  claimType: "revenue" as const,
  minimumMatches: 1,
  requirePrimary: true,
};
describe("claim verification", () => {
  it("uses versioned primary-evidence quorum and citations", () =>
    expect(
      verifyClaim(
        claim,
        [
          {
            id: "sec",
            primary: true,
            entity: "Issuer",
            value: 12,
            currency: "USD",
            citation: "accession",
          },
        ],
        policy,
      ),
    ).toMatchObject({ state: "verified", supporting: ["sec"], policyVersion: "v1" }));
  it("never fabricates support and cites contradictions", () => {
    expect(verifyClaim(claim, [], policy).state).toBe("unsupported");
    expect(
      verifyClaim(
        claim,
        [{ id: "other", primary: true, entity: "Issuer", value: 13, citation: "filing" }],
        policy,
      ),
    ).toMatchObject({ state: "contradicted", contradicting: ["other"] });
  });
});
