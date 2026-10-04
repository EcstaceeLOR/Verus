import {
  BitgetIntegrationError,
  type BitgetHolding,
  type BitgetInstrument,
  type BitgetInstrumentKind,
  type BitgetTransportResponse,
} from "./contracts.js";

const retryableProviderCodes = new Set([
  "429",
  "25000",
  "25001",
  "25003",
  "25004",
  "40015",
  "40725",
  "40808",
  "45001",
]);
const revokedProviderCodes = new Set(["40001", "40002", "40003", "40006", "40009"]);
const permissionProviderCodes = new Set(["40301", "40752", "40753"]);
const decimalPattern = /^-?\d+(?:\.\d+)?$/u;

interface BitgetEnvelope {
  readonly data: unknown;
  readonly requestTime: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerCode(body: unknown): string | undefined {
  const value = record(body)?.code;
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function parseEnvelope(response: BitgetTransportResponse): Readonly<BitgetEnvelope> {
  const code = providerCode(response.body);
  if (response.status === 401 || (code !== undefined && revokedProviderCodes.has(code))) {
    throw new BitgetIntegrationError(
      "BITGET_CREDENTIAL_REVOKED",
      "Bitget rejected or revoked the integration credential.",
      {
        status: response.status,
        ...(code === undefined ? {} : { providerCode: code }),
      },
    );
  }
  if (response.status === 403 || (code !== undefined && permissionProviderCodes.has(code))) {
    throw new BitgetIntegrationError(
      "BITGET_PERMISSION_DENIED",
      "Bitget denied the required read-only operation.",
      {
        status: response.status,
        ...(code === undefined ? {} : { providerCode: code }),
      },
    );
  }
  if (response.status === 429 || code === "429") {
    throw new BitgetIntegrationError("BITGET_RATE_LIMITED", "Bitget rate-limited the request.", {
      retryable: true,
      status: response.status,
      ...(code === undefined ? {} : { providerCode: code }),
    });
  }
  if (response.status >= 500 || (code !== undefined && retryableProviderCodes.has(code))) {
    throw new BitgetIntegrationError("BITGET_UNAVAILABLE", "Bitget is temporarily unavailable.", {
      retryable: true,
      status: response.status,
      ...(code === undefined ? {} : { providerCode: code }),
    });
  }
  const body = record(response.body);
  if (response.status < 200 || response.status >= 300 || body === undefined || code !== "00000") {
    throw new BitgetIntegrationError(
      "BITGET_RESPONSE_INVALID",
      "Bitget returned an unsupported response.",
      {
        status: response.status,
        ...(code === undefined ? {} : { providerCode: code }),
      },
    );
  }
  const requestTime = body.requestTime;
  const numericTime = typeof requestTime === "number" ? requestTime : Number(requestTime);
  const parsedTime = new Date(numericTime);
  if (
    !Number.isSafeInteger(numericTime) ||
    numericTime <= 0 ||
    !Number.isFinite(parsedTime.getTime())
  ) {
    throw new BitgetIntegrationError("BITGET_RESPONSE_INVALID", "Bitget response time is invalid.");
  }
  return Object.freeze({ data: body.data, requestTime: parsedTime.toISOString() });
}

function normalizeIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new BitgetIntegrationError("BITGET_RESPONSE_INVALID", `Bitget ${name} is invalid.`);
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9$._-]{1,64}$/u.test(normalized)) {
    throw new BitgetIntegrationError("BITGET_RESPONSE_INVALID", `Bitget ${name} is invalid.`);
  }
  return normalized;
}

function decimal(value: unknown, allowNegative = false): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (
    !decimalPattern.test(trimmed) ||
    (!allowNegative && trimmed.startsWith("-")) ||
    trimmed.replace(/[.-]/gu, "").length > 100
  )
    return undefined;
  return trimmed;
}

