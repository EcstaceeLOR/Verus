import {
  assertAuthorized,
  permissionsForRole,
  VerusError,
  type AuthorizationAction,
  type ServiceRole,
} from "@verus/domain";
import type { PoolClient } from "pg";

import { IdentityPersistence } from "./identity.js";
import type { WorkspaceId } from "./workspace.js";

export interface StoredApiKey {
  readonly keyId: string;
  readonly serviceAccountId: string;
  readonly verifier: string;
  readonly verifierVersion: number;
  readonly scopes: readonly AuthorizationAction[];
  readonly status: "active" | "retiring";
  readonly workspaceStatus: "active" | "suspended" | "deleting";
}

export interface DiscoverableSigningKey {
  readonly keyId: string;
  readonly algorithm: "Ed25519";
  readonly publicKey: string;
  readonly status: string;
  readonly notBefore: Date;
  readonly verifyUntil: Date;
  readonly revokedAt?: Date;
}

export interface ActiveSigningKey {
  readonly keyId: string;
  readonly algorithm: "Ed25519";
  readonly providerReference: string;
  readonly publicKey: string;
  readonly signUntil: Date;
}

export class CredentialPersistence {
  readonly #client: PoolClient;
  readonly #workspaceId: WorkspaceId;
  readonly #identity: IdentityPersistence;

  constructor(client: PoolClient, workspaceId: WorkspaceId) {
    this.#client = client;
    this.#workspaceId = workspaceId;
    this.#identity = new IdentityPersistence(client, workspaceId);
  }

