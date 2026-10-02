import { parseContextCapsule, type ContextCapsule } from "@verus/contracts";
import { canonicalizeJson, sha256Digest } from "@verus/crypto";
import { VerusError } from "@verus/domain";
import type { Pool, PoolClient } from "pg";

import { CredentialPersistence } from "./credentials.js";
import { IdentityPersistence } from "./identity.js";
import { NOOP_PERSISTENCE_TELEMETRY, type PersistenceTelemetry } from "./telemetry.js";

declare const workspaceIdBrand: unique symbol;
export type WorkspaceId = string & { readonly [workspaceIdBrand]: true };

export type ScanState =
  "accepted" | "allowed" | "blocked" | "cancelled" | "failed" | "processing" | "queued" | "review";

export interface ScanRecord {
  readonly workspaceId: WorkspaceId;
  readonly scanId: string;
  readonly requestId: string;
  readonly inputDigest: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly state: ScanState;
  readonly stateVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FindingRecord {
  readonly category: string;
  readonly confidenceBps: number | undefined;
  readonly createdAt: Date;
  readonly detectorId: string;
  readonly findingId: string;
  readonly location: Readonly<Record<string, unknown>>;
  readonly reasonCode: string;
  readonly severity: string;
}

export interface EvidenceRecord {
  readonly evidenceId: string;
  readonly freshness: string;
  readonly identityState: string;
  readonly retrievedAt: Date;
  readonly snapshotDigest: string;
  readonly sourceId: string;
}

export interface IngestionEnvelopeRecord {
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly inputKind: "feed_event" | "text" | "upload" | "url";
  readonly provenance: Readonly<Record<string, unknown>>;
}

const WORKSPACE_ID_PATTERN = /^ws_[0-9A-HJKMNP-TV-Z]{26}$/;
const transitions = Object.freeze({
  accepted: ["queued", "cancelled"],
  queued: ["processing", "cancelled"],
  processing: ["review", "allowed", "blocked", "failed", "cancelled"],
  review: ["allowed", "blocked", "cancelled"],
  allowed: [],
  blocked: [],
  failed: [],
  cancelled: [],
} as const satisfies Readonly<Record<ScanState, readonly ScanState[]>>);

export function workspaceId(value: string): WorkspaceId {
  if (!WORKSPACE_ID_PATTERN.test(value)) throw new TypeError("Invalid workspace identifier.");
  return value as WorkspaceId;
}

export function canTransitionScan(from: ScanState, to: ScanState): boolean {
  const allowed: readonly ScanState[] = transitions[from];
  return allowed.includes(to);
}

interface ScanRow {
  created_at: Date;
  input_digest: string;
  idempotency_key: string;
  request_digest: string;
  request_id: string;
  scan_id: string;
  state: ScanState;
  state_version: string;
  updated_at: Date;
  workspace_id: WorkspaceId;
}

interface FindingRow {
  category: string;
  confidence_bps: number | null;
  created_at: Date;
  detector_id: string;
  finding_id: string;
  location: Record<string, unknown>;
  reason_code: string;
  severity: string;
}

interface EvidenceRow {
  evidence_id: string;
  freshness: string;
  identity_state: string;
  retrieved_at: Date;
  snapshot_digest: string;
  source_id: string;
}

function toScan(row: ScanRow): Readonly<ScanRecord> {
  return Object.freeze({
    workspaceId: row.workspace_id,
    scanId: row.scan_id,
    requestId: row.request_id,
    inputDigest: row.input_digest,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_digest,
    state: row.state,
    stateVersion: Number(row.state_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toFinding(row: FindingRow): Readonly<FindingRecord> {
  return Object.freeze({
    category: row.category,
    confidenceBps: row.confidence_bps ?? undefined,
    createdAt: row.created_at,
    detectorId: row.detector_id,
    findingId: row.finding_id,
    location: Object.freeze({ ...row.location }),
    reasonCode: row.reason_code,
    severity: row.severity,
  });
}

function toEvidence(row: EvidenceRow): Readonly<EvidenceRecord> {
  return Object.freeze({
    evidenceId: row.evidence_id,
    freshness: row.freshness,
    identityState: row.identity_state,
    retrievedAt: row.retrieved_at,
    snapshotDigest: row.snapshot_digest,
    sourceId: row.source_id,
  });
}

export class WorkspacePersistence {
  readonly #client: PoolClient;
  readonly #workspaceId: WorkspaceId;

  constructor(client: PoolClient, scopedWorkspaceId: WorkspaceId) {
    this.#client = client;
    this.#workspaceId = scopedWorkspaceId;
  }

  identity(): IdentityPersistence {
    return new IdentityPersistence(this.#client, this.#workspaceId);
  }

  credentials(): CredentialPersistence {
    return new CredentialPersistence(this.#client, this.#workspaceId);
  }

  async provisionWorkspace(input: {
    readonly slug: string;
    readonly displayName: string;
  }): Promise<void> {
    await this.#client.query(
      "INSERT INTO workspaces (workspace_id, slug, display_name) VALUES ($1, $2, $3)",
      [this.#workspaceId, input.slug, input.displayName],
    );
  }

  async getWorkspace(): Promise<Readonly<{ displayName: string; slug: string; status: string }>> {
    const result = await this.#client.query<{
      display_name: string;
      slug: string;
      status: string;
    }>(
      `SELECT display_name, slug, status
       FROM workspaces WHERE workspace_id = $1`,
      [this.#workspaceId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new VerusError("NOT_FOUND", "Workspace does not exist.");
    return Object.freeze({ displayName: row.display_name, slug: row.slug, status: row.status });
  }

  /** Suspensions and resumption are owner/admin actions and are recorded in the immutable audit log. */
  async setWorkspaceStatus(input: {
    readonly actorSessionId: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
    readonly status: "active" | "suspended";
  }): Promise<void> {
    const actorId = await this.identity().requireHumanAction(
      input.actorSessionId,
      "workspace.update",
    );
    const result = await this.#client.query<{ status: "active" | "suspended" | "deleting" }>(
      `UPDATE workspaces SET status = $2, updated_at = $3
       WHERE workspace_id = $1 AND status <> 'deleting'
       RETURNING status`,
      [this.#workspaceId, input.status, input.occurredAt],
    );
    if (result.rows[0] === undefined)
      throw new VerusError("NOT_FOUND", "Workspace is unavailable.");
    await this.#client.query(
      `INSERT INTO audit_events
         (workspace_id, event_id, actor_type, actor_id, action, target_type, target_id, new_state, occurred_at)
       VALUES ($1, $2, 'user', $3, 'workspace.status_changed', 'workspace', $1, $4, $5)`,
      [this.#workspaceId, input.auditEventId, actorId, { status: input.status }, input.occurredAt],
    );
  }

  async createScan(input: {
    readonly scanId: string;
    readonly requestId: string;
    readonly inputDigest: string;
    readonly idempotencyKey: string;
    readonly requestDigest: string;
  }): Promise<Readonly<ScanRecord>> {
    const result = await this.#client.query<ScanRow>(
      `INSERT INTO scans (workspace_id, scan_id, request_id, input_digest, idempotency_key, request_digest)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING workspace_id, scan_id, request_id, input_digest, idempotency_key, request_digest, state, state_version,
                 created_at, updated_at`,
      [
        this.#workspaceId,
        input.scanId,
        input.requestId,
        input.inputDigest,
        input.idempotencyKey,
        input.requestDigest,
      ],
    );
    return toScan(result.rows[0] as ScanRow);
  }

  async getScan(scanId: string): Promise<Readonly<ScanRecord>> {
    const result = await this.#client.query<ScanRow>(
      `SELECT workspace_id, scan_id, request_id, input_digest, idempotency_key, request_digest, state, state_version,
              created_at, updated_at
       FROM scans WHERE workspace_id = $1 AND scan_id = $2`,
      [this.#workspaceId, scanId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new VerusError("NOT_FOUND", "Scan does not exist.");
    return toScan(row);
  }

  async findScan(scanId: string): Promise<Readonly<ScanRecord> | undefined> {
    const result = await this.#client.query<ScanRow>(
      `SELECT workspace_id, scan_id, request_id, input_digest, idempotency_key, request_digest, state, state_version,
              created_at, updated_at
       FROM scans WHERE workspace_id = $1 AND scan_id = $2`,
      [this.#workspaceId, scanId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toScan(row);
  }

  /** Lists scans using an opaque scan-id cursor, always scoped by the transaction tenant. */
  async listScans(input: {
    readonly after?: string;
    readonly limit: number;
  }): Promise<Readonly<{ items: readonly Readonly<ScanRecord>[]; next?: string }>> {
    const result = await this.#client.query<ScanRow>(
      `SELECT workspace_id, scan_id, request_id, input_digest, idempotency_key, request_digest, state, state_version,
              created_at, updated_at
       FROM scans
       WHERE workspace_id = $1 AND ($2::text IS NULL OR scan_id > $2)
       ORDER BY scan_id ASC
       LIMIT $3`,
      [this.#workspaceId, input.after ?? null, input.limit + 1],
    );
    const hasMore = result.rows.length > input.limit;
    const rows = result.rows.slice(0, input.limit).map(toScan);
    const last = rows.at(-1);
    return Object.freeze({
      items: Object.freeze(rows),
      ...(hasMore && last !== undefined ? { next: last.scanId } : {}),
    });
  }

  async listFindings(scanId: string): Promise<readonly Readonly<FindingRecord>[]> {
    const result = await this.#client.query<FindingRow>(
      `SELECT finding_id, category, severity, detector_id, reason_code, confidence_bps, location, created_at
       FROM findings WHERE workspace_id = $1 AND scan_id = $2
       ORDER BY created_at ASC, finding_id ASC`,
      [this.#workspaceId, scanId],
    );
    return Object.freeze(result.rows.map(toFinding));
  }

  async listEvidence(scanId: string): Promise<readonly Readonly<EvidenceRecord>[]> {
    const result = await this.#client.query<EvidenceRow>(
      `SELECT evidence_id, source_id, snapshot_digest, identity_state, freshness, retrieved_at
       FROM evidence_records WHERE workspace_id = $1 AND scan_id = $2
       ORDER BY retrieved_at ASC, evidence_id ASC`,
      [this.#workspaceId, scanId],
    );
    return Object.freeze(result.rows.map(toEvidence));
  }

  async getScanByIdempotencyKey(idempotencyKey: string): Promise<Readonly<ScanRecord> | undefined> {
    const result = await this.#client.query<ScanRow>(
      `SELECT workspace_id, scan_id, request_id, input_digest, idempotency_key, request_digest,
              state, state_version, created_at, updated_at
       FROM scans WHERE workspace_id = $1 AND idempotency_key = $2`,
      [this.#workspaceId, idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toScan(row);
  }

  /** Returns the immutable acceptance envelope only to a tenant-scoped processing transaction. */
  async getIngestionEnvelope(
    scanId: string,
  ): Promise<Readonly<IngestionEnvelopeRecord> | undefined> {
    const result = await this.#client.query<{
      envelope: Record<string, unknown>;
      input_kind: IngestionEnvelopeRecord["inputKind"];
      provenance: Record<string, unknown>;
    }>(
      `SELECT envelope, input_kind, provenance
       FROM ingestion_envelopes WHERE workspace_id = $1 AND scan_id = $2`,
      [this.#workspaceId, scanId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : Object.freeze({
          envelope: Object.freeze({ ...row.envelope }),
          inputKind: row.input_kind,
          provenance: Object.freeze({ ...row.provenance }),
        });
  }

  /** Stores one signed, contract-valid capsule for a scan; an exact replay is idempotent. */
  async storeContextCapsule(capsule: ContextCapsule): Promise<void> {
    const validated = parseContextCapsule(capsule);
    if (validated.workspace_id !== this.#workspaceId)
      throw new VerusError(
        "AUTHORIZATION_DENIED",
        "Capsule tenant does not match the transaction.",
      );
    const digest = sha256Digest(canonicalizeJson(validated));
    const inserted = await this.#client.query<{ capsule_digest: string }>(
      `INSERT INTO context_capsules
         (workspace_id, capsule_id, scan_id, capsule_digest, signing_key_id, capsule)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, scan_id) DO NOTHING
       RETURNING capsule_digest`,
      [
        this.#workspaceId,
        validated.capsule_id,
        validated.scan_id,
        digest,
        validated.signature.key_id,
        validated,
      ],
    );
    if (inserted.rows[0] !== undefined) return;
    const existing = await this.#client.query<{ capsule_digest: string }>(
      "SELECT capsule_digest FROM context_capsules WHERE workspace_id = $1 AND scan_id = $2",
      [this.#workspaceId, validated.scan_id],
    );
    if (existing.rows[0]?.capsule_digest !== digest)
      throw new VerusError("CONFLICT", "Scan already has a different Context Capsule.");
  }

  async getContextCapsule(scanId: string): Promise<Readonly<ContextCapsule> | undefined> {
    const result = await this.#client.query<{
      capsule: ContextCapsule;
      capsule_digest: string;
    }>(
      `SELECT capsule, capsule_digest FROM context_capsules
       WHERE workspace_id = $1 AND scan_id = $2`,
      [this.#workspaceId, scanId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const capsule = parseContextCapsule(row.capsule);
    if (sha256Digest(canonicalizeJson(capsule)) !== row.capsule_digest)
      throw new VerusError("SERVICE_UNAVAILABLE", "Stored Context Capsule integrity check failed.");
    return capsule;
  }

  async createIngestionEnvelope(input: {
    readonly envelopeId: string;
    readonly scanId: string;
    readonly requestId: string;
    readonly requestDigest: string;
    readonly inputDigest: string;
    readonly inputKind: "feed_event" | "text" | "upload" | "url";
    readonly mediaType?: string;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly envelope: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO ingestion_envelopes
         (workspace_id, envelope_id, scan_id, request_id, request_digest, input_digest,
          input_kind, media_type, provenance, envelope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        this.#workspaceId,
        input.envelopeId,
        input.scanId,
        input.requestId,
        input.requestDigest,
        input.inputDigest,
        input.inputKind,
        input.mediaType ?? null,
        input.provenance,
        input.envelope,
      ],
    );
  }

  async createQuarantineUpload(input: {
    readonly uploadId: string;
    readonly objectRef: string;
    readonly digest: string;
    readonly declaredMediaType: string;
    readonly detectedMediaType?: string;
    readonly sizeBytes: number;
    readonly state: "clean" | "malicious" | "rejected" | "scan_unavailable";
    readonly failureCode?: string;
    readonly retentionUntil: Date;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO quarantine_uploads
         (workspace_id, upload_id, object_ref, digest, declared_media_type, detected_media_type,
          size_bytes, state, failure_code, retention_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        this.#workspaceId,
        input.uploadId,
        input.objectRef,
        input.digest,
        input.declaredMediaType,
        input.detectedMediaType ?? null,
        input.sizeBytes,
        input.state,
        input.state === "clean" ? null : (input.failureCode ?? input.state.toUpperCase()),
        input.retentionUntil,
      ],
    );
  }

  async createContentSnapshot(input: {
    readonly snapshotId: string;
    readonly scanId: string;
    readonly contentDigest: string;
    readonly metadataDigest: string;
    readonly objectRef: string;
    readonly retrievalMetadata: Readonly<Record<string, unknown>>;
    readonly parentDigests: readonly string[];
    readonly componentVersions: Readonly<Record<string, string>>;
    readonly retentionUntil: Date;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO content_snapshots
        (workspace_id, snapshot_id, scan_id, content_digest, metadata_digest, object_ref,
         retrieval_metadata, parent_digests, component_versions, retention_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        this.#workspaceId,
        input.snapshotId,
        input.scanId,
        input.contentDigest,
        input.metadataDigest,
        input.objectRef,
        input.retrievalMetadata,
        input.parentDigests,
        input.componentVersions,
        input.retentionUntil,
      ],
    );
  }

  async markContentSnapshotDeleted(snapshotId: string, deletedAt: Date): Promise<void> {
    const result = await this.#client.query(
      `UPDATE content_snapshots SET content_deleted_at = $3
       WHERE workspace_id = $1 AND snapshot_id = $2 AND content_deleted_at IS NULL`,
      [this.#workspaceId, snapshotId, deletedAt],
    );
    if (result.rowCount !== 1)
      throw new VerusError("NOT_FOUND", "Snapshot does not exist or was deleted.");
  }

  async transitionScan(input: {
    readonly scanId: string;
    readonly expectedVersion: number;
    readonly from: ScanState;
    readonly to: ScanState;
    readonly failureCode?: string;
  }): Promise<Readonly<ScanRecord>> {
    if (!canTransitionScan(input.from, input.to)) {
      throw new VerusError("CONFLICT", `Invalid scan transition ${input.from} -> ${input.to}.`);
    }
    const terminal = ["allowed", "blocked", "failed", "cancelled"].includes(input.to);
    const result = await this.#client.query<ScanRow>(
      `UPDATE scans
       SET state = $4,
           state_version = state_version + 1,
           failure_code = $5,
           updated_at = clock_timestamp(),
           completed_at = CASE WHEN $6 THEN clock_timestamp() ELSE NULL END
       WHERE workspace_id = $1 AND scan_id = $2 AND state_version = $3 AND state = $7
       RETURNING workspace_id, scan_id, request_id, input_digest, idempotency_key, request_digest, state, state_version,
                 created_at, updated_at`,
      [
        this.#workspaceId,
        input.scanId,
        input.expectedVersion,
        input.to,
        input.failureCode ?? null,
        terminal,
        input.from,
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) return toScan(row);
    const current = await this.#client.query<{ state: ScanState; state_version: string }>(
      "SELECT state, state_version FROM scans WHERE workspace_id = $1 AND scan_id = $2",
      [this.#workspaceId, input.scanId],
    );
    if (current.rows[0] === undefined) throw new VerusError("NOT_FOUND", "Scan does not exist.");
    throw new VerusError("CONFLICT", "Scan state changed concurrently.");
  }

  async insertPolicy(input: {
    readonly policyId: string;
    readonly version: number;
    readonly lifecycle: "active" | "draft" | "retired";
    readonly digest: string;
    readonly document: Readonly<Record<string, unknown>>;
    readonly createdBy: string;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO policies
         (workspace_id, policy_id, version, lifecycle, digest, document, created_by, promoted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               CASE WHEN $4 = 'active' THEN clock_timestamp() ELSE NULL END)`,
      [
        this.#workspaceId,
        input.policyId,
        input.version,
        input.lifecycle,
        input.digest,
        input.document,
        input.createdBy,
      ],
    );
  }

  async insertFinding(input: {
    readonly findingId: string;
    readonly scanId: string;
    readonly category: string;
    readonly severity: string;
    readonly detectorId: string;
    readonly reasonCode: string;
    readonly confidenceBps?: number;
    readonly location: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO findings
         (workspace_id, finding_id, scan_id, category, severity, detector_id,
          reason_code, confidence_bps, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        this.#workspaceId,
        input.findingId,
        input.scanId,
        input.category,
        input.severity,
        input.detectorId,
        input.reasonCode,
        input.confidenceBps ?? null,
        input.location,
      ],
    );
  }

  async insertEvidence(input: {
    readonly evidenceId: string;
    readonly scanId: string;
    readonly sourceId: string;
    readonly snapshotDigest: string;
    readonly identityState: string;
    readonly freshness: string;
    readonly retrievedAt: Date;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO evidence_records
         (workspace_id, evidence_id, scan_id, source_id, snapshot_digest,
          identity_state, freshness, retrieved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        this.#workspaceId,
        input.evidenceId,
        input.scanId,
        input.sourceId,
        input.snapshotDigest,
        input.identityState,
        input.freshness,
        input.retrievedAt,
      ],
    );
  }

  async enqueueJob(input: {
    readonly jobId: string;
    readonly correlationId: string;
    readonly queue: string;
    readonly kind: string;
    readonly envelopeVersion: number;
    readonly payloadRef: string;
    readonly idempotencyKey: string;
    readonly effectKey: string;
    readonly maxAttempts: number;
    readonly timeoutMs: number;
    readonly deadlineAt: Date;
    readonly availableAt?: Date;
  }): Promise<boolean> {
    const result = await this.#client.query(
      `INSERT INTO jobs
         (workspace_id, job_id, correlation_id, queue_name, kind, envelope_version, payload_ref,
          idempotency_key, effect_key, max_attempts, timeout_ms, deadline_at, available_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (workspace_id, kind, idempotency_key) DO NOTHING`,
      [
        this.#workspaceId,
        input.jobId,
        input.correlationId,
        input.queue,
        input.kind,
        input.envelopeVersion,
        input.payloadRef,
        input.idempotencyKey,
        input.effectKey,
        input.maxAttempts,
        input.timeoutMs,
        input.deadlineAt,
        input.availableAt ?? new Date(),
      ],
    );
    return result.rowCount === 1;
  }

  async insertKeyMetadata(input: {
    readonly keyId: string;
    readonly purpose: "api" | "capsule_signing" | "webhook_signing";
    readonly providerRef: string;
    readonly algorithm: string;
    readonly status: "active" | "destroyed" | "pending" | "retiring" | "revoked";
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO key_metadata
         (workspace_id, key_id, purpose, provider_ref, algorithm, status, activated_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $6 = 'active' THEN clock_timestamp() ELSE NULL END)`,
      [
        this.#workspaceId,
        input.keyId,
        input.purpose,
        input.providerRef,
        input.algorithm,
        input.status,
      ],
    );
  }

  async appendAuditEvent(input: {
    readonly eventId: string;
    readonly actorType: "api_key" | "service" | "system" | "user";
    readonly actorId: string;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly occurredAt: Date;
    readonly correlationId?: string;
    readonly reasonCode?: string;
    readonly previousState?: Readonly<Record<string, unknown>>;
    readonly newState?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO audit_events
         (workspace_id, event_id, actor_type, actor_id, action, target_type, target_id,
          reason_code, previous_state, new_state, occurred_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        this.#workspaceId,
        input.eventId,
        input.actorType,
        input.actorId,
        input.action,
        input.targetType,
        input.targetId,
        input.reasonCode ?? null,
        input.previousState ?? null,
        input.newState ?? null,
        input.occurredAt,
        input.correlationId ?? null,
      ],
    );
  }

  async appendOutboxEvent(input: {
    readonly eventId: string;
    readonly topic: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO outbox_events
         (workspace_id, event_id, topic, aggregate_type, aggregate_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.#workspaceId,
        input.eventId,
        input.topic,
        input.aggregateType,
        input.aggregateId,
        input.payload,
      ],
    );
  }
}

function safeOperation(value: string | undefined): string {
  return value !== undefined && /^[a-z][a-z0-9_.-]{0,63}$/.test(value) ? value : "workspace";
}

function emitSafely(
  telemetry: PersistenceTelemetry,
  event: Parameters<PersistenceTelemetry["emit"]>[0],
): void {
  try {
    telemetry.emit(event);
  } catch {
    // Observability cannot alter transaction success or failure semantics.
  }
}

function databaseFailure(error: unknown): VerusError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  if (["23000", "23503", "23505"].includes(code ?? "")) {
    return new VerusError("CONFLICT", "Database invariant rejected the operation.", {
      cause: error,
    });
  }
  if (code === "42501") {
    return new VerusError("AUTHORIZATION_DENIED", "Database authorization denied the operation.", {
      cause: error,
    });
  }
  if (code === "23514") {
    return new VerusError("CONTRACT_VALIDATION_FAILED", "Database constraint rejected the input.", {
      cause: error,
    });
  }
  return new VerusError("SERVICE_UNAVAILABLE", "Workspace transaction failed.", { cause: error });
}

export async function withWorkspaceTransaction<T>(
  pool: Pool,
  scopedWorkspaceId: WorkspaceId,
  operation: (persistence: WorkspacePersistence) => Promise<T>,
  options: {
    readonly isolation?: "read committed" | "repeatable read" | "serializable";
    readonly operationName?: string;
    readonly telemetry?: PersistenceTelemetry;
  } = {},
): Promise<T> {
  const client = await pool.connect();
  const telemetry = options.telemetry ?? NOOP_PERSISTENCE_TELEMETRY;
  const operationName = safeOperation(options.operationName);
  const isolation = options.isolation ?? "read committed";
  const isolationSql = {
    "read committed": "READ COMMITTED",
    "repeatable read": "REPEATABLE READ",
    serializable: "SERIALIZABLE",
  }[isolation];
  const startedAt = performance.now();
  try {
    await client.query("BEGIN");
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationSql}`);
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [scopedWorkspaceId]);
    const result = await operation(new WorkspacePersistence(client, scopedWorkspaceId));
    await client.query("COMMIT");
    emitSafely(telemetry, {
      name: "persistence.transaction.completed",
      operation: operationName,
      outcome: "success",
      durationMs: performance.now() - startedAt,
    });
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    emitSafely(telemetry, {
      name: "persistence.transaction.failed",
      operation: operationName,
      outcome: "failure",
      durationMs: performance.now() - startedAt,
    });
    if (error instanceof VerusError) throw error;
    throw databaseFailure(error);
  } finally {
    client.release();
  }
}

export async function provisionWorkspace(
  pool: Pool,
  input: { readonly workspaceId: WorkspaceId; readonly slug: string; readonly displayName: string },
): Promise<void> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.slug)) {
    throw new TypeError("Invalid workspace slug.");
  }
  await withWorkspaceTransaction(
    pool,
    input.workspaceId,
    async (persistence) => {
      await persistence.provisionWorkspace(input);
    },
    { operationName: "workspace.provision" },
  );
}

export async function provisionWorkspaceWithOwner(
  pool: Pool,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly slug: string;
    readonly displayName: string;
    readonly identityId: string;
    readonly provider: string;
    readonly providerSubjectDigest: string;
    readonly membershipId: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  },
): Promise<void> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.slug)) {
    throw new TypeError("Invalid workspace slug.");
  }
  await withWorkspaceTransaction(
    pool,
    input.workspaceId,
    async (persistence) => {
      await persistence.provisionWorkspace(input);
      const identity = persistence.identity();
      const resolvedIdentityId = await identity.resolveIdentity(input);
      await identity.createOwnerMembership({
        membershipId: input.membershipId,
        identityId: resolvedIdentityId,
        auditEventId: input.auditEventId,
        occurredAt: input.occurredAt,
      });
    },
    { isolation: "serializable", operationName: "workspace.provision_with_owner" },
  );
}
