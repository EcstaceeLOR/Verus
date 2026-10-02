export interface ReadonlyBitgetTransport {
  request(path: "/api/v2/spot/account/assets" | "/api/v2/spot/public/symbols"): Promise<unknown>;
}
export interface BitgetHolding {
  readonly symbol: string;
  readonly quantity: string;
}
export interface WatchlistEntry {
  readonly symbol: string;
}
export interface PortfolioContext {
  readonly holdings: readonly BitgetHolding[];
  readonly watchlist: readonly WatchlistEntry[];
  readonly retrievedAt: string;
}
export interface VerifiedEvent {
  readonly entity: string;
  readonly symbols: readonly string[];
  readonly asOf: string;
}
export interface PortfolioImpact {
  readonly symbol: string;
  readonly relationship: "holding" | "watchlist";
  readonly confidence: "high" | "medium";
  readonly freshness: "current" | "stale";
  readonly asOf: string;
}
/** Deliberately exposes no order, transfer, withdrawal, or credential-management methods. */
export class ReadonlyBitgetPortfolio {
  constructor(
    readonly transport: ReadonlyBitgetTransport,
    readonly maximumAgeMs: number = 300_000,
  ) {}
  async load(
    context: Readonly<{ watchlist: readonly WatchlistEntry[]; now: Date }>,
  ): Promise<Readonly<PortfolioContext>> {
    const payload = (await this.transport.request("/api/v2/spot/account/assets")) as {
      data?: readonly { coin?: string; available?: string }[];
    };
    const holdings = (payload.data ?? []).flatMap((asset) =>
      asset.coin && asset.available && Number(asset.available) > 0
        ? [{ symbol: asset.coin.toUpperCase(), quantity: asset.available }]
        : [],
    );
    return Object.freeze({
      holdings: Object.freeze(holdings.sort((a, b) => a.symbol.localeCompare(b.symbol))),
      watchlist: Object.freeze(context.watchlist.map((entry) => Object.freeze({ ...entry }))),
      retrievedAt: context.now.toISOString(),
    });
  }
  impact(event: VerifiedEvent, portfolio: PortfolioContext, now: Date): readonly PortfolioImpact[] {
    const freshness: PortfolioImpact["freshness"] =
      now.getTime() - Date.parse(portfolio.retrievedAt) <= this.maximumAgeMs ? "current" : "stale";
    const symbols = new Set(event.symbols.map((symbol) => symbol.toUpperCase()));
    const holding = portfolio.holdings
      .filter((item) => symbols.has(item.symbol))
      .map((item) => ({
        symbol: item.symbol,
        relationship: "holding" as const,
        confidence: "high" as const,
        freshness,
        asOf: event.asOf,
      }));
    const watched = portfolio.watchlist
      .filter(
        (item) =>
          symbols.has(item.symbol.toUpperCase()) &&
          !holding.some((impact) => impact.symbol === item.symbol.toUpperCase()),
      )
      .map((item) => ({
        symbol: item.symbol.toUpperCase(),
        relationship: "watchlist" as const,
        confidence: "medium" as const,
        freshness,
        asOf: event.asOf,
      }));
    return Object.freeze([...holding, ...watched].sort((a, b) => a.symbol.localeCompare(b.symbol)));
  }
  static modelContext(
    input: Readonly<{ explicitlyPermitted: boolean; impacts: readonly PortfolioImpact[] }>,
  ): readonly PortfolioImpact[] {
    return input.explicitlyPermitted ? input.impacts : Object.freeze([]);
  }
}
