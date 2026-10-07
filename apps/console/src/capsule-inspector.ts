import type { HostedScanResult } from "./scan-workflow.js";

export interface SignedDemoCapsuleResponse {
  readonly artifact_type: "signed_demo_context_capsule";
  readonly source_scan: Readonly<{
    hosted_scan_id: string;
    cryptographically_signed: false;
    relationship: string;
  }>;
  readonly capsule: Readonly<{
    schema_version: string;
    capsule_id: string;
    scan_id: string;
    input_digest: string;
    created_at: string;
    as_of: string;
    claims: readonly unknown[];
    evidence: readonly unknown[];
    findings: readonly Readonly<{
      category: string;
      severity: string;
      detector_id: string;
      reason_code: string;
    }>[];
    conflicts: readonly unknown[];
    disposition: "allow" | "review" | "block";
    policy: Readonly<{
      policy_id: string;
      version: string;
      digest: string;
    }>;
    components: readonly Readonly<{
      component: string;
      version: string;
      digest: string;
    }>[];
    signature: Readonly<{
      algorithm: "Ed25519";
      key_id: string;
      signed_at: string;
      value: string;
    }>;
  }>;
  readonly verification: Readonly<{
    valid: true;
    artifact_digest: string;
    algorithm: "Ed25519";
    key_id: string;
    public_key: string;
    key_scope: "ephemeral_per_request_demo";
    production_key_attested: false;
  }>;
  readonly truth_boundary: Readonly<{
    signature_proves: string;
    signature_does_not_prove: string;
    factual_claims_verified: false;
    evidence_connectors_used: false;
  }>;
}

export function hostedCapsuleRequest(result: HostedScanResult) {
  return {
    scan_id: result.scanId,
    disposition: result.disposition,
    findings: result.findings.map((finding) => ({
      rule_id: finding.ruleId,
      reason_code: finding.reasonCode,
      severity: finding.severity,
    })),
    input_digest: result.inputDigest,
    rule_set_digest: result.ruleSetDigest,
    rule_set_version: result.ruleSetVersion,
    processed_at: result.processedAt,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function safeSignedDemoCapsule(value: unknown): SignedDemoCapsuleResponse | undefined {
  const root = record(value);
  const source = record(root?.source_scan);
  const capsule = record(root?.capsule);
  const policy = record(capsule?.policy);
  const signature = record(capsule?.signature);
  const verification = record(root?.verification);
  const truth = record(root?.truth_boundary);

  if (
    root?.artifact_type !== "signed_demo_context_capsule" ||
    source === undefined ||
    source.cryptographically_signed !== false ||
    typeof source.hosted_scan_id !== "string" ||
    capsule === undefined ||
    typeof capsule.capsule_id !== "string" ||
    typeof capsule.scan_id !== "string" ||
    typeof capsule.input_digest !== "string" ||
    typeof capsule.created_at !== "string" ||
    typeof capsule.as_of !== "string" ||
    !["allow", "review", "block"].includes(String(capsule.disposition)) ||
    !Array.isArray(capsule.findings) ||
    !Array.isArray(capsule.claims) ||
    !Array.isArray(capsule.evidence) ||
    !Array.isArray(capsule.conflicts) ||
    !Array.isArray(capsule.components) ||
    policy === undefined ||
    typeof policy.version !== "string" ||
    typeof policy.digest !== "string" ||
    signature === undefined ||
    signature.algorithm !== "Ed25519" ||
    typeof signature.key_id !== "string" ||
    typeof signature.signed_at !== "string" ||
    typeof signature.value !== "string" ||
    verification === undefined ||
    verification.valid !== true ||
    verification.algorithm !== "Ed25519" ||
    typeof verification.artifact_digest !== "string" ||
    verification.key_scope !== "ephemeral_per_request_demo" ||
    verification.production_key_attested !== false ||
    truth === undefined ||
    truth.factual_claims_verified !== false ||
    truth.evidence_connectors_used !== false
  ) {
    return undefined;
  }

  for (const candidate of capsule.findings) {
    const finding = record(candidate);
    if (
      finding === undefined ||
      typeof finding.category !== "string" ||
      typeof finding.severity !== "string" ||
      typeof finding.detector_id !== "string" ||
      typeof finding.reason_code !== "string"
    ) {
      return undefined;
    }
  }

  return value as SignedDemoCapsuleResponse;
}
