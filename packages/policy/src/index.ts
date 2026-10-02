export type Disposition = "allow" | "review" | "block";
type Input = Readonly<{
  policyAvailable: boolean;
  controls: readonly {
    id: string;
    required: boolean;
    class: "security" | "content" | "integrity" | "audit" | "evidence" | "optional";
    status: "pass" | "fail" | "unavailable";
  }[];
  findings: readonly {
    id: string;
    category: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
  }[];
  evidence: {
    required: boolean;
    minimumBps: number;
    claimBps: readonly number[];
    materialConflict: boolean;
  };
  rules: readonly {
    id: string;
    action: Disposition;
    reasonCode?: string;
    layer: "platform" | "workspace" | "integration";
  }[];
  policyDigest: string;
  policyVersion: string;
}>;
const rank: Record<Disposition, number> = { allow: 0, review: 1, block: 2 };
const known = new Set([
  "direct_prompt_injection",
  "indirect_prompt_injection",
  "obfuscation",
  "hidden_content",
  "source_mismatch",
  "stale_evidence",
  "contradiction",
  "parser_risk",
  "policy_failure",
  "other",
]);
export function evaluatePolicy(
  input: Input,
): Readonly<{
  disposition: Disposition;
  reasonCodes: readonly string[];
  policyDigest: string;
  policyVersion: string;
  matchedRuleIds: readonly string[];
}> {
  try {
    let result: Disposition = "allow";
    const reasons = new Set<string>();
    const matched: string[] = [];
    const raise = (value: Disposition, code?: string) => {
      if (rank[value] > rank[result]) result = value;
      if (code) reasons.add(code);
    };
    if (!input.policyAvailable || !input.policyDigest) raise("block", "POLICY_NO_MATCH");
    for (const control of [...input.controls].sort((a, b) => a.id.localeCompare(b.id)))
      if (control.status !== "pass") {
        if (!control.required || control.class === "optional")
          reasons.add("OPTIONAL_CONTROL_UNAVAILABLE");
        else
          raise(
            control.class === "evidence" ? "review" : "block",
            `REQUIRED_${control.class.toUpperCase()}_CONTROL_${control.status.toUpperCase()}`,
          );
      }
    for (const finding of [...input.findings].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!known.has(finding.category)) {
        raise("block", "UNKNOWN_FINDING_CATEGORY");
        continue;
      }
      if (finding.severity === "medium") raise("review", "FINDING_MEDIUM");
      if (finding.severity === "high") raise("block", "FINDING_HIGH");
      if (finding.severity === "critical") raise("block", "FINDING_CRITICAL");
    }
    if (
      input.evidence.required &&
      input.evidence.claimBps.some((value) => value < input.evidence.minimumBps)
    )
      raise("review", "EVIDENCE_BELOW_THRESHOLD");
    if (input.evidence.required && input.evidence.materialConflict)
      raise("review", "MATERIAL_CONFLICT_UNRESOLVED");
    for (const rule of [...input.rules].sort((a, b) => a.id.localeCompare(b.id))) {
      if (rule.layer !== "platform" && rule.action === "allow") {
        matched.push(rule.id);
        continue;
      }
      raise(rule.action, rule.reasonCode);
      matched.push(rule.id);
    }
    return Object.freeze({
      disposition: result,
      reasonCodes: Object.freeze([...reasons].sort()),
      policyDigest: input.policyDigest,
      policyVersion: input.policyVersion,
      matchedRuleIds: Object.freeze(matched.sort()),
    });
  } catch {
    return Object.freeze({
      disposition: "block",
      reasonCodes: Object.freeze(["POLICY_EVALUATION_FAILED"]),
      policyDigest: input.policyDigest,
      policyVersion: input.policyVersion,
      matchedRuleIds: Object.freeze([]),
    });
  }
}
