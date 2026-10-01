import { isIP } from "node:net";

export const RETRIEVAL_POLICY_VERSION = "1.0" as const;
export const RETRIEVAL_LIMITS = Object.freeze({
  connectTimeoutMs: 10_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  responseTimeoutMs: 15_000,
});

export class RetrievalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RetrievalError";
  }
}

function ipv4Private(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [a, b] = octets;
  if (a === undefined || b === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function ipv6Private(address: string): boolean {
  const value = address.toLowerCase();
  if (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  )
    return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  return mapped === undefined ? false : ipv4Private(mapped);
}

export function assertPublicAddress(address: string): void {
  const family = isIP(address);
  if (family === 0)
    throw new RetrievalError("INVALID_RESOLUTION", "Resolver returned an invalid address.");
  if ((family === 4 && ipv4Private(address)) || (family === 6 && ipv6Private(address))) {
    throw new RetrievalError(
      "PRIVATE_ADDRESS_BLOCKED",
      "Resolved address is not publicly routable.",
    );
  }
}

export function parseRetrievalUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RetrievalError("INVALID_URL", "URL is invalid.");
  }
  if (url.protocol !== "https:")
    throw new RetrievalError("SCHEME_BLOCKED", "Only HTTPS retrieval is allowed.");
  if (url.username !== "" || url.password !== "")
    throw new RetrievalError("CREDENTIAL_URL_BLOCKED", "URLs with credentials are not allowed.");
  if (url.hostname === "" || (url.port !== "" && url.port !== "443"))
    throw new RetrievalError("AUTHORITY_BLOCKED", "URL authority is not allowed.");
  const host =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  if (isIP(host)) assertPublicAddress(host);
  return url;
}

export function normalizeContentType(value: string | undefined): string | undefined {
  if (value === undefined)
    throw new RetrievalError("CONTENT_TYPE_BLOCKED", "Response content type is required.");
  const type = value.split(";", 1)[0]?.trim().toLowerCase();
  if (type === undefined || type === "") return undefined;
  const allowed = new Set([
    "application/json",
    "application/pdf",
    "application/xml",
    "text/html",
    "text/plain",
    "text/xml",
  ]);
  if (!allowed.has(type))
    throw new RetrievalError("CONTENT_TYPE_BLOCKED", "Response content type is not permitted.");
  return type;
}
