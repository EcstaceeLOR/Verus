import { describe, expect, it } from "vitest";

import { fixedClock } from "../src/index.js";

describe("fixedClock", () => {
  it("returns independent Date values at one deterministic instant", () => {
    const clock = fixedClock("2026-10-01T00:00:00.000Z");
    expect(clock.now()).not.toBe(clock.now());
    expect(clock.now().toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rejects invalid time", () => {
    expect(() => fixedClock("not-a-time")).toThrow(TypeError);
  });
});
