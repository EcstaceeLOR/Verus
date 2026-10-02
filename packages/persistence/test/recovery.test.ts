import { describe, expect, it } from "vitest";
import { createBackupArtifact, verifyRestoreDrill } from "../src/index.js";
const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
describe("recovery artifacts", () => {
  it("accepts an encrypted, integrity-preserving drill inside RPO/RTO", () => {
    const artifact = createBackupArtifact({
      createdAt: "2026-01-01T00:00:00.000Z",
      databaseDigest: digest("a"),
      objectManifestDigest: digest("b"),
      encryption: "kms-envelope",
    });
    expect(
      verifyRestoreDrill(
        artifact,
        {
          restoredArtifactDigest: artifact.restorePoint,
          startedAt: "2026-01-01T00:10:00.000Z",
          completedAt: "2026-01-01T00:25:00.000Z",
          auditChainVerified: true,
          signatureVerificationPassed: true,
        },
        { rpoMinutes: 30, rtoMinutes: 20 },
      ),
    ).toEqual({ passed: true });
  });
  it("fails closed when a restore loses audit or signature verification", () => {
    const artifact = createBackupArtifact({
      createdAt: "2026-01-01T00:00:00.000Z",
      databaseDigest: digest("a"),
      objectManifestDigest: digest("b"),
      encryption: "provider-managed",
    });
    expect(
      verifyRestoreDrill(
        artifact,
        {
          restoredArtifactDigest: artifact.restorePoint,
          startedAt: "2026-01-01T00:10:00.000Z",
          completedAt: "2026-01-01T00:15:00.000Z",
          auditChainVerified: false,
          signatureVerificationPassed: true,
        },
        { rpoMinutes: 30, rtoMinutes: 20 },
      ),
    ).toEqual({ passed: false, reason: "integrity_unverified" });
  });
});
