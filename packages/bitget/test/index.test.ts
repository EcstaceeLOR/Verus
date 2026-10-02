import { describe, expect, it } from "vitest";
import { ReadonlyBitgetPortfolio } from "../src/index.js";
describe("read-only Bitget impact mapping", () => {
  it("maps holdings and watchlists without exposing trading capability or model context", async () => {
    const integration = new ReadonlyBitgetPortfolio({
      request: async () => ({ data: [{ coin: "BTC", available: "1" }] }),
    });
    const portfolio = await integration.load({
      watchlist: [{ symbol: "ETH" }],
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const impacts = integration.impact(
      { entity: "Issuer", symbols: ["BTC", "ETH"], asOf: "2026-01-01T00:00:00Z" },
      portfolio,
      new Date("2026-01-01T00:01:00Z"),
    );
    expect(impacts).toEqual([
      {
        symbol: "BTC",
        relationship: "holding",
        confidence: "high",
        freshness: "current",
        asOf: "2026-01-01T00:00:00Z",
      },
      {
        symbol: "ETH",
        relationship: "watchlist",
        confidence: "medium",
        freshness: "current",
        asOf: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(ReadonlyBitgetPortfolio.modelContext({ explicitlyPermitted: false, impacts })).toEqual(
      [],
    );
  });
  it("marks degraded/stale portfolio observations clearly", () => {
    const integration = new ReadonlyBitgetPortfolio({ request: async () => ({}) }, 1);
    const impacts = integration.impact(
      { entity: "Issuer", symbols: ["BTC"], asOf: "2026-01-01T00:00:00Z" },
      {
        holdings: [{ symbol: "BTC", quantity: "1" }],
        watchlist: [],
        retrievedAt: "2026-01-01T00:00:00Z",
      },
      new Date("2026-01-01T00:00:01Z"),
    );
    expect(impacts[0]?.freshness).toBe("stale");
  });
});
