import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/index.js";
import { explainVerdict, resolveReview } from "../src/review.js";
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
describe("review verdicts", () => {
  it("renders a safe, actionable explanation without active content", () =>
    expect(
      explainVerdict({
        disposition: "review",
        reasonCodes: ["EVIDENCE_BELOW_THRESHOLD"],
        evidenceFreshness: "stale",
        safeExcerpt: "<script>unsafe</script>",
      }),
    ).toMatchObject({
      nextAction: "request_review",
      preview: { text: "scriptunsafe/script", redacted: true },
    }));
  it("authorizes and audits eligible review resolution only", () => {
    const events: unknown[] = [];
    expect(
      resolveReview(
        {
          authorized: true,
          verdictId: "v",
          reviewerId: "r",
          originalDisposition: "review",
          nonOverridable: false,
          outcome: "approved",
          reasonCode: "EVIDENCE_CONFIRMED",
          occurredAt: "2026-10-02T00:00:00Z",
        },
        { append: (event) => events.push(event) },
      ),
    ).toMatchObject({ outcome: "approved" });
    expect(events).toHaveLength(1);
    expect(() =>
      resolveReview(
        {
          authorized: true,
          verdictId: "v",
          reviewerId: "r",
          originalDisposition: "block",
          nonOverridable: true,
          outcome: "approved",
          reasonCode: "x",
          occurredAt: "now",
        },
        { append: () => undefined },
      ),
    ).toThrow("NOT_ELIGIBLE");
  });
});