function sumDecimals(values: readonly string[]): string {
  const scale = values.reduce((maximum, value) => {
    const fraction = value.split(".")[1]?.length ?? 0;
    return Math.max(maximum, fraction);
  }, 0);
  const total = values.reduce((sum, value) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return sum + BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  }, 0n);
  if (scale === 0) return total.toString();
  const padded = total.toString().padStart(scale + 1, "0");
  const normalized = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`
    .replace(/0+$/u, "")
    .replace(/\.$/u, "");
  return normalized || "0";
}

function assets(data: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(data)) {
    if (data.every((entry) => record(entry)?.coin !== undefined)) {
      return data.map((entry) => record(entry) as Record<string, unknown>);
    }
    return data.flatMap((entry) => {
      const nested = record(entry)?.assets;
      return Array.isArray(nested)
        ? nested.map((asset) => record(asset)).filter((asset) => asset !== undefined)
        : [];
    });
  }
  const nested = record(data)?.assets;
  return Array.isArray(nested)
    ? nested.map((asset) => record(asset)).filter((asset) => asset !== undefined)
    : [];
}

export function parseHoldings(data: unknown): readonly BitgetHolding[] {
  const seen = new Set<string>();
  const holdings = assets(data).flatMap((asset) => {
    const name = normalizeIdentifier(asset.coin, "asset identifier");
    if (seen.has(name)) {
      throw new BitgetIntegrationError(
        "BITGET_RESPONSE_INVALID",
        "Bitget returned duplicate assets.",
      );
    }
    seen.add(name);
    const balance = decimal(asset.balance, true);
    const components = [
      decimal(asset.available),
      decimal(asset.frozen),
      decimal(asset.locked),
    ].filter((value) => value !== undefined);
    const quantity = balance ?? (components.length > 0 ? sumDecimals(components) : undefined);
    if (quantity === undefined) {
      throw new BitgetIntegrationError(
        "BITGET_RESPONSE_INVALID",
        "Bitget returned an invalid asset balance.",
      );
    }
    return BigInt(quantity.replace(".", "")) <= 0n
      ? []
      : [Object.freeze({ asset: name, quantity })];
  });
  return Object.freeze(holdings.sort((left, right) => left.asset.localeCompare(right.asset)));
}

function instrumentKind(
  candidate: Record<string, unknown>,
  baseAsset: string,
): BitgetInstrumentKind {
  const reality = typeof candidate.isReality === "string" ? candidate.isReality.toLowerCase() : "";
  const symbolType =
    typeof candidate.symbolType === "string" ? candidate.symbolType.toLowerCase() : "";
  if (reality === "yes" || (symbolType === "stock" && /^R[A-Z]/u.test(baseAsset))) return "rtoken";
  if (symbolType === "crypto" || symbolType === "") return "crypto";
  return "other";
}

export function parseInstruments(data: unknown): readonly BitgetInstrument[] {
  if (!Array.isArray(data)) {
    throw new BitgetIntegrationError(
      "BITGET_RESPONSE_INVALID",
      "Bitget instrument catalog is invalid.",
    );
  }
  const seen = new Set<string>();
  const instruments = data.map((entry) => {
    const candidate = record(entry);
    if (candidate === undefined) {
      throw new BitgetIntegrationError(
        "BITGET_RESPONSE_INVALID",
        "Bitget instrument entry is invalid.",
      );
    }
    const symbol = normalizeIdentifier(candidate.symbol, "instrument symbol");
    const baseAsset = normalizeIdentifier(candidate.baseCoin, "base asset");
    const quoteAsset = normalizeIdentifier(candidate.quoteCoin, "quote asset");
    if (seen.has(symbol)) {
      throw new BitgetIntegrationError(
        "BITGET_RESPONSE_INVALID",
        "Bitget returned duplicate instruments.",
      );
    }
    seen.add(symbol);
    const kind = instrumentKind(candidate, baseAsset);
    const statusValue =
      typeof candidate.status === "string" ? candidate.status.toLowerCase() : "unknown";
    const status =
      statusValue === "online" ? "online" : statusValue === "offline" ? "offline" : "unknown";
    const underlyingSymbol =
      kind === "rtoken" && /^R[A-Z0-9$._-]+$/u.test(baseAsset) ? baseAsset.slice(1) : undefined;
    return Object.freeze({
      symbol,
      baseAsset,
      quoteAsset,
      kind,
      status,
      ...(underlyingSymbol === undefined ? {} : { underlyingSymbol }),
    });
  });
  return Object.freeze(instruments.sort((left, right) => left.symbol.localeCompare(right.symbol)));
}
