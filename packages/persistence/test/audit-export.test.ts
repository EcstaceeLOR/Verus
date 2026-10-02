import { expect, it } from "vitest";
import { exportAudit } from "../src/audit-export.js";
it("exports a checkable retention-aware audit artifact", () =>
  expect(
    exportAudit(
      [{ id: "e", action: "scan.created", occurredAt: "2026-01-01", actor: "a", target: "s" }],
      "2027-01-01",
    ).digest,
  ).toMatch(/^sha256:/));
