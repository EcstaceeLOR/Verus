import type { HostedScanResult } from "./scan-workflow.js";

export interface HostedDecisionArtifact {
  readonly artifact_type: "hosted_scan_decision";
  readonly schema_version: "1.0";
  readonly scan_id: string;
  readonly disposition: HostedScanResult["disposition"];
  readonly findings: HostedScanResult["findings"];
  readonly input_digest: string;
  readonly rule_set: Readonly<{
    version: string;
    digest: string;
  }>;
  readonly processed_at: string;
  readonly signature: null;
  readonly provenance_state: "unsigned_hosted_demo";
}

export function buildHostedDecisionArtifact(
  result: HostedScanResult,
): HostedDecisionArtifact {
  return Object.freeze({
    artifact_type: "hosted_scan_decision",
    schema_version: "1.0",
    scan_id: result.scanId,
    disposition: result.disposition,
    findings: result.findings,
    input_digest: result.inputDigest,
    rule_set: Object.freeze({
      version: result.ruleSetVersion,
      digest: result.ruleSetDigest,
    }),
    processed_at: result.processedAt,
    signature: null,
    provenance_state: "unsigned_hosted_demo",
  });
}

export const capsuleContractFixture = Object.freeze({
  artifact_type: "context_capsule_v1_contract_fixture",
  schema_version: "1.0",
  capsule_id: "cap_01ARZ3NDEKTSV4RRFFQ69G5FB2",
  scan_id: "scan_01ARZ3NDEKTSV4RRFFQ69G5FAZ",
  subject: Object.freeze({
    kind: "equity",
    symbols: Object.freeze(["EXMPL"]),
  }),
  claims: Object.freeze([
    Object.freeze({
      statement: "Example Holdings reported quarterly revenue of USD 125000000.",
      verification: "verified",
      confidence_bps: 9750,
      citations: 1,
    }),
  ]),
  evidence: Object.freeze([
    Object.freeze({
      identity_state: "verified",
      source_class: "primary",
      source_tier: "verified_primary",
      quality_grade: "supported",
      freshness: "current",
    }),
  ]),
  findings: Object.freeze([
    Object.freeze({
      category: "source_mismatch",
      severity: "medium",
      reason_code: "SOURCE_IDENTITY_UNKNOWN",
    }),
  ]),
  conflicts: Object.freeze([]),
  disposition: "review",
  policy: Object.freeze({
    version: "1.2.0",
    digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  }),
  signature: Object.freeze({
    algorithm: "Ed25519",
    key_id: "key_01ARZ3NDEKTSV4RRFFQ69G5FB5",
    signed_at: "2026-10-01T09:30:04.000Z",
    verification_state: "fixture_not_live_verified",
  }),
});
