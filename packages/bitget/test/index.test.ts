import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  BitgetIntegrationError,
  BitgetRestTransport,
  ReadonlyBitgetPortfolio,
  parseHoldings,
  parseInstruments,
  type BitgetCredentialCapabilities,
  type BitgetReadEndpoint,
  type BitgetTelemetryEvent,
  type BitgetTransportResponse,
  type PortfolioContext,
  type ReadonlyBitgetTransport,
  type VerifiedEvent,
} from "../src/index.js";

const now = Date.parse("2026-10-04T09:00:00.000Z");
const capabilities: BitgetCredentialCapabilities = {
  read: true,
  trade: false,
  transfer: false,
  withdraw: false,
  verifiedAt: "2026-10-04T08:00:00.000Z",
  ipAllowlisted: true,
};
const envelope = (data: unknown, code = "00000"): BitgetTransportResponse => ({
  status: 200,
  body: { code, msg: code === "00000" ? "success" : "error", requestTime: now, data },
});
const instrumentData = [
  {
    symbol: "RAAPLUSDT",
    baseCoin: "rAAPL",
    quoteCoin: "USDT",
    isReality: "yes",
    symbolType: "stock",
    status: "online",
  },
  {
    symbol: "BTCUSDT",
    baseCoin: "BTC",
    quoteCoin: "USDT",
    isReality: "no",
    symbolType: "crypto",
    status: "online",
  },
];

function mockTransport(
  responses: Partial<Record<BitgetReadEndpoint, BitgetTransportResponse>> = {},
) {
  const defaults: Record<BitgetReadEndpoint, BitgetTransportResponse> = {
    "/api/v3/market/instruments?category=SPOT": envelope(instrumentData),
    "/api/v3/account/assets": envelope({
      assets: [
        { coin: "rAAPL", balance: "2.5", available: "2" },
        { coin: "BTC", balance: "0" },
        { coin: "USDT", balance: "-1" },
      ],
    }),
    "/api/v2/spot/account/assets": envelope([
      { coin: "rAAPL", available: "1", frozen: "0.5", locked: "0.25" },
    ]),
  };
  return {
    get: vi.fn(async (endpoint: BitgetReadEndpoint) => responses[endpoint] ?? defaults[endpoint]),
    disconnect: vi.fn(),
  };
}

function integration(
  transport: ReadonlyBitgetTransport,
  overrides: Partial<ConstructorParameters<typeof ReadonlyBitgetPortfolio>[0]> = {},
) {
  return new ReadonlyBitgetPortfolio({
    transport,
    accountMode: "unified",
    capabilities,
    maximumAgeMs: 300_000,
    maximumRetries: 2,
    retryBaseDelayMs: 10,
    sleep: async () => undefined,
    now: () => now,
    ...overrides,
  });
}

