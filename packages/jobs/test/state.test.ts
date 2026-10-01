import { describe, expect, it } from "vitest";

import { assertJobFailure, canTransitionJob, retryDelayMs } from "../src/index.js";

describe("job state machine", () => {
  it("allows only explicit non-terminal transitions", () => {
    expect(canTransitionJob("available", "leased")).toBe(true);
    expect(canTransitionJob("leased", "retry_wait")).toBe(true);
    expect(canTransitionJob("leased", "succeeded")).toBe(true);
    expect(canTransitionJob("succeeded", "leased")).toBe(false);
    expect(canTransitionJob("dead_lettered", "available")).toBe(false);
  });

  it("uses bounded exponential retry delays", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(4)).toBe(8_000);
    expect(retryDelayMs(100)).toBe(15 * 60_000);
    expect(() => retryDelayMs(0)).toThrow("Invalid job attempt");
  });

  it("binds stable failure codes to retry policy", () => {
    expect(() => assertJobFailure("JOB_LEASE_EXPIRED", true)).not.toThrow();
    expect(() => assertJobFailure("JOB_LEASE_EXPIRED", false)).toThrow("do not match");
    expect(() => assertJobFailure("hostile-payload", false)).toThrow("do not match");
  });
});
