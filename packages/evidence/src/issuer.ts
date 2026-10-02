import type { SourceRecord } from "./index.js";
export interface IssuerAdapter {
  readonly id: string;
  readonly kind: "rss" | "sitemap" | "page";
  readonly url: string;
  readonly issuerSource: SourceRecord;
  fetch(): Promise<
    readonly { url: string; title: string; publishedAt: string; contentDigest: string }[]
  >;
}
export interface IssuerItem {
  readonly adapterId: string;
  readonly url: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly contentDigest: string;
  readonly state: "current" | "duplicate" | "removed";
}
export async function collectIssuer(
  adapter: IssuerAdapter,
  knownDigests: ReadonlySet<string>,
): Promise<Readonly<{ items: readonly IssuerItem[]; healthy: boolean; error?: string }>> {
  try {
    const expected = new Set(adapter.issuerSource.domains);
    if (!expected.has(new URL(adapter.url).hostname)) throw new Error("ISSUER_DOMAIN_UNVERIFIED");
    const entries = await adapter.fetch();
    const seen = new Set<string>();
    const items = entries.map((entry) => {
      if (!expected.has(new URL(entry.url).hostname)) throw new Error("ITEM_DOMAIN_UNVERIFIED");
      const duplicate = knownDigests.has(entry.contentDigest) || seen.has(entry.contentDigest);
      seen.add(entry.contentDigest);
      return Object.freeze({
        adapterId: adapter.id,
        ...entry,
        state: duplicate ? ("duplicate" as const) : ("current" as const),
      });
    });
    return Object.freeze({ items: Object.freeze(items), healthy: true });
  } catch (error) {
    return Object.freeze({
      items: Object.freeze([]),
      healthy: false,
      error: error instanceof Error ? error.message : "ISSUER_ADAPTER_FAILED",
    });
  }
}
