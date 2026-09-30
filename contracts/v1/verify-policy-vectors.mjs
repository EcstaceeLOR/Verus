import { readFile } from "node:fs/promises";

const dispositions = Object.freeze({ allow: 0, review: 1, block: 2 });
const categories = new Set([
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
const severities = new Set(["info", "low", "medium", "high", "critical"]);

function evaluate(input) {
  let rank = dispositions.allow;
  const reasons = new Set();
  const raise = (disposition, reason) => {
    if (!(disposition in dispositions)) {
      disposition = "block";
      reason = "UNKNOWN_POLICY_ACTION";
    }
    rank = Math.max(rank, dispositions[disposition]);
    if (reason) reasons.add(reason);
  };

  if (!input.policy_available) raise("block", "POLICY_NO_MATCH");

  for (const control of [...input.controls].sort((a, b) => a.id.localeCompare(b.id))) {
    if (control.status === "pass") continue;
    if (!control.required || control.class === "optional") {
      reasons.add("OPTIONAL_CONTROL_UNAVAILABLE");
      continue;
    }
    const reasonClass = control.class.toUpperCase();
    if (control.class === "evidence") {
      raise("review", `REQUIRED_${reasonClass}_CONTROL_${control.status.toUpperCase()}`);
    } else {
      raise("block", `REQUIRED_${reasonClass}_CONTROL_${control.status.toUpperCase()}`);
    }
  }

  for (const finding of [...input.findings].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!categories.has(finding.category)) {
      raise("block", "UNKNOWN_FINDING_CATEGORY");
      continue;
    }
    if (!severities.has(finding.severity)) {
      raise("block", "UNKNOWN_FINDING_SEVERITY");
      continue;
    }
    if (finding.severity === "medium") raise("review", "FINDING_MEDIUM");
    if (finding.severity === "high") raise("block", "FINDING_HIGH");
    if (finding.severity === "critical") raise("block", "FINDING_CRITICAL");
  }

  if (input.evidence.required) {
    if (input.evidence.claim_bps.some((value) => value < input.evidence.minimum_bps)) {
      raise("review", "EVIDENCE_BELOW_THRESHOLD");
    }
    if (input.evidence.material_conflict) {
      raise("review", "MATERIAL_CONFLICT_UNRESOLVED");
    }
  }

  for (const rule of [...input.rules].sort((a, b) => a.id.localeCompare(b.id))) {
    raise(rule.action, rule.reason_code);
  }

  const disposition = Object.keys(dispositions).find((key) => dispositions[key] === rank);
  return { disposition, reason_codes: [...reasons].sort() };
}

const fixtureUrl = new URL("./fixtures/policy-decision-vectors.json", import.meta.url);
const vectors = JSON.parse(await readFile(fixtureUrl, "utf8"));

for (const vector of vectors) {
  const actual = evaluate(vector);
  const reversed = evaluate({
    ...vector,
    findings: [...vector.findings].reverse(),
    controls: [...vector.controls].reverse(),
    rules: [...vector.rules].reverse(),
  });
  const expected = JSON.stringify(vector.expected);

  if (JSON.stringify(actual) !== expected) {
    throw new Error(`${vector.name}: expected ${expected}, received ${JSON.stringify(actual)}`);
  }
  if (JSON.stringify(reversed) !== expected) {
    throw new Error(`${vector.name}: collection order changed the result`);
  }
}

console.log(`Verified ${vectors.length} deterministic policy decision vectors.`);
