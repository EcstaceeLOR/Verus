import { expect, it } from "vitest";
import { safeFinding } from "./review-state.js";
it("keeps hostile finding locations inert", () =>
  expect(
    safeFinding({
      id: "f",
      category: "hidden_content",
      severity: "high",
      location: "<img onerror=alert(1)>",
      reason: "X",
    })?.location,
  ).toBe("img onerror=alert(1)"));
