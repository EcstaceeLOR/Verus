import type { ServerResponse } from "node:http";

/**
 * Applies a conservative browser policy to every API response. API routes use bearer
 * credentials, not ambient cookies, so they deliberately do not opt into CORS or CSRF
 * exceptions. A browser from another origin cannot read these responses.
 */
export function applySecurityHeaders(
  response: ServerResponse,
  options?: { readonly https?: boolean },
): void {
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader(
    "permissions-policy",
    "accelerometer=(), camera=(), geolocation=(), microphone=()",
  );
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("cache-control", "no-store");
  response.setHeader("vary", "Origin");
  if (options?.https === true) {
    response.setHeader("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  }
}
