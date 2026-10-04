import {
  BitgetIntegrationError,
  type BitgetAccountMode,
  type BitgetCredentialCapabilities,
  type BitgetDegradedReason,
  type BitgetInstrument,
  type BitgetIntegrationErrorCode,
  type BitgetReadEndpoint,
  type BitgetTelemetry,
  type PortfolioContext,
  type PortfolioImpact,
  type PortfolioLoadResult,
  type ReadonlyBitgetTransport,
  type ResolvedEventInstrument,
  type VerifiedEvent,
  type WatchlistEntry,
} from "./contracts.js";
import { parseEnvelope, parseHoldings, parseInstruments } from "./parsing.js";

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface ReadonlyBitgetPortfolioOptions {
  readonly transport: ReadonlyBitgetTransport;
  readonly accountMode: BitgetAccountMode;
  readonly capabilities: BitgetCredentialCapabilities;
  readonly maximumAgeMs?: number;
  readonly maximumRetries?: number;
  readonly retryBaseDelayMs?: number;
  readonly telemetry?: BitgetTelemetry;
  readonly sleep?: Sleep;
  readonly now?: () => number;
}

interface ValidatedOptions {
  readonly maximumAgeMs: number;
  readonly maximumRetries: number;
  readonly retryBaseDelayMs: number;
}

const identifierPattern = /^[A-Z0-9$._-]{1,64}$/u;

function assertInteger(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

function validateOptions(options: ReadonlyBitgetPortfolioOptions): ValidatedOptions {
  const capabilities = options.capabilities as Partial<BitgetCredentialCapabilities>;
  if (
    capabilities.read !== true ||
    capabilities.trade !== false ||
    capabilities.transfer !== false ||
    capabilities.withdraw !== false
  ) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Verus accepts only a Bitget key attested as read-only with trade, transfer, and withdraw disabled.",
    );
  }
  const verifiedAt = Date.parse(capabilities.verifiedAt ?? "");
  if (!Number.isFinite(verifiedAt) || verifiedAt > (options.now ?? Date.now)() + 60_000) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Bitget capability verification time is invalid.",
    );
  }
  const maximumAgeMs = options.maximumAgeMs ?? 300_000;
  const maximumRetries = options.maximumRetries ?? 2;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
  assertInteger(maximumAgeMs, 1_000, 86_400_000, "maximumAgeMs");
  assertInteger(maximumRetries, 0, 3, "maximumRetries");
  assertInteger(retryBaseDelayMs, 1, 10_000, "retryBaseDelayMs");
  return Object.freeze({ maximumAgeMs, maximumRetries, retryBaseDelayMs });
}

function normalizeIdentifier(value: string, name: string): string {
  const normalized = value.trim().toUpperCase();
  if (!identifierPattern.test(normalized)) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      `${name} contains an unsupported identifier.`,
    );
  }
  return normalized;
}

function validateWorkspaceId(value: unknown): string {
  if (typeof value !== "string") {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Workspace binding is invalid.",
    );
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(normalized)) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Workspace binding is invalid.",
    );
  }
  return normalized;
}

function normalizeWatchlist(entries: readonly WatchlistEntry[]): readonly WatchlistEntry[] {
  if (entries.length > 500) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "A Bitget watchlist cannot exceed 500 instruments.",
    );
  }
  const seen = new Set<string>();
  const normalized = entries.flatMap((entry) => {
    const instrument = normalizeIdentifier(entry.instrument, "Watchlist");
    if (seen.has(instrument)) return [];
    seen.add(instrument);
    return [Object.freeze({ instrument })];
  });
  return Object.freeze(
    normalized.sort((left, right) => left.instrument.localeCompare(right.instrument)),
  );
}

