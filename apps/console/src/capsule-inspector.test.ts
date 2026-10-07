import { describe, expect, it } from "vitest";

import { hostedCapsuleRequest, safeSignedDemoCapsule } from "./capsule-inspector.js";
import type { HostedScanResult } from "./scan-workflow.js";

const hosted: HostedScanResult = {
  scanId: "scan_hosted_demo",
  disposition: "review",
  findings: [],
  inputDigest: "sha256:" + "a".repeat(64),
  ruleSetDigest: "sha256:" + "b".repeat(64),
  ruleSetVersion: "hosted-test",
  processedAt: "2026-10-07T09:00:00.000Z",
};

describe("capsule inspector trust labels", () => {
  it("sends metadata only and never claims the hosted scan is signed", () => {
    const request = hostedCapsuleRequest(hosted);

    expect(request.scan_id).toBe("scan_hosted_demo");
    expect(request.input_digest).toBe(hosted.inputDigest);
    expect(JSON.stringify(request)).not.toContain("signature");
  });

  it("accepts only a verified derived capsule with an explicitly unsigned source scan", () => {
    const parsed = safeSignedDemoCapsule({
      artifact_type: "signed_demo_context_capsule",
      source_scan: {
        hosted_scan_id: "scan_hosted_demo",
        cryptographically_signed: false,
        relationship: "derived_from_digest_disposition_and_findings",
      },
      capsule: {
        schema_version: "1.0",
        capsule_id: "cap_demo",
        scan_id: "scan_demo",
        input_digest: hosted.inputDigest,
        created_at: hosted.processedAt,
        as_of: hosted.processedAt,
        claims: [],
        evidence: [],
        findings: [],
        conflicts: [],
        disposition: "review",
        policy: {
          policy_id: "policy_demo",
          version: "1.0.0",
          digest: hosted.ruleSetDigest,
        },
        components: [],
        signature: {
          algorithm: "Ed25519",
          key_id: "key_demo",
          signed_at: hosted.processedAt,
          value: "signature",
        },
      },
      verification: {
        valid: true,
        artifact_digest: hosted.inputDigest,
        algorithm: "Ed25519",
        key_id: "key_demo",
        public_key: "public",
        key_scope: "ephemeral_per_request_demo",
        production_key_attested: false,
      },
      truth_boundary: {
        signature_proves: "integrity",
        signature_does_not_prove: "truth",
        factual_claims_verified: false,
        evidence_connectors_used: false,
      },
    });

    expect(parsed?.source_scan.cryptographically_signed).toBe(false);
    expect(parsed?.verification.valid).toBe(true);
    expect(parsed?.verification.production_key_attested).toBe(false);
  });
});
