import { describe, expect, it } from "vitest";

import { attackScenarios, liveAttackScenarios, pipelineAttackScenarios } from "./attack-lab.js";

describe("attack lab capability labels", () => {
  it("keeps live hosted scenarios separate from full-pipeline scenarios", () => {
    expect(liveAttackScenarios()).toHaveLength(4);
    expect(pipelineAttackScenarios()).toHaveLength(2);
    expect(attackScenarios).toHaveLength(6);
  });

  it("does not label encoded or stale-evidence scenarios as live hosted detections", () => {
    expect(pipelineAttackScenarios().map((scenario) => scenario.id)).toEqual([
      "encoded-fragment",
      "stale-conflict",
    ]);
  });

  it("provides an executable payload for every live scenario", () => {
    for (const scenario of liveAttackScenarios()) {
      expect(scenario.text.length).toBeGreaterThan(20);
      expect(["allow", "review", "block"]).toContain(scenario.expected);
    }
  });
});
