import { describe, expect, it } from "vitest";
import { verifySource } from "../src/index.js";
const record = {
  id: "sec",
  version: "v1",
  publisher: "SEC",
  domains: ["sec.gov", "www.sec.gov"],
  aliases: ["U.S. SEC"],
  publicKeyFingerprints: [],
  reviewState: "approved" as const,
};
describe("source identity", () => {
  it("records origin verification as evidence rather than truth", () =>
    expect(
      verifySource(record, {
        requestedUrl: "https://sec.gov/a",
        finalUrl: "https://www.sec.gov/a",
        redirectUrls: ["https://sec.gov/a"],
        tlsVerified: true,
        publisherMetadata: "U.S. SEC",
      }),
    ).toMatchObject({ disposition: "verified", sourceVersion: "v1" }));
  it("preserves mismatches reproducibly", () =>
    expect(
      verifySource(record, {
        requestedUrl: "https://sec.gov/a",
        finalUrl: "https://other.example/a",
        redirectUrls: [],
        tlsVerified: false,
      }),
    ).toMatchObject({
      disposition: "mismatch",
      reasons: ["FINAL_DOMAIN_MISMATCH", "TLS_UNVERIFIED"],
    }));
});
