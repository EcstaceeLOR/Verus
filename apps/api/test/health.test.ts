import { describe, expect, it } from "vitest";

import { healthPayload, parsePort } from "../src/health.js";

describe("API bootstrap health", () => {
  it("exposes a stable non-sensitive health payload", () => {
    expect(healthPayload).toEqual({ service: "verus-api", status: "ok", version: "0.0.0" });
  });

  it.each(["0", "65536", "3.14", "not-a-port"])("rejects invalid port %s", (value) => {
    expect(() => parsePort(value)).toThrow(RangeError);
  });

  it("accepts a valid port", () => {
    expect(parsePort("3001")).toBe(3001);
  });
});
