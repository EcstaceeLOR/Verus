import { describe, expect, it } from "vitest";

import controlPlane, { opaqueId } from "../api/control-plane.js";
import type { HostedResponse } from "../api/http.js";

function responseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const response: HostedResponse = {
    status(code) {
      statusCode = code;
      return response;
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    json(value) {
      body = value;
    },
  };
  return { response, statusCode: () => statusCode, body: () => body, headers };
}

describe("hosted console control plane", () => {
  it("creates database-safe opaque identifiers", () => {
    for (const prefix of ["ws", "user", "member", "session", "invite", "event", "svc", "key"]) {
      expect(opaqueId(prefix)).toMatch(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`));
    }
  });

  it("fails closed before accessing state when no bearer session is present", async () => {
    const recorded = responseRecorder();
    await controlPlane({ method: "GET", headers: {} }, recorded.response);
    expect(recorded.statusCode()).toBe(401);
    expect(recorded.body()).toEqual({
      error: "AUTHENTICATION_REQUIRED",
      message: "Sign in to continue.",
    });
    expect(recorded.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unsupported methods without touching authentication", async () => {
    const recorded = responseRecorder();
    await controlPlane({ method: "DELETE" }, recorded.response);
    expect(recorded.statusCode()).toBe(405);
    expect(recorded.headers.get("allow")).toBe("GET, POST");
  });
});
