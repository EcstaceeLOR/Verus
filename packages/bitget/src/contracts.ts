export type BitgetAccountMode = "classic" | "unified";
export type BitgetReadEndpoint =
  | "/api/v2/spot/account/assets"
  | "/api/v3/account/assets"
  | "/api/v3/market/instruments?category=SPOT";

export interface BitgetTransportResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Deliberately exposes GET-only access to a closed endpoint allowlist. */
export interface ReadonlyBitgetTransport {
  get(endpoint: BitgetReadEndpoint, signal?: AbortSignal): Promise<BitgetTransportResponse>;
  disconnect?(): void;
}

export interface BitgetCredentialCapabilities {
  readonly read: true;
  readonly trade: false;
  readonly transfer: false;
  readonly withdraw: false;
  readonly verifiedAt: string;
  readonly ipAllowlisted: boolean;
}

export interface BitgetHolding {
  readonly asset: string;
  readonly quantity: string;
}

export interface WatchlistEntry {
  readonly instrument: string;
}

export type BitgetInstrumentKind = "crypto" | "rtoken" | "other";

export interface BitgetInstrument {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly kind: BitgetInstrumentKind;
  readonly status: "online" | "offline" | "unknown";
  readonly underlyingSymbol?: string;
}

export interface PortfolioContext {
  readonly workspaceId: string;
  readonly accountMode: BitgetAccountMode;
  readonly holdings: readonly BitgetHolding[];
  readonly watchlist: readonly WatchlistEntry[];
  readonly instruments: readonly BitgetInstrument[];
  readonly portfolioRetrievedAt: string;
  readonly instrumentsRetrievedAt: string;
  readonly providerRequestTime: string;
}

export interface ResolvedEventInstrument {
  readonly symbol: string;
  readonly confidence: number;
  readonly source: "bitget" | "issuer" | "registry" | "manual";
}

export interface VerifiedEvent {
  readonly workspaceId: string;
  readonly entityId: string;
  readonly entityName: string;
  readonly instruments: readonly ResolvedEventInstrument[];
  readonly asOf: string;
}

export interface PortfolioImpact {
  readonly instrument: string;
  readonly instrumentKind: BitgetInstrumentKind;
  readonly relationship: "holding" | "watchlist";
  readonly mappingConfidence: number;
  readonly confidenceBand: "high" | "medium" | "low";
  readonly mappingBasis: "exact_instrument" | "base_asset" | "rtoken_underlying";
  readonly freshness: "current" | "stale";
  readonly ageMs: number;
  readonly maximumAgeMs: number;
  readonly portfolioRetrievedAt: string;
  readonly eventAsOf: string;
  readonly explanation: string;
}

export type BitgetDegradedReason =
  | "cancelled"
  | "credential_revoked"
  | "invalid_response"
  | "permission_denied"
  | "rate_limited"
  | "unavailable";

export type PortfolioLoadResult =
  | Readonly<{ status: "ready"; context: Readonly<PortfolioContext> }>
  | Readonly<{
      status: "degraded";
      reason: BitgetDegradedReason;
      retryable: boolean;
    }>;

export type BitgetIntegrationErrorCode =
  | "BITGET_CANCELLED"
  | "BITGET_CONFIGURATION_INVALID"
  | "BITGET_CREDENTIAL_REVOKED"
  | "BITGET_PERMISSION_DENIED"
  | "BITGET_RATE_LIMITED"
  | "BITGET_RESPONSE_INVALID"
  | "BITGET_UNAVAILABLE";

export class BitgetIntegrationError extends Error {
  readonly code: BitgetIntegrationErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly providerCode: string | undefined;

  constructor(
    code: BitgetIntegrationErrorCode,
    message: string,
    options?: Readonly<{
      retryable?: boolean;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }>,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BitgetIntegrationError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
    this.providerCode = options?.providerCode;
  }
}

export interface BitgetTelemetryEvent {
  readonly operation: "assets" | "instruments";
  readonly accountMode: BitgetAccountMode;
  readonly outcome: "success" | "retry" | "failure";
  readonly attempt: number;
  readonly durationMs: number;
  readonly errorCode?: BitgetIntegrationErrorCode;
  readonly providerCode?: string;
  readonly status?: number;
}

export interface BitgetTelemetry {
  record(event: Readonly<BitgetTelemetryEvent>): void;
}
