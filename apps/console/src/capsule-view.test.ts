import { expect, it } from "vitest";
import { capsuleView } from "./capsule-view.js";
it("marks changed capsules invalid", () =>
  expect(
    capsuleView({ capsule_id: "cap_1", created_at: "2026-01-01", claims: [], evidence: [] }, false)
      ?.verification,
  ).toBe("invalid"));
