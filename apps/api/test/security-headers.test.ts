import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { applySecurityHeaders } from "../src/security-headers.js";

function response(): ServerResponse {
  return {
    setHeader: (name: string, value: string) => headers.set(name, value),
  } as unknown as ServerResponse;
}

let headers = new Map<string, string>();

describe("API security headers", () => {
  it("defaults to a closed browser policy without transport assumptions", () => {
    headers = new Map();
    applySecurityHeaders(response());
    expect(headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("strict-transport-security")).toBeUndefined();
  });

  it("only sends HSTS when TLS termination is explicitly enforced", () => {
    headers = new Map();
    applySecurityHeaders(response(), { https: true });
    expect(headers.get("strict-transport-security")).toContain("includeSubDomains");
  });
});
