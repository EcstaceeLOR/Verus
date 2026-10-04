import { createHmac } from "node:crypto";
import {
  BitgetIntegrationError,
  type BitgetReadEndpoint,
  type BitgetTransportResponse,
  type ReadonlyBitgetTransport,
} from "./contracts.js";

type Fetch = typeof globalThis.fetch;

export interface BitgetRestCredentials {
  readonly apiKey: string;
  readonly secretKey: string;
  readonly passphrase: string;
}

export interface BitgetRestTransportOptions {
  readonly credentials: BitgetRestCredentials;
  readonly baseUrl?: string;
  readonly allowCustomBaseUrl?: boolean;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly fetch?: Fetch;
  readonly now?: () => number;
}

const endpoints = new Set<BitgetReadEndpoint>([
  "/api/v2/spot/account/assets",
  "/api/v3/account/assets",
  "/api/v3/market/instruments?category=SPOT",
]);

function validateOptions(options: BitgetRestTransportOptions): Readonly<{
  baseUrl: URL;
  timeoutMs: number;
  maximumResponseBytes: number;
}> {
  if (
    !options.credentials.apiKey.trim() ||
    !options.credentials.secretKey.trim() ||
    !options.credentials.passphrase.trim()
  ) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "All Bitget credential fields are required.",
    );
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(options.baseUrl ?? "https://api.bitget.com");
  } catch (cause) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Invalid Bitget API base URL.",
      { cause },
    );
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "The Bitget API base URL must use HTTPS without embedded credentials.",
    );
  }
  if (baseUrl.hostname !== "api.bitget.com" && options.allowCustomBaseUrl !== true) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Custom Bitget API hosts require explicit test or private-egress configuration.",
    );
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Bitget timeout must be between 100 and 60000 milliseconds.",
    );
  }
  const maximumResponseBytes = options.maximumResponseBytes ?? 2_000_000;
  if (
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 1_024 ||
    maximumResponseBytes > 10_000_000
  ) {
    throw new BitgetIntegrationError(
      "BITGET_CONFIGURATION_INVALID",
      "Bitget response budget must be between 1024 and 10000000 bytes.",
    );
  }
  return Object.freeze({ baseUrl, timeoutMs, maximumResponseBytes });
}

export class BitgetRestTransport implements ReadonlyBitgetTransport {
  readonly #baseUrl: URL;
  readonly #timeoutMs: number;
  readonly #maximumResponseBytes: number;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  #credentials: BitgetRestCredentials | undefined;

  constructor(options: BitgetRestTransportOptions) {
    const validated = validateOptions(options);
    this.#baseUrl = validated.baseUrl;
    this.#timeoutMs = validated.timeoutMs;
    this.#maximumResponseBytes = validated.maximumResponseBytes;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#credentials = Object.freeze({ ...options.credentials });
  }

  disconnect(): void {
    this.#credentials = undefined;
  }

  async get(endpoint: BitgetReadEndpoint, signal?: AbortSignal): Promise<BitgetTransportResponse> {
    if (!endpoints.has(endpoint)) {
      throw new BitgetIntegrationError(
        "BITGET_CONFIGURATION_INVALID",
        "The requested Bitget endpoint is not in the read-only allowlist.",
      );
    }
    const credentials = this.#credentials;
    if (credentials === undefined) {
      throw new BitgetIntegrationError(
        "BITGET_CREDENTIAL_REVOKED",
        "The Bitget integration has been disconnected.",
      );
    }
    if (signal?.aborted) {
      throw new BitgetIntegrationError("BITGET_CANCELLED", "The Bitget request was cancelled.");
    }
    const publicEndpoint = endpoint === "/api/v3/market/instruments?category=SPOT";
    const timestamp = String(this.#now());
    const signature = publicEndpoint
      ? undefined
      : createHmac("sha256", credentials.secretKey)
          .update(`${timestamp}GET${endpoint}`)
          .digest("base64");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.#fetch(new URL(endpoint, this.#baseUrl), {
        method: "GET",
        signal: controller.signal,
        headers: publicEndpoint
          ? { "content-type": "application/json", locale: "en-US" }
          : {
              "ACCESS-KEY": credentials.apiKey,
              "ACCESS-SIGN": signature as string,
              "ACCESS-TIMESTAMP": timestamp,
              "ACCESS-PASSPHRASE": credentials.passphrase,
              "content-type": "application/json",
              locale: "en-US",
            },
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > this.#maximumResponseBytes) {
        throw new BitgetIntegrationError(
          "BITGET_RESPONSE_INVALID",
          "Bitget response exceeds the configured byte budget.",
          { status: response.status },
        );
      }
      const serialized = await response.text();
      if (Buffer.byteLength(serialized, "utf8") > this.#maximumResponseBytes) {
        throw new BitgetIntegrationError(
          "BITGET_RESPONSE_INVALID",
          "Bitget response exceeds the configured byte budget.",
          { status: response.status },
        );
      }
      let body: unknown;
      try {
        body = JSON.parse(serialized) as unknown;
      } catch (cause) {
        throw new BitgetIntegrationError(
          "BITGET_RESPONSE_INVALID",
          "Bitget returned a non-JSON response.",
          { status: response.status, cause },
        );
      }
      return Object.freeze({ status: response.status, body });
    } catch (error) {
      if (error instanceof BitgetIntegrationError) throw error;
      if (signal?.aborted) {
        throw new BitgetIntegrationError("BITGET_CANCELLED", "The Bitget request was cancelled.", {
          cause: error,
        });
      }
      throw new BitgetIntegrationError(
        "BITGET_UNAVAILABLE",
        timedOut ? "The Bitget request timed out." : "Bitget is unavailable.",
        { retryable: true, cause: error },
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