function normalizeFailure(error: unknown): BitgetIntegrationError {
  return error instanceof BitgetIntegrationError
    ? error
    : new BitgetIntegrationError("BITGET_UNAVAILABLE", "Bitget is unavailable.", {
        retryable: true,
        cause: error,
      });
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BitgetIntegrationError("BITGET_CANCELLED", "The Bitget request was cancelled."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new BitgetIntegrationError("BITGET_CANCELLED", "The Bitget request was cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function degradedReason(code: BitgetIntegrationErrorCode): BitgetDegradedReason {
  const reasons: Record<BitgetIntegrationErrorCode, BitgetDegradedReason> = {
    BITGET_CANCELLED: "cancelled",
    BITGET_CONFIGURATION_INVALID: "invalid_response",
    BITGET_CREDENTIAL_REVOKED: "credential_revoked",
    BITGET_PERMISSION_DENIED: "permission_denied",
    BITGET_RATE_LIMITED: "rate_limited",
    BITGET_RESPONSE_INVALID: "invalid_response",
    BITGET_UNAVAILABLE: "unavailable",
  };
  return reasons[code];
}

export class ReadonlyBitgetPortfolio {
  readonly #transport: ReadonlyBitgetTransport;
  readonly #accountMode: BitgetAccountMode;
  readonly #options: ValidatedOptions;
  readonly #telemetry: BitgetTelemetry | undefined;
  readonly #sleep: Sleep;
  readonly #now: () => number;
  #disconnected = false;

  constructor(options: ReadonlyBitgetPortfolioOptions) {
    this.#options = validateOptions(options);
    this.#transport = options.transport;
    this.#accountMode = options.accountMode;
    this.#telemetry = options.telemetry;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
  }

  disconnect(): void {
    this.#disconnected = true;
    this.#transport.disconnect?.();
  }

  async load(
    input: Readonly<{
      workspaceId: string;
      watchlist: readonly WatchlistEntry[];
      signal?: AbortSignal;
    }>,
  ): Promise<PortfolioLoadResult> {
    const workspaceId = validateWorkspaceId(input.workspaceId);
    const watchlist = normalizeWatchlist(input.watchlist);
    if (this.#disconnected) {
      return Object.freeze({ status: "degraded", reason: "credential_revoked", retryable: false });
    }
    try {
      const instrumentResult = await this.#request(
        "instruments",
        "/api/v3/market/instruments?category=SPOT",
        parseInstruments,
        input.signal,
      );
      const accountEndpoint: BitgetReadEndpoint =
        this.#accountMode === "unified" ? "/api/v3/account/assets" : "/api/v2/spot/account/assets";
      const assetResult = await this.#request(
        "assets",
        accountEndpoint,
        parseHoldings,
        input.signal,
      );
      const completedAt = new Date(this.#now()).toISOString();
      const context: PortfolioContext = Object.freeze({
        workspaceId,
        accountMode: this.#accountMode,
        holdings: assetResult.value,
        watchlist,
        instruments: instrumentResult.value,
        portfolioRetrievedAt: completedAt,
        instrumentsRetrievedAt: completedAt,
        providerRequestTime: assetResult.requestTime,
      });
      return Object.freeze({ status: "ready", context });
    } catch (error) {
      const failure = normalizeFailure(error);
      if (failure.code === "BITGET_CREDENTIAL_REVOKED") this.disconnect();
      return Object.freeze({
        status: "degraded",
        reason: degradedReason(failure.code),
        retryable: failure.retryable,
      });
    }
  }

  impact(event: VerifiedEvent, portfolio: PortfolioContext, now: Date): readonly PortfolioImpact[] {
    const eventWorkspaceId = validateWorkspaceId(event.workspaceId);
    const portfolioWorkspaceId = validateWorkspaceId(portfolio.workspaceId);
    const eventTime = Date.parse(event.asOf);
    const portfolioTime = Date.parse(portfolio.portfolioRetrievedAt);
    const instrumentTime = Date.parse(portfolio.instrumentsRetrievedAt);
    const nowTime = now.getTime();
    if (
      !event.entityId.trim() ||
      !event.entityName.trim() ||
      eventWorkspaceId !== portfolioWorkspaceId ||
      portfolio.accountMode !== this.#accountMode ||
      !Number.isFinite(eventTime) ||
      !Number.isFinite(portfolioTime) ||
      !Number.isFinite(instrumentTime) ||
      !Number.isFinite(nowTime)
    ) {
      throw new BitgetIntegrationError(
        "BITGET_CONFIGURATION_INVALID",
        "Event and portfolio context are invalid or not bound to the same workspace.",
      );
    }
    const references = event.instruments.map(validateReference);
    const heldAssets = new Set(portfolio.holdings.map((holding) => holding.asset.toUpperCase()));
    const watched = new Set(portfolio.watchlist.map((entry) => entry.instrument.toUpperCase()));
    const ageMs = Math.max(0, nowTime - Math.min(portfolioTime, instrumentTime));
    const freshness = ageMs <= this.#options.maximumAgeMs ? "current" : "stale";
    const impacts = new Map<string, PortfolioImpact>();

    for (const reference of references) {
      const matches = selectInstrumentMatches(reference, portfolio.instruments);
      for (const match of matches) {
        const relationship = heldAssets.has(match.instrument.baseAsset)
          ? "holding"
          : watchlistMatches(watched, match.instrument)
            ? "watchlist"
            : undefined;
        if (relationship === undefined) continue;
        const mappingConfidence = Math.round(reference.confidence * match.weight * 10_000) / 10_000;
        const impact: PortfolioImpact = Object.freeze({
          instrument: match.instrument.symbol,
          instrumentKind: match.instrument.kind,
          relationship,
          mappingConfidence,
          confidenceBand:
            mappingConfidence >= 0.85 ? "high" : mappingConfidence >= 0.65 ? "medium" : "low",
          mappingBasis: match.basis,
          freshness,
          ageMs,
          maximumAgeMs: this.#options.maximumAgeMs,
          portfolioRetrievedAt: portfolio.portfolioRetrievedAt,
          eventAsOf: event.asOf,
          explanation: `${relationship === "holding" ? "Owned asset" : "Watched instrument"} matched the verified event by ${match.basis.replaceAll("_", " ")}; portfolio data is ${freshness}.`,
        });
        const previous = impacts.get(impact.instrument);
        if (
          previous === undefined ||
          previous.relationship === "watchlist" ||
          impact.mappingConfidence > previous.mappingConfidence
        ) {
          impacts.set(impact.instrument, impact);
        }
      }
    }
    return Object.freeze(
      [...impacts.values()].sort((left, right) => left.instrument.localeCompare(right.instrument)),
    );
  }

  static modelContext(
    input: Readonly<{ explicitlyPermitted: boolean; impacts: readonly PortfolioImpact[] }>,
  ): readonly PortfolioImpact[] {
    return input.explicitlyPermitted ? Object.freeze([...input.impacts]) : Object.freeze([]);
  }

  static publicEvidenceContext(impacts: readonly PortfolioImpact[]): readonly never[] {
    void impacts;
    return Object.freeze([]);
  }

  async #request<T>(
    operation: "assets" | "instruments",
    endpoint: BitgetReadEndpoint,
    parse: (data: unknown) => T,
    signal?: AbortSignal,
  ): Promise<Readonly<{ value: T; requestTime: string }>> {
    for (let attempt = 1; attempt <= this.#options.maximumRetries + 1; attempt += 1) {
      const startedAt = this.#now();
      try {
        const envelope = parseEnvelope(await this.#transport.get(endpoint, signal));
        const value = parse(envelope.data);
        this.#record(operation, "success", attempt, this.#now() - startedAt);
        return Object.freeze({ value, requestTime: envelope.requestTime });
      } catch (error) {
        const failure = normalizeFailure(error);
        const canRetry = failure.retryable && attempt <= this.#options.maximumRetries;
        this.#record(
          operation,
          canRetry ? "retry" : "failure",
          attempt,
          this.#now() - startedAt,
          failure,
        );
        if (!canRetry) throw failure;
        await this.#sleep(this.#options.retryBaseDelayMs * 2 ** (attempt - 1), signal);
      }
    }
    throw new BitgetIntegrationError("BITGET_UNAVAILABLE", "Bitget is unavailable.");
  }

  #record(
    operation: "assets" | "instruments",
    outcome: "success" | "retry" | "failure",
    attempt: number,
    durationMs: number,
    failure?: BitgetIntegrationError,
  ): void {
    this.#telemetry?.record({
      operation,
      accountMode: this.#accountMode,
      outcome,
      attempt,
      durationMs: Math.max(0, durationMs),
      ...(failure === undefined ? {} : { errorCode: failure.code }),
      ...(failure?.providerCode === undefined ? {} : { providerCode: failure.providerCode }),
      ...(failure?.status === undefined ? {} : { status: failure.status }),
    });
  }
}

