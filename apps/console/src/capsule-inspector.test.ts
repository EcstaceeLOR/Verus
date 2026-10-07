import { describe, expect, it } from "vitest";

import {
  buildHostedDecisionArtifact,
  capsuleContractFixture,
} from "./capsule-inspector.js";
import type { HostedScanResult } from "./scan-workflow.js";

const hosted: HostedScanResult = {
  scanId: "scan_test",
  disposition: "block",
  findings: [],
  inputDigest: "sha256:" + "a".repeat(64),
  ruleSetDigest: "sha256:" + "b".repeat(64),
  ruleSetVersion: "hosted-test",
  processedAt: "2026-10-07T09:00:00.000Z",
};

describe("capsule inspector provenance labels", () => {
  it("never upgrades a hosted scan into a signed capsule", () => {
    const artifact = buildHostedDecisionArtifact(hosted);

    expect(artifact.signature).toBeNull();
    expect(artifact.provenance_state).toBe("unsigned_hosted_demo");
    expect(artifact.disposition).toBe("block");
  });

  it("labels the v1 capsule example as a contract fixture", () => {
    expect(capsuleContractFixture.artifact_type).toBe(
      "context_capsule_v1_contract_fixture",
    );
    expect(capsuleContractFixture.signature.algorithm).toBe("Ed25519");
    expect(capsuleContractFixture.signature.verification_state).toBe(
      "fixture_not_live_verified",
    );
  });
});
