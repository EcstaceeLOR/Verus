import { isIP } from "node:net";
import type { DeliveryRecord } from "./store.js";
export interface TransportResponse {
  readonly retryAfterSeconds?: number;
  readonly status: number;
}
export interface WebhookTransport {
  send(
    delivery: DeliveryRecord,
    input: Readonly<{ body: string; headers: Readonly<Record<string, string>> }>,
  ): Promise<TransportResponse>;
}
function isPrivateIp(hostname: string): boolean {
  if (isIP(hostname) === 4) {
    const parts = hostname.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (isIP(hostname) === 6)
    return (
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe80:")
    );
  return false;
}
export function validateWebhookEndpoint(raw: string, allowedHosts?: ReadonlySet<string>): URL {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isPrivateIp(hostname) ||
    (allowedHosts !== undefined && !allowedHosts.has(hostname))
  )
    throw new TypeError("Webhook endpoint is not an allowed public HTTPS destination.");
  return url;
}
export class FetchWebhookTransport implements WebhookTransport {
  constructor(
    readonly options: Readonly<{
      allowedHosts?: ReadonlySet<string>;
      fetch?: typeof globalThis.fetch;
      timeoutMs?: number;
    }> = {},
  ) {}
  async send(
    delivery: DeliveryRecord,
    input: Readonly<{ body: string; headers: Readonly<Record<string, string>> }>,
  ): Promise<TransportResponse> {
    const url = validateWebhookEndpoint(delivery.endpointUrl, this.options.allowedHosts);
    const response = await (this.options.fetch ?? globalThis.fetch)(url, {
      body: input.body,
      headers: input.headers,
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    });
    const retry = response.headers.get("retry-after");
    const retryAfterSeconds = retry !== null && /^\d+$/u.test(retry) ? Number(retry) : undefined;
    response.body?.cancel().catch(() => undefined);
    return Object.freeze({
      status: response.status,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
}
