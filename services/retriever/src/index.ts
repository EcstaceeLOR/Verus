import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { Socket } from "node:net";

import {
  RETRIEVAL_LIMITS,
  RETRIEVAL_POLICY_VERSION,
  RetrievalError,
  assertPublicAddress,
  normalizeContentType,
  parseRetrievalUrl,
} from "./policy.js";

export {
  RETRIEVAL_LIMITS,
  RETRIEVAL_POLICY_VERSION,
  RetrievalError,
  assertPublicAddress,
  parseRetrievalUrl,
} from "./policy.js";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}
export interface RedirectHop {
  readonly addresses: readonly string[];
  readonly status: number;
  readonly url: string;
}
export interface RetrievedContent {
  readonly body: Buffer;
  readonly contentType?: string;
  readonly digest: string;
  readonly fetchedAt: Date;
  readonly policyVersion: typeof RETRIEVAL_POLICY_VERSION;
  readonly redirects: readonly RedirectHop[];
  readonly tls?: Readonly<{ authorized: boolean; protocol?: string; servername: string }>;
  readonly url: string;
}

export interface RetrievalTelemetry {
  emit(
    event: Readonly<{
      event: string;
      outcome: "blocked" | "failure" | "success";
      reasonCode?: string;
    }>,
  ): void;
}
export interface RetrievalTransportResponse {
  readonly abort?: () => void;
  readonly body: AsyncIterable<Buffer>;
  readonly headers: IncomingHttpHeaders;
  readonly socket?: Socket & { authorized?: boolean; getProtocol?: () => string | null };
  readonly statusCode: number;
}
export interface RetrievalTransport {
  request(
    input: Readonly<{ address: ResolvedAddress; timeoutMs: number; url: URL }>,
  ): Promise<RetrievalTransportResponse>;
}

const noopTelemetry: RetrievalTelemetry = Object.freeze({ emit: () => undefined });

function safeEmit(
  telemetry: RetrievalTelemetry,
  event: Parameters<RetrievalTelemetry["emit"]>[0],
): void {
  try {
    telemetry.emit(event);
  } catch {
    /* telemetry never alters quarantine behavior */
  }
}

export class NodeHttpsTransport implements RetrievalTransport {
  async request(
    input: Readonly<{ address: ResolvedAddress; timeoutMs: number; url: URL }>,
  ): Promise<RetrievalTransportResponse> {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        input.url,
        {
          headers: {
            accept:
              "text/html, text/plain, application/json, application/xml, text/xml, application/pdf",
            "accept-encoding": "identity",
            host: input.url.host,
            "user-agent": "Verus-Retriever/1.0",
          },
          lookup: (_hostname, _options, callback) =>
            callback(null, input.address.address, input.address.family),
          rejectUnauthorized: true,
          servername: input.url.hostname,
          timeout: input.timeoutMs,
        },
        (response) =>
          resolve({
            abort: () => response.destroy(),
            body: response,
            headers: response.headers,
            socket: response.socket,
            statusCode: response.statusCode ?? 0,
          }),
      );
      request.once("timeout", () =>
        request.destroy(new RetrievalError("CONNECT_TIMEOUT", "Connection timed out.")),
      );
      request.once("error", reject);
      request.end();
    });
  }
}

export class HardenedRetriever {
  readonly #resolver: (host: string) => Promise<readonly ResolvedAddress[]>;
  readonly #telemetry: RetrievalTelemetry;
  readonly #transport: RetrievalTransport;

  constructor(
    options: {
      readonly resolver?: (host: string) => Promise<readonly ResolvedAddress[]>;
      readonly telemetry?: RetrievalTelemetry;
      readonly transport?: RetrievalTransport;
    } = {},
  ) {
    this.#resolver =
      options.resolver ??
      (async (host) =>
        (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => ({
          address: entry.address,
          family: entry.family as 4 | 6,
        })));
    this.#telemetry = options.telemetry ?? noopTelemetry;
    this.#transport = options.transport ?? new NodeHttpsTransport();
  }

