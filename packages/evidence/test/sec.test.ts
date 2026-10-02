import { describe, expect, it } from "vitest";
import { SecEdgarConnector } from "../src/index.js";
describe("SEC EDGAR connector", () => {
  it("preserves a primary accession record and anchors", async () => {
    const connector = new SecEdgarConnector(
      {
        get: async () => ({
          status: 200,
          retrievedAt: "2026-10-02T00:00:00Z",
          body: "<TYPE>10-K\n<FILING-DATE>20250131\n<DOCUMENT><DOCUMENT>",
        }),
      },
      "verus-security@example.com",
    );
    await expect(connector.filing("0000320193", "0000320193-25-000001")).resolves.toMatchObject({
      form: "10-K",
      accession: "0000320193-25-000001",
      anchors: ["document:1", "document:2"],
      freshness: "current",
    });
  });
  it("does not silently reuse stale content on failure", async () => {
    const connector = new SecEdgarConnector(
      { get: async () => ({ status: 503, retrievedAt: "now", body: "" }) },
      "verus-security@example.com",
    );
    await expect(connector.filing("0000320193", "0000320193-25-000001")).resolves.toMatchObject({
      freshness: "unavailable",
      anchors: [],
    });
  });
});
