export {
  MigrationError,
  loadMigrations,
  migrate,
  type Migration,
  type MigrationResult,
} from "./migrations.js";
export { IdentityPersistence } from "./identity.js";
export { exportAudit, type SafeAuditEvent } from "./audit-export.js";
export {
  createBackupArtifact,
  verifyRestoreDrill,
  type BackupArtifact,
  type RestoreDrill,
} from "./recovery.js";
export {
  createLegalHold,
  mayForwardToModel,
  planDeletion,
  scheduleRetention,
  type DataAsset,
  type LegalHold,
} from "./lifecycle.js";
export {
  CredentialPersistence,
  type ActiveSigningKey,
  type DiscoverableSigningKey,
  type StoredApiKey,
} from "./credentials.js";
export {
  NOOP_PERSISTENCE_TELEMETRY,
  type PersistenceEvent,
  type PersistenceEventName,
  type PersistenceTelemetry,
} from "./telemetry.js";
export {
  WorkspacePersistence,
  canTransitionScan,
  provisionWorkspace,
  provisionWorkspaceWithOwner,
  withWorkspaceTransaction,
  workspaceId,
  type ScanRecord,
  type FindingRecord,
  type EvidenceRecord,
  type IngestionEnvelopeRecord,
  type ActivePolicyRecord,
  type ScanState,
  type WorkspaceId,
} from "./workspace.js";
