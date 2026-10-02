import { describe, expect, it } from "vitest";

import { canOpen, nextOnboardingAction, onboardingSteps } from "./console-state.js";

describe("console workspace state", () => {
  it("does not expose settings to roles without workspace administration access", () => {
    expect(canOpen("analyst", "settings")).toBe(false);
    expect(canOpen("admin", "settings")).toBe(true);
  });

  it("keeps read-only exchange credentials explicit during onboarding", () => {
    const apiKey = onboardingSteps({
      hasWorkspace: true,
      hasMember: true,
      hasApiKey: false,
      hasSample: false,
    })[2];
    expect(apiKey?.detail).toContain("read-only");
  });

  it("selects the first incomplete onboarding action", () => {
    const step = nextOnboardingAction(
      onboardingSteps({ hasWorkspace: true, hasMember: false, hasApiKey: false, hasSample: false }),
    );
    expect(step?.id).toBe("members");
  });
});