describe("signed GET-only Bitget transport", () => {
  it("signs private reads with the documented prehash and keeps credentials private", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ code: "00000", requestTime: now, data: [] }));
    });
    const transport = new BitgetRestTransport({
      credentials: { apiKey: "key-value", secretKey: "secret-value", passphrase: "pass-value" },
      baseUrl: "https://api.bitget.test",
      allowCustomBaseUrl: true,
      timeoutMs: 500,
      fetch,
      now: () => now,
    });
    await transport.get("/api/v3/account/assets");
    const init = fetch.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    const expected = createHmac("sha256", "secret-value")
      .update(`${now}GET/api/v3/account/assets`)
      .digest("base64");
    expect(init?.method).toBe("GET");
    expect(headers).toMatchObject({
      "ACCESS-KEY": "key-value",
      "ACCESS-SIGN": expected,
      "ACCESS-TIMESTAMP": String(now),
      "ACCESS-PASSPHRASE": "pass-value",
    });
    expect(JSON.stringify(transport)).toBe("{}");
  });

  it("does not send private credentials to the public instrument endpoint", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ code: "00000", requestTime: now, data: [] }));
    });
    const transport = new BitgetRestTransport({
      credentials: { apiKey: "key-value", secretKey: "secret-value", passphrase: "pass-value" },
      fetch,
      now: () => now,
    });
    await transport.get("/api/v3/market/instruments?category=SPOT");
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["ACCESS-KEY"]).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain("key-value");
  });

  it("rejects any endpoint outside the closed read-only allowlist", async () => {
    const transport = new BitgetRestTransport({
      credentials: { apiKey: "key", secretKey: "secret", passphrase: "pass" },
      fetch: async () => new Response("{}"),
    });
    await expect(
      transport.get("/api/v3/trade/place-order" as BitgetReadEndpoint),
    ).rejects.toMatchObject({ code: "BITGET_CONFIGURATION_INVALID" });
  });

  it("pins the production host and bounds provider response bytes", async () => {
    expect(
      () =>
        new BitgetRestTransport({
          credentials: { apiKey: "key", secretKey: "secret", passphrase: "pass" },
          baseUrl: "https://attacker.example",
        }),
    ).toThrow("Custom Bitget API hosts");
    const transport = new BitgetRestTransport({
      credentials: { apiKey: "key", secretKey: "secret", passphrase: "pass" },
      maximumResponseBytes: 1_024,
      fetch: async () => new Response("{}", { headers: { "content-length": "2048" } }),
    });
    await expect(transport.get("/api/v3/account/assets")).rejects.toMatchObject({
      code: "BITGET_RESPONSE_INVALID",
    });
  });

  it("fails closed after local credential disconnection", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    const transport = new BitgetRestTransport({
      credentials: { apiKey: "key", secretKey: "secret", passphrase: "pass" },
      fetch,
    });
    transport.disconnect();
    await expect(transport.get("/api/v3/account/assets")).rejects.toMatchObject({
      code: "BITGET_CREDENTIAL_REVOKED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("portfolio ingestion", () => {
  it("rejects any capability attestation that is not strictly read-only", () => {
    const transport = mockTransport();
    expect(() =>
      integration(transport, {
        capabilities: { ...capabilities, trade: true } as unknown as BitgetCredentialCapabilities,
      }),
    ).toThrow("read-only");
  });

  it("loads current UTA assets and the public Reality/rToken catalog", async () => {
    const transport = mockTransport();
    const result = await integration(transport).load({
      workspaceId: "workspace-1",
      watchlist: [{ instrument: "AAPL" }, { instrument: "aapl" }],
    });
    expect(result).toEqual({
      status: "ready",
      context: {
        workspaceId: "workspace-1",
        accountMode: "unified",
        holdings: [{ asset: "RAAPL", quantity: "2.5" }],
        watchlist: [{ instrument: "AAPL" }],
        instruments: [
          {
            symbol: "BTCUSDT",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            kind: "crypto",
            status: "online",
          },
          {
            symbol: "RAAPLUSDT",
            baseAsset: "RAAPL",
            quoteAsset: "USDT",
            kind: "rtoken",
            status: "online",
            underlyingSymbol: "AAPL",
          },
        ],
        portfolioRetrievedAt: "2026-10-04T09:00:00.000Z",
        instrumentsRetrievedAt: "2026-10-04T09:00:00.000Z",
        providerRequestTime: "2026-10-04T09:00:00.000Z",
      },
    });
    expect(transport.get).toHaveBeenNthCalledWith(2, "/api/v3/account/assets", undefined);
  });

  it("supports classic spot balances without dropping frozen or locked ownership", async () => {
    const result = await integration(mockTransport(), { accountMode: "classic" }).load({
      workspaceId: "workspace-1",
      watchlist: [],
    });
    expect(result).toMatchObject({
      status: "ready",
      context: { holdings: [{ asset: "RAAPL", quantity: "1.75" }] },
    });
  });

  it("retries bounded maintenance failures and emits content-free telemetry", async () => {
    const events: BitgetTelemetryEvent[] = [];
    const transport = mockTransport();
    transport.get
      .mockResolvedValueOnce(envelope(undefined, "45001"))
      .mockResolvedValueOnce(envelope(instrumentData));
    const result = await integration(transport, {
      telemetry: { record: (event) => events.push(event) },
    }).load({ workspaceId: "workspace-1", watchlist: [] });
    expect(result.status).toBe("ready");
    expect(events.map((event) => [event.operation, event.outcome, event.attempt])).toEqual([
      ["instruments", "retry", 1],
      ["instruments", "success", 2],
      ["assets", "success", 1],
    ]);
    expect(JSON.stringify(events)).not.toContain("RAAPL");
    expect(JSON.stringify(events)).not.toContain("2.5");
  });

  it("detects revoked credentials, disconnects, and performs no later requests", async () => {
    const transport = mockTransport({
      "/api/v3/account/assets": envelope(undefined, "40006"),
    });
    const portfolio = integration(transport);
    await expect(portfolio.load({ workspaceId: "workspace-1", watchlist: [] })).resolves.toEqual({
      status: "degraded",
      reason: "credential_revoked",
      retryable: false,
    });
    expect(transport.disconnect).toHaveBeenCalledOnce();
    transport.get.mockClear();
    await expect(portfolio.load({ workspaceId: "workspace-1", watchlist: [] })).resolves.toEqual({
      status: "degraded",
      reason: "credential_revoked",
      retryable: false,
    });
    expect(transport.get).not.toHaveBeenCalled();
  });

  it("returns explicit degraded states for permission and malformed responses", async () => {
    const denied = mockTransport({
      "/api/v3/account/assets": { status: 403, body: { code: "40301" } },
    });
    await expect(
      integration(denied).load({ workspaceId: "workspace-1", watchlist: [] }),
    ).resolves.toEqual({
      status: "degraded",
      reason: "permission_denied",
      retryable: false,
    });
    const malformed = mockTransport({
      "/api/v3/account/assets": envelope({ assets: [{ coin: "BTC", balance: "NaN" }] }),
    });
    await expect(
      integration(malformed).load({ workspaceId: "workspace-1", watchlist: [] }),
    ).resolves.toEqual({
      status: "degraded",
      reason: "invalid_response",
      retryable: false,
    });
  });

  it("does not convert caller cancellation into a retry storm", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = mockTransport();
    transport.get.mockRejectedValue(new BitgetIntegrationError("BITGET_CANCELLED", "cancelled"));
    await expect(
      integration(transport).load({
        workspaceId: "workspace-1",
        watchlist: [],
        signal: controller.signal,
      }),
    ).resolves.toEqual({ status: "degraded", reason: "cancelled", retryable: false });
    expect(transport.get).toHaveBeenCalledOnce();
  });

  it("rejects duplicates and malformed upstream identifiers", () => {
    expect(() =>
      parseHoldings([
        { coin: "BTC", balance: "1" },
        { coin: "btc", balance: "2" },
      ]),
    ).toThrow("duplicate");
    expect(() =>
      parseInstruments([{ symbol: "bad symbol", baseCoin: "BTC", quoteCoin: "USDT" }]),
    ).toThrow("invalid");
  });
});

