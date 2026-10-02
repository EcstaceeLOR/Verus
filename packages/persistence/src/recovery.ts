import { createHash } from "node:crypto";

export interface BackupArtifact {
  readonly createdAt: string;
  readonly databaseDigest: string;
  readonly encryption: "kms-envelope" | "provider-managed";
  readonly objectManifestDigest: string;
  readonly restorePoint: string;
}

export interface RestoreDrill {
  readonly auditChainVerified: boolean;
  readonly completedAt: string;
  readonly restoredArtifactDigest: string;
  readonly signatureVerificationPassed: boolean;
  readonly startedAt: string;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function iso(value: string, field: string): void {
  if (Number.isNaN(new Date(value).getTime())) throw new TypeError(`Invalid ${field}.`);
}

/** Creates a canonical, encrypted-backup manifest that can be checked before restore. */
export function createBackupArtifact(
  input: Omit<BackupArtifact, "restorePoint">,
): Readonly<BackupArtifact> {
  iso(input.createdAt, "backup timestamp");
  if (!DIGEST.test(input.databaseDigest) || !DIGEST.test(input.objectManifestDigest))
    throw new TypeError("Backup digests are invalid.");
  const restorePoint = `sha256:${createHash("sha256")
    .update(JSON.stringify({ ...input, createdAt: new Date(input.createdAt).toISOString() }))
    .digest("hex")}`;
  return Object.freeze({
    ...input,
    createdAt: new Date(input.createdAt).toISOString(),
    restorePoint,
  });
}

/** Fails a restore drill unless artifact integrity, audit continuity, and signature verification all pass. */
export function verifyRestoreDrill(
  artifact: BackupArtifact,
  drill: RestoreDrill,
  objectives: Readonly<{ rpoMinutes: number; rtoMinutes: number }>,
): Readonly<{ passed: boolean; reason?: string }> {
  if (!DIGEST.test(artifact.restorePoint) || artifact.encryption === undefined)
    return Object.freeze({ passed: false, reason: "artifact_invalid" });
  if (drill.restoredArtifactDigest !== artifact.restorePoint)
    return Object.freeze({ passed: false, reason: "artifact_mismatch" });
  if (!drill.auditChainVerified || !drill.signatureVerificationPassed)
    return Object.freeze({ passed: false, reason: "integrity_unverified" });
  const duration = new Date(drill.completedAt).getTime() - new Date(drill.startedAt).getTime();
  const age = new Date(drill.startedAt).getTime() - new Date(artifact.createdAt).getTime();
  if (
    !Number.isSafeInteger(objectives.rpoMinutes) ||
    !Number.isSafeInteger(objectives.rtoMinutes) ||
    objectives.rpoMinutes < 1 ||
    objectives.rtoMinutes < 1
  )
    throw new TypeError("Recovery objectives must be positive minutes.");
  if (duration < 0 || duration > objectives.rtoMinutes * 60_000)
    return Object.freeze({ passed: false, reason: "rto_exceeded" });
  if (age < 0 || age > objectives.rpoMinutes * 60_000)
    return Object.freeze({ passed: false, reason: "rpo_exceeded" });
  return Object.freeze({ passed: true });
}
