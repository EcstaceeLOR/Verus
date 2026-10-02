export interface BitgetTransport {
  get(url: string): Promise<Readonly<{ status: number; body: string; retrievedAt: string }>>;
}
export interface BitgetAnnouncement {
  readonly id: string;
  readonly versionDigest: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly title: string;
  readonly freshness: "current" | "unavailable";
}
export interface BitgetMarket {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly status: string;
  readonly freshness: "current" | "unavailable";
}
export class BitgetEvidenceConnector {
  readonly #transport: BitgetTransport;
  constructor(transport: BitgetTransport) {
    this.#transport = transport;
  }
  async announcement(id: string): Promise<Readonly<BitgetAnnouncement>> {
    try {
      const response = await this.#transport.get(
        `https://www.bitget.com/support/articles/${encodeURIComponent(id)}`,
      );
      if (response.status !== 200) throw new Error();
      const data = JSON.parse(response.body) as Record<string, string>;
      return Object.freeze({
        id,
        versionDigest: data.digest,
        publishedAt: data.publishedAt,
        updatedAt: data.updatedAt,
        title: data.title,
        freshness: "current",
      });
    } catch {
      return Object.freeze({
        id,
        versionDigest: "",
        publishedAt: "",
        updatedAt: "",
        title: "",
        freshness: "unavailable",
      });
    }
  }
  async market(symbol: string): Promise<Readonly<BitgetMarket>> {
    try {
      const response = await this.#transport.get(
        `https://api.bitget.com/api/v2/spot/public/symbols?symbol=${encodeURIComponent(symbol)}`,
      );
      if (response.status !== 200) throw new Error();
      const data = JSON.parse(response.body) as {
        data: { symbol: string; baseCoin: string; quoteCoin: string; status: string }[];
      };
      const item = data.data.find((entry) => entry.symbol === symbol);
      if (!item) throw new Error();
      return Object.freeze({
        symbol: item.symbol,
        baseAsset: item.baseCoin,
        quoteAsset: item.quoteCoin,
        status: item.status,
        freshness: "current",
      });
    } catch {
      return Object.freeze({
        symbol,
        baseAsset: "",
        quoteAsset: "",
        status: "",
        freshness: "unavailable",
      });
    }
  }
}
