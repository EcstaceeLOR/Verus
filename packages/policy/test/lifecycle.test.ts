import { expect, it } from "vitest";
import { canTransition, validatePolicy } from "../src/lifecycle.js";
it("protects non-overridable controls", () =>
  expect(
    validatePolicy({
      id: "p",
      version: 2,
      lifecycle: "draft",
      author: "a",
      reason: "x",
      controls: { prompt_injection: false, tenant_isolation: true, audit: true },
    }),
  ).toContain("NON_OVERRIDABLE_PROMPT_INJECTION"));
it("does not rewrite active history", () =>
  expect(canTransition("active", "superseded")).toBe(true));