function validateReference(reference: ResolvedEventInstrument): ResolvedEventInstrument {
  const symbol = normalizeIdentifier(reference.symbol, "Event instrument");
  if (
    typeof reference.confidence !== "number" ||
    !Number.isFinite(reference.confidence) ||
    reference.confidence < 0 ||
    reference.confidence > 1 ||
    !["bitget", "issuer", "registry", "manual"].includes(reference.source)
  ) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Resolved event instrument is invalid.",
    );
  }
  return Object.freeze({ ...reference, symbol });
}

interface InstrumentMatch {
  readonly instrument: BitgetInstrument;
  readonly basis: PortfolioImpact["mappingBasis"];
  readonly weight: number;
}

function selectInstrumentMatches(
  reference: ResolvedEventInstrument,
  instruments: readonly BitgetInstrument[],
): readonly InstrumentMatch[] {
  const value = reference.symbol.startsWith("$") ? reference.symbol.slice(1) : reference.symbol;
  const exact = instruments.filter((instrument) => instrument.symbol === value);
  if (exact.length > 0) {
    return exact.map((instrument) => ({ instrument, basis: "exact_instrument", weight: 1 }));
  }
  const base = instruments.filter((instrument) => instrument.baseAsset === value);
  if (base.length > 0) {
    const preferred = base.filter((instrument) => instrument.quoteAsset === "USDT");
    return (preferred.length > 0 ? preferred : base).map((instrument) => ({
      instrument,
      basis: "base_asset",
      weight: 0.98,
    }));
  }
  const underlying = instruments.filter((instrument) => instrument.underlyingSymbol === value);
  const preferred = underlying.filter((instrument) => instrument.quoteAsset === "USDT");
  return (preferred.length > 0 ? preferred : underlying).map((instrument) => ({
    instrument,
    basis: "rtoken_underlying",
    weight: 0.9,
  }));
}

function watchlistMatches(watchlist: ReadonlySet<string>, instrument: BitgetInstrument): boolean {
  return (
    watchlist.has(instrument.symbol) ||
    watchlist.has(instrument.baseAsset) ||
    (instrument.underlyingSymbol !== undefined && watchlist.has(instrument.underlyingSymbol))
  );
}
