import { describe, expect, it } from "vitest";
import { collectIssuer, type IssuerAdapter } from "../src/index.js";
const source = {
  id: "issuer",
  version: "v1",
  publisher: "Issuer",
  domains: ["investor.example.com"],
  aliases: [],
  publicKeyFingerprints: [],
  reviewState: "approved" as const,
};
const adapter = (kind: IssuerAdapter["kind"]): IssuerAdapter => ({
  id: kind,
  kind,
  url: "https://investor.example.com/feed",
  issuerSource: source,
  fetch: async () => [
    {
      url: "https://investor.example.com/news",
      title: "Release",
      publishedAt: "2026-10-02",
      contentDigest: "sha256:a",
    },
  ],
});
describe("issuer adapters", () => {
  it("supports RSS, sitemap, and page adapters under one provenance contract", async () => {
    for (const kind of ["rss", "sitemap", "page"] as const)
      await expect(collectIssuer(adapter(kind), new Set())).resolves.toMatchObject({
        healthy: true,
        items: [expect.objectContaining({ state: "current" })],
      });
  });
  it("isolates broken adapters and marks syndication duplicates", async () => {
    await expect(collectIssuer(adapter("rss"), new Set(["sha256:a"]))).resolves.toMatchObject({
      items: [expect.objectContaining({ state: "duplicate" })],
    });
    await expect(
      collectIssuer({ ...adapter("page"), url: "https://bad.example.com" }, new Set()),
    ).resolves.toMatchObject({ healthy: false, error: "ISSUER_DOMAIN_UNVERIFIED" });
  });
});
