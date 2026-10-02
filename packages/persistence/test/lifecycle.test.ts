import { describe, expect, it } from "vitest";
import {
  createLegalHold,
  mayForwardToModel,
  planDeletion,
  scheduleRetention,
} from "../src/index.js";
describe("privacy lifecycle", () => {
  it("bounds retention and records backup expiry separately", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    expect(scheduleRetention("raw_untrusted_content", createdAt)).toEqual({
      retentionUntil: new Date("2026-01-08T00:00:00.000Z"),
      backupExpiresAt: new Date("2026-02-12T00:00:00.000Z"),
    });
    expect(() => scheduleRetention("raw_untrusted_content", createdAt, 31)).toThrow("exceeds");
  });
  it("fails deletion closed for active holds and returns a complete propagation plan when due", () => {
    const hold = createLegalHold("quarantined_content", "LEGAL_CASE_1", new Date("2026-02-01"));
    expect(
      planDeletion({
        asset: "quarantined_content",
        hold,
        now: new Date("2026-03-01"),
        retentionUntil: new Date("2026-02-01"),
      }),
    ).toEqual({ allowed: false, reason: "legal_hold" });
    expect(
      planDeletion({
        asset: "raw_untrusted_content",
        now: new Date("2026-02-01"),
        retentionUntil: new Date("2026-01-08"),
      }),
    ).toMatchObject({
      allowed: true,
      targets: ["primary_store", "object_store", "queue", "cache", "search_index"],
    });
  });
  it("prohibits secret forwarding and requires explicit consent for confidential provider data", () => {
    expect(mayForwardToModel("recoverable_credentials", true)).toBe(false);
    expect(mayForwardToModel("raw_untrusted_content", false)).toBe(false);
    expect(mayForwardToModel("raw_untrusted_content", true)).toBe(true);
    expect(() => createLegalHold("recoverable_credentials", "LEGAL_CASE_1", new Date())).toThrow(
      "cannot",
    );
  });
});
