import {
  ReadonlyBitgetPortfolio,
  type BitgetCredentialCapabilities,
  type PortfolioContext,
  type ReadonlyBitgetTransport,
  type VerifiedEvent,
} from "../packages/bitget/src/index.js";

import type { HostedRequest, HostedResponse } from "./http.js";
import { secureJson } from "./http.js";

const sampleWorkspaceId = "judge-demo";
const maximumAgeMs = 300_000;

function unreachableTransport(): ReadonlyBitgetTransport {
  return {
    get(endpoint) {
      void endpoint;
      return Promise.reject(new Error("The credential-free judge demo never calls Bitget."));
    },
  };
}

export function sampleBitgetImpact(now = new Date()) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("Demo time must be valid.");

  const capabilities: BitgetCredentialCapabilities = {
    read: true,
    trade: false,
    transfer: false,
    withdraw: false,
    verifiedAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
    ipAllowlisted: true,
  };

  const portfolio: PortfolioContext = {
    workspaceId: sampleWorkspaceId,
    accountMode: "unified",
    holdings: [{ asset: "RAAPL", quantity: "2.5" }],
    watchlist: [{ instrument: "AAPL" }],
    instruments: [
      {
        symbol: "RAAPLUSDT",
        baseAsset: "RAAPL",
        quoteAsset: "USDT",
        kind: "rtoken",
        status: "online",
        underlyingSymbol: "AAPL",
      },
    ],
    portfolioRetrievedAt: new Date(nowMs - 120_000).toISOString(),
    instrumentsRetrievedAt: new Date(nowMs - 60_000).toISOString(),
    providerRequestTime: new Date(nowMs - 121_000).toISOString(),
  };

  const event: VerifiedEvent = {
    workspaceId: sampleWorkspaceId,
    entityId: "issuer:apple",
    entityName: "Apple Inc.",
    instruments: [{ symbol: "AAPL", confidence: 0.98, source: "issuer" }],
    asOf: new Date(nowMs - 180_000).toISOString(),
  };

  const integration = new ReadonlyBitgetPortfolio({
    transport: unreachableTransport(),
    accountMode: "unified",
    capabilities,
    maximumAgeMs,
    now: () => nowMs,
  });
  const impacts = integration.impact(event, portfolio, now);

  return Object.freeze({
    mode: "credential_free_sample",
    provider: "bitget",
    event: {
      entity_id: event.entityId,
      entity_name: event.entityName,
      symbol: event.instruments[0]?.symbol ?? "AAPL",
      confidence: event.instruments[0]?.confidence ?? 0,
      source: event.instruments[0]?.source ?? "issuer",
      as_of: event.asOf,
    },
    portfolio: {
      account_mode: portfolio.accountMode,
      sample_holding: portfolio.holdings[0]?.asset ?? "RAAPL",
      permissions: {
        read: true,
        trade: false,
        transfer: false,
        withdraw: false,
      },
    },
    impacts: impacts.map((impact) => ({
      instrument: impact.instrument,
      instrument_kind: impact.instrumentKind,
      relationship: impact.relationship,
      mapping_confidence: impact.mappingConfidence,
      confidence_band: impact.confidenceBand,
      mapping_basis: impact.mappingBasis,
      freshness: impact.freshness,
      age_ms: impact.ageMs,
      maximum_age_ms: impact.maximumAgeMs,
      portfolio_retrieved_at: impact.portfolioRetrievedAt,
      event_as_of: impact.eventAsOf,
      explanation: impact.explanation,
    })),
    production_boundary: {
      private_reads: ["/api/v2/spot/account/assets", "/api/v3/account/assets"],
      public_reads: ["/api/v3/market/instruments?category=SPOT"],
      generic_request_method: false,
      write_permissions_required: false,
    },
  });
}

export default function bitgetImpact(request: HostedRequest, response: HostedResponse): void {
  secureJson(response);
  if (request.method !== "GET") {
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.status(200).json(sampleBitgetImpact());
}