describe("explainable impact mapping", () => {
  const context: PortfolioContext = {
    workspaceId: "workspace-1",
    accountMode: "unified",
    holdings: [{ asset: "RAAPL", quantity: "2.5" }],
    watchlist: [{ instrument: "BTCUSDT" }],
    instruments: parseInstruments(instrumentData),
    portfolioRetrievedAt: "2026-10-04T08:58:00.000Z",
    instrumentsRetrievedAt: "2026-10-04T08:59:00.000Z",
    providerRequestTime: "2026-10-04T08:57:59.000Z",
  };
  const event: VerifiedEvent = {
    workspaceId: "workspace-1",
    entityId: "issuer:apple",
    entityName: "Apple Inc.",
    instruments: [{ symbol: "AAPL", confidence: 0.96, source: "issuer" }],
    asOf: "2026-10-04T08:55:00.000Z",
  };

  it("maps an owned rToken by verified underlying with confidence and freshness", () => {
    const impacts = integration(mockTransport()).impact(event, context, new Date(now));
    expect(impacts).toEqual([
      {
        instrument: "RAAPLUSDT",
        instrumentKind: "rtoken",
        relationship: "holding",
        mappingConfidence: 0.864,
        confidenceBand: "high",
        mappingBasis: "rtoken_underlying",
        freshness: "current",
        ageMs: 120_000,
        maximumAgeMs: 300_000,
        portfolioRetrievedAt: "2026-10-04T08:58:00.000Z",
        eventAsOf: "2026-10-04T08:55:00.000Z",
        explanation:
          "Owned asset matched the verified event by rtoken underlying; portfolio data is current.",
      },
    ]);
  });

  it("maps exact watchlist instruments and marks old context stale", () => {
    const impacts = integration(mockTransport()).impact(
      {
        workspaceId: "workspace-1",
        entityId: "asset:btc",
        entityName: "Bitcoin",
        instruments: [{ symbol: "BTCUSDT", confidence: 1, source: "bitget" }],
        asOf: event.asOf,
      },
      context,
      new Date("2026-10-04T09:10:00.000Z"),
    );
    expect(impacts[0]).toMatchObject({
      instrument: "BTCUSDT",
      relationship: "watchlist",
      mappingConfidence: 1,
      confidenceBand: "high",
      mappingBasis: "exact_instrument",
      freshness: "stale",
      ageMs: 720_000,
    });
  });

  it("keeps portfolio context out of public evidence and model prompts by default", () => {
    const impacts = integration(mockTransport()).impact(event, context, new Date(now));
    expect(ReadonlyBitgetPortfolio.publicEvidenceContext(impacts)).toEqual([]);
    expect(ReadonlyBitgetPortfolio.modelContext({ explicitlyPermitted: false, impacts })).toEqual(
      [],
    );
    expect(ReadonlyBitgetPortfolio.modelContext({ explicitlyPermitted: true, impacts })).toEqual(
      impacts,
    );
  });

  it("rejects unverified event mappings instead of guessing", () => {
    expect(() =>
      integration(mockTransport()).impact(
        { ...event, instruments: [{ symbol: "AAPL", confidence: 2, source: "manual" }] },
        context,
        new Date(now),
      ),
    ).toThrow("invalid");
  });

  it("rejects cross-workspace portfolio context", () => {
    expect(() =>
      integration(mockTransport()).impact(
        { ...event, workspaceId: "workspace-2" },
        context,
        new Date(now),
      ),
    ).toThrow("same workspace");
  });
});