  async registerApiKey(input: {
    readonly actorSessionId: string;
    readonly keyId: string;
    readonly serviceAccountId: string;
    readonly prefix: string;
    readonly verifier: string;
    readonly verifierVersion: number;
    readonly scopes: readonly AuthorizationAction[];
    readonly expiresAt?: Date;
    readonly rotatedFromKeyId?: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actorId = await this.#requireHuman(input.actorSessionId, "service_account.manage");
    const account = await this.#client.query<{ role: ServiceRole }>(
      `SELECT role FROM service_accounts
       WHERE workspace_id = $1 AND service_account_id = $2 AND status = 'active' FOR UPDATE`,
      [this.#workspaceId, input.serviceAccountId],
    );
    const role = account.rows[0]?.role;
    if (role === undefined) throw new VerusError("NOT_FOUND", "Service account is unavailable.");
    const allowed = new Set(permissionsForRole(role, "service"));
    if (input.scopes.length === 0 || input.scopes.some((scope) => !allowed.has(scope))) {
      throw new VerusError("AUTHORIZATION_DENIED", "API key scopes exceed the service role.");
    }
    if (input.rotatedFromKeyId !== undefined) {
      const retired = await this.#client.query(
        `UPDATE api_keys SET status = 'retiring'
         WHERE workspace_id = $1 AND key_id = $2 AND service_account_id = $3
           AND status = 'active'`,
        [this.#workspaceId, input.rotatedFromKeyId, input.serviceAccountId],
      );
      if (retired.rowCount !== 1) throw new VerusError("CONFLICT", "Active API key changed.");
    }
    await this.#client.query(
      `INSERT INTO api_keys
         (workspace_id, key_id, service_account_id, prefix, verifier, verifier_version,
          scopes, created_by_membership_id, expires_at, rotated_from_key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        this.#workspaceId,
        input.keyId,
        input.serviceAccountId,
        input.prefix,
        input.verifier,
        input.verifierVersion,
        input.scopes,
        actorId,
        input.expiresAt ?? null,
        input.rotatedFromKeyId ?? null,
      ],
    );
    await this.#audit(
      actorId,
      input.auditEventId,
      "api_key.issued",
      "api_key",
      input.keyId,
      {
        scopes: input.scopes,
        service_account_id: input.serviceAccountId,
      },
      input.occurredAt,
    );
  }

  async findUsableApiKey(keyId: string): Promise<Readonly<StoredApiKey> | undefined> {
    const result = await this.#client.query<{
      key_id: string;
      scopes: AuthorizationAction[];
      service_account_id: string;
      status: "active" | "retiring";
      workspace_status: "active" | "suspended" | "deleting";
      verifier: string;
      verifier_version: number;
    }>(
      `SELECT k.key_id, k.service_account_id, k.verifier, k.verifier_version, k.scopes, k.status,
              w.status AS workspace_status
       FROM api_keys k
       JOIN service_accounts a
         ON a.workspace_id = k.workspace_id AND a.service_account_id = k.service_account_id
       JOIN workspaces w ON w.workspace_id = k.workspace_id
       WHERE k.workspace_id = $1 AND k.key_id = $2 AND k.status IN ('active', 'retiring')
         AND a.status = 'active'
         AND (k.expires_at IS NULL OR k.expires_at > clock_timestamp())`,
      [this.#workspaceId, keyId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      keyId: row.key_id,
      serviceAccountId: row.service_account_id,
      verifier: row.verifier,
      verifierVersion: row.verifier_version,
      scopes: Object.freeze([...row.scopes]),
      status: row.status,
      workspaceStatus: row.workspace_status,
    });
  }

  async recordApiKeyUse(keyId: string): Promise<void> {
    await this.#client.query(
      `UPDATE api_keys SET last_used_at = clock_timestamp()
       WHERE workspace_id = $1 AND key_id = $2
         AND (last_used_at IS NULL OR last_used_at < clock_timestamp() - interval '5 minutes')`,
      [this.#workspaceId, keyId],
    );
  }

  async revokeApiKey(input: {
    readonly actorSessionId: string;
    readonly keyId: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actorId = await this.#requireHuman(input.actorSessionId, "service_account.manage");
    const result = await this.#client.query(
      `UPDATE api_keys SET status = 'revoked', revoked_at = clock_timestamp()
       WHERE workspace_id = $1 AND key_id = $2 AND status <> 'revoked'`,
      [this.#workspaceId, input.keyId],
    );
    if (result.rowCount !== 1) throw new VerusError("NOT_FOUND", "API key is unavailable.");
    await this.#audit(
      actorId,
      input.auditEventId,
      "api_key.revoked",
      "api_key",
      input.keyId,
      { status: "revoked" },
      input.occurredAt,
    );
  }

  async registerSecretMetadata(input: {
    readonly actorSessionId: string;
    readonly secretId: string;
    readonly purpose: string;
    readonly providerReference: string;
    readonly version: number;
    readonly previousSecretId?: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actorId = await this.#requireHuman(input.actorSessionId, "key.manage");
    if (input.previousSecretId !== undefined) {
      const retired = await this.#client.query(
        `UPDATE secret_metadata SET status = 'retiring'
         WHERE workspace_id = $1 AND secret_id = $2 AND purpose = $3 AND status = 'active'`,
        [this.#workspaceId, input.previousSecretId, input.purpose],
      );
      if (retired.rowCount !== 1) throw new VerusError("CONFLICT", "Active secret changed.");
    }
    await this.#client.query(
      `INSERT INTO secret_metadata
         (workspace_id, secret_id, purpose, provider_ref, version, created_by_membership_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.#workspaceId,
        input.secretId,
        input.purpose,
        input.providerReference,
        input.version,
        actorId,
      ],
    );
    if (input.previousSecretId !== undefined) {
      await this.#client.query(
        `UPDATE secret_metadata SET replaced_by_secret_id = $3
         WHERE workspace_id = $1 AND secret_id = $2`,
        [this.#workspaceId, input.previousSecretId, input.secretId],
      );
    }
    await this.#audit(
      actorId,
      input.auditEventId,
      "secret.rotated",
      "secret",
      input.secretId,
      {
        provider_ref: input.providerReference,
        purpose: input.purpose,
        version: input.version,
      },
      input.occurredAt,
    );
  }

  async revokeSecretMetadata(input: {
    readonly actorSessionId: string;
    readonly secretId: string;
    readonly destroyed: boolean;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actorId = await this.#requireHuman(input.actorSessionId, "key.manage");
    const result = await this.#client.query(
      `UPDATE secret_metadata
       SET status = CASE WHEN $3 THEN 'destroyed' ELSE 'revoked' END,
           revoked_at = CASE WHEN $3 THEN NULL ELSE clock_timestamp() END,
           destroyed_at = CASE WHEN $3 THEN clock_timestamp() ELSE NULL END
       WHERE workspace_id = $1 AND secret_id = $2 AND status <> 'destroyed'`,
      [this.#workspaceId, input.secretId, input.destroyed],
    );
    if (result.rowCount !== 1) throw new VerusError("NOT_FOUND", "Secret metadata is unavailable.");
    await this.#audit(
      actorId,
      input.auditEventId,
      "secret.revoked",
      "secret",
      input.secretId,
      {
        status: input.destroyed ? "destroyed" : "revoked",
      },
      input.occurredAt,
    );
  }

  async rotateSigningKey(input: {
    readonly actorSessionId: string;
    readonly keyId: string;
    readonly providerReference: string;
    readonly publicKey: string;
    readonly notBefore: Date;
    readonly signUntil: Date;
    readonly verifyUntil: Date;
    readonly previousKeyId?: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actorId = await this.#requireHuman(input.actorSessionId, "key.manage");
    if (input.previousKeyId !== undefined) {
      const retired = await this.#client.query(
        `UPDATE key_metadata SET status = 'retiring', sign_until = LEAST(sign_until, $3)
         WHERE workspace_id = $1 AND key_id = $2 AND purpose = 'capsule_signing'
           AND status = 'active'`,
        [this.#workspaceId, input.previousKeyId, input.notBefore],
      );
      if (retired.rowCount !== 1) throw new VerusError("CONFLICT", "Active signing key changed.");
    }
    await this.#client.query(
      `INSERT INTO key_metadata
         (workspace_id, key_id, purpose, provider_ref, algorithm, status,
          activated_at, public_key, not_before, sign_until, verify_until)
       VALUES ($1, $2, 'capsule_signing', $3, 'Ed25519', 'active',
               clock_timestamp(), $4, $5, $6, $7)`,
      [
        this.#workspaceId,
        input.keyId,
        input.providerReference,
        input.publicKey,
        input.notBefore,
        input.signUntil,
        input.verifyUntil,
      ],
    );
    if (input.previousKeyId !== undefined) {
      await this.#client.query(
        `UPDATE key_metadata SET replaced_by_key_id = $3
         WHERE workspace_id = $1 AND key_id = $2`,
        [this.#workspaceId, input.previousKeyId, input.keyId],
      );
    }
    await this.#audit(
      actorId,
      input.auditEventId,
      "signing_key.rotated",
      "key",
      input.keyId,
      {
        previous_key_id: input.previousKeyId ?? null,
        status: "active",
      },
      input.occurredAt,
    );
  }

  async discoverSigningKeys(at: Date): Promise<readonly Readonly<DiscoverableSigningKey>[]> {
    const result = await this.#client.query<{
      algorithm: "Ed25519";
      key_id: string;
      not_before: Date;
      public_key: string;
      revoked_at: Date | null;
      status: string;
      verify_until: Date;
    }>(
      `SELECT key_id, algorithm, public_key, status, not_before, verify_until, revoked_at
       FROM key_metadata
       WHERE workspace_id = $1 AND purpose = 'capsule_signing' AND public_key IS NOT NULL
         AND not_before <= $2 AND verify_until > $2
       ORDER BY not_before DESC`,
      [this.#workspaceId, at],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          keyId: row.key_id,
          algorithm: row.algorithm,
          publicKey: row.public_key,
          status: row.status,
          notBefore: row.not_before,
          verifyUntil: row.verify_until,
          ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
        }),
      ),
    );
  }

  /** Returns the one key permitted to sign at `at`; retired and revoked keys fail closed. */
  async getActiveSigningKey(at: Date): Promise<Readonly<ActiveSigningKey> | undefined> {
    const result = await this.#client.query<{
      algorithm: "Ed25519";
      key_id: string;
      provider_ref: string;
      public_key: string;
      sign_until: Date;
    }>(
      `SELECT key_id, algorithm, provider_ref, public_key, sign_until
       FROM key_metadata
       WHERE workspace_id = $1 AND purpose = 'capsule_signing' AND status = 'active'
         AND revoked_at IS NULL AND public_key IS NOT NULL
         AND not_before <= $2 AND sign_until > $2
       ORDER BY not_before DESC
       LIMIT 1`,
      [this.#workspaceId, at],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      keyId: row.key_id,
      algorithm: row.algorithm,
      providerReference: row.provider_ref,
      publicKey: row.public_key,
      signUntil: row.sign_until,
    });
  }

  async revokeSigningKey(input: {
    readonly actorSessionId: string;
    readonly keyId: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actorId = await this.#requireHuman(input.actorSessionId, "key.manage");
    const result = await this.#client.query(
      `UPDATE key_metadata SET status = 'revoked', revoked_at = clock_timestamp()
       WHERE workspace_id = $1 AND key_id = $2 AND purpose = 'capsule_signing'
         AND status <> 'revoked'`,
      [this.#workspaceId, input.keyId],
    );
    if (result.rowCount !== 1) throw new VerusError("NOT_FOUND", "Signing key is unavailable.");
    await this.#audit(
      actorId,
      input.auditEventId,
      "signing_key.revoked",
      "key",
      input.keyId,
      {
        status: "revoked",
      },
      input.occurredAt,
    );
  }

  async #requireHuman(
    sessionId: string,
    action: "key.manage" | "service_account.manage",
  ): Promise<string> {
    const grant = await this.#identity.resolveHumanGrant(sessionId);
    assertAuthorized(grant, this.#workspaceId, action);
    if (grant.kind !== "human")
      throw new VerusError("AUTHORIZATION_DENIED", "Human grant required.");
    return grant.subjectId;
  }

  async #audit(
    actorId: string,
    eventId: string,
    action: string,
    targetType: string,
    targetId: string,
    newState: Readonly<Record<string, unknown>>,
    occurredAt: Date,
  ): Promise<void> {
    await this.#client.query(
      `INSERT INTO audit_events
         (workspace_id, event_id, actor_type, actor_id, action, target_type, target_id,
          new_state, occurred_at)
       VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8)`,
      [this.#workspaceId, eventId, actorId, action, targetType, targetId, newState, occurredAt],
    );
  }
}