  async retrieve(rawUrl: string): Promise<Readonly<RetrievedContent>> {
    const redirects: RedirectHop[] = [];
    let url = parseRetrievalUrl(rawUrl);
    try {
      for (
        let redirectCount = 0;
        redirectCount <= RETRIEVAL_LIMITS.maxRedirects;
        redirectCount += 1
      ) {
        const addresses = await this.#resolve(url);
        const response = await this.#transport.request({
          address: addresses[0] as ResolvedAddress,
          timeoutMs: RETRIEVAL_LIMITS.connectTimeoutMs,
          url,
        });
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.abort?.();
          redirects.push(
            Object.freeze({
              addresses: addresses.map(({ address }) => address),
              status: response.statusCode,
              url: url.toString(),
            }),
          );
          const location = response.headers.location;
          if (typeof location !== "string")
            throw new RetrievalError(
              "REDIRECT_LOCATION_MISSING",
              "Redirect has no valid location.",
            );
          if (redirectCount === RETRIEVAL_LIMITS.maxRedirects)
            throw new RetrievalError("REDIRECT_LIMIT", "Redirect limit exceeded.");
          url = parseRetrievalUrl(new URL(location, url).toString());
          continue;
        }
        if (response.statusCode < 200 || response.statusCode > 299)
          throw new RetrievalError(
            "HTTP_STATUS_REJECTED",
            "Remote server returned an unsuccessful status.",
          );
        if (
          response.headers["content-encoding"] !== undefined &&
          response.headers["content-encoding"] !== "identity"
        )
          throw new RetrievalError(
            "CONTENT_ENCODING_BLOCKED",
            "Encoded responses are not accepted.",
          );
        const length = Number(response.headers["content-length"]);
        if (Number.isFinite(length) && length > RETRIEVAL_LIMITS.maxBytes)
          throw new RetrievalError("DOWNLOAD_LIMIT", "Response exceeds byte limit.");
        const contentType = normalizeContentType(
          typeof response.headers["content-type"] === "string"
            ? response.headers["content-type"]
            : undefined,
        );
        const body = await this.#readBounded(response.body);
        const socket = response.socket;
        const protocol = socket?.getProtocol?.() ?? undefined;
        const tls =
          socket === undefined
            ? undefined
            : Object.freeze({
                authorized: socket.authorized === true,
                ...(protocol === undefined ? {} : { protocol }),
                servername: url.hostname,
              });
        if (tls !== undefined && !tls.authorized)
          throw new RetrievalError("TLS_UNAUTHORIZED", "TLS peer is not authorized.");
        const result = Object.freeze({
          body,
          ...(contentType === undefined ? {} : { contentType }),
          digest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
          fetchedAt: new Date(),
          policyVersion: RETRIEVAL_POLICY_VERSION,
          redirects: Object.freeze(redirects),
          ...(tls === undefined ? {} : { tls }),
          url: url.toString(),
        });
        safeEmit(this.#telemetry, { event: "retrieval.completed", outcome: "success" });
        return result;
      }
      throw new RetrievalError("REDIRECT_LIMIT", "Redirect limit exceeded.");
    } catch (error) {
      const outcome =
        error instanceof RetrievalError &&
        [
          "AUTHORITY_BLOCKED",
          "CONTENT_ENCODING_BLOCKED",
          "CONTENT_TYPE_BLOCKED",
          "CREDENTIAL_URL_BLOCKED",
          "DOWNLOAD_LIMIT",
          "INVALID_RESOLUTION",
          "INVALID_URL",
          "PRIVATE_ADDRESS_BLOCKED",
          "REDIRECT_LIMIT",
          "SCHEME_BLOCKED",
          "TLS_UNAUTHORIZED",
        ].includes(error.code)
          ? "blocked"
          : "failure";
      safeEmit(this.#telemetry, {
        event: "retrieval.rejected",
        outcome,
        ...(error instanceof RetrievalError ? { reasonCode: error.code } : {}),
      });
      throw error;
    }
  }

  async #resolve(url: URL): Promise<readonly ResolvedAddress[]> {
    if (url.hostname === "") throw new RetrievalError("AUTHORITY_BLOCKED", "URL has no hostname.");
    const addresses = await this.#resolver(url.hostname);
    if (addresses.length === 0) throw new RetrievalError("DNS_EMPTY", "Hostname has no addresses.");
    for (const entry of addresses) assertPublicAddress(entry.address);
    return addresses;
  }

  async #readBounded(body: AsyncIterable<Buffer>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += chunk.length;
      if (size > RETRIEVAL_LIMITS.maxBytes)
        throw new RetrievalError("DOWNLOAD_LIMIT", "Response exceeds byte limit.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
