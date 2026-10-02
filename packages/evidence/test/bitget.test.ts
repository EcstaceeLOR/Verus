import { describe, expect, it } from "vitest";
import { BitgetEvidenceConnector } from "../src/index.js";
describe("Bitget evidence connector", () => {
  it("uses read-only metadata and preserves announcement version history", async () => {
    const connector = new BitgetEvidenceConnector({
      get: async (url) =>
        url.includes("support")
          ? {
              status: 200,
              retrievedAt: "now",
              body: JSON.stringify({
                digest: "sha256:v2",
                publishedAt: "2026-01-01",
                updatedAt: "2026-02-01",
                title: "Listing update",
              }),
            }
          : {
              status: 200,
              retrievedAt: "now",
              body: JSON.stringify({
                data: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "online" }],
              }),
            },
    });
    await expect(connector.announcement("123")).resolves.toMatchObject({
      versionDigest: "sha256:v2",
      freshness: "current",
    });
    await expect(connector.market("BTCUSDT")).resolves.toMatchObject({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      freshness: "current",
    });
  });
  it("labels unavailable data rather than implying stale data is current", async () =>
    expect(
      new BitgetEvidenceConnector({
        get: async () => ({ status: 503, retrievedAt: "now", body: "" }),
      }).market("BTCUSDT"),
    ).resolves.toMatchObject({ freshness: "unavailable" }));
});
