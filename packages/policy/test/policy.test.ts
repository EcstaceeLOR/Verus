import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/index.js";
const base = {
  policyAvailable: true,
  policyDigest: "sha256:policy",
  policyVersion: "v1",
  controls: [],
  findings: [],
  evidence: { required: false, minimumBps: 0, claimBps: [], materialConflict: false },
  rules: [],
} as const;
describe("policy evaluator", () => {
  it("is deterministic and applies non-overridable floors", () => {
    const input = {
      ...base,
      findings: [{ id: "a", category: "obfuscation", severity: "high" as const }],
      rules: [{ id: "workspace", action: "allow" as const, layer: "workspace" as const }],
    };
    expect(evaluatePolicy(input)).toMatchObject({
      disposition: "block",
      reasonCodes: ["FINDING_HIGH"],
    });
  });
  it("fails closed for missing required controls", () =>
    expect(
      evaluatePolicy({
        ...base,
        controls: [{ id: "parser", required: true, class: "content", status: "unavailable" }],
      }),
    ).toMatchObject({ disposition: "block" }));
});
