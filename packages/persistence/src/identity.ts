import {
  assertAuthorized,
  VerusError,
  type AuthorizationAction,
  type AuthorizationGrant,
  type GrantStatus,
  type HumanRole,
  type ServiceRole,
} from "@verus/domain";
import type { PoolClient } from "pg";

import type { WorkspaceId } from "./workspace.js";

interface HumanGrantRow {
  grant_version: string;
  identity_status: "active" | "deleted" | "disabled";
  membership_id: string;
  membership_status: "active" | "invited" | "removed" | "suspended";
  role: HumanRole;
  session_grant_version: string;
  workspace_id: WorkspaceId;
}

interface ServiceGrantRow {
  grant_version: string;
  role: ServiceRole;
  service_account_id: string;
  session_grant_version: string;
  status: GrantStatus;
  workspace_id: WorkspaceId;
}

function humanStatus(row: HumanGrantRow): GrantStatus {
  if (row.identity_status !== "active" || ["invited", "removed"].includes(row.membership_status)) {
    return "revoked";
  }
  return row.membership_status === "suspended" ? "suspended" : "active";
}

function humanGrant(row: HumanGrantRow): AuthorizationGrant {
  return Object.freeze({
    kind: "human",
    workspaceId: row.workspace_id,
    subjectId: row.membership_id,
    role: row.role,
    status: humanStatus(row),
    currentGrantVersion: Number(row.grant_version),
    presentedGrantVersion: Number(row.session_grant_version),
  });
}

function serviceGrant(row: ServiceGrantRow): AuthorizationGrant {
  return Object.freeze({
    kind: "service",
    workspaceId: row.workspace_id,
    subjectId: row.service_account_id,
    role: row.role,
    status: row.status,
    currentGrantVersion: Number(row.grant_version),
    presentedGrantVersion: Number(row.session_grant_version),
  });
}

export class IdentityPersistence {
  readonly #client: PoolClient;
  readonly #workspaceId: WorkspaceId;

  constructor(client: PoolClient, workspaceId: WorkspaceId) {
    this.#client = client;
    this.#workspaceId = workspaceId;
  }

  async resolveIdentity(input: {
    readonly identityId: string;
    readonly provider: string;
    readonly providerSubjectDigest: string;
  }): Promise<string> {
    const result = await this.#client.query<{ identity_id: string }>(
      "SELECT verus_resolve_identity($1, $2, $3) AS identity_id",
      [input.identityId, input.provider, input.providerSubjectDigest],
    );
    const identityId = result.rows[0]?.identity_id;
    if (identityId === undefined)
      throw new VerusError("SERVICE_UNAVAILABLE", "Identity resolution failed.");
    return identityId;
  }

  async createOwnerMembership(input: {
    readonly membershipId: string;
    readonly identityId: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    await this.#client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      this.#workspaceId,
    ]);
    const result = await this.#client.query(
      `INSERT INTO memberships
         (workspace_id, membership_id, identity_id, role, status, joined_at)
       SELECT $1, $2, $3, 'owner', 'active', clock_timestamp()
       WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE workspace_id = $1)`,
      [this.#workspaceId, input.membershipId, input.identityId],
    );
    if (result.rowCount !== 1) {
      throw new VerusError("CONFLICT", "Workspace already has a membership.");
    }
    await this.#audit({
      eventId: input.auditEventId,
      actorType: "user",
      actorId: input.identityId,
      action: "membership.owner_created",
      targetType: "membership",
      targetId: input.membershipId,
      occurredAt: input.occurredAt,
      newState: { role: "owner", status: "active" },
    });
  }

  async createHumanSession(input: {
    readonly sessionId: string;
    readonly identityId: string;
    readonly provider: string;
    readonly providerSubjectDigest: string;
    readonly expiresAt: Date;
  }): Promise<AuthorizationGrant> {
    const resolvedIdentityId = await this.resolveIdentity(input);
    const member = await this.#client.query<{
      grant_version: string;
      membership_id: string;
    }>(
      `SELECT membership_id, grant_version FROM memberships
       WHERE workspace_id = $1 AND identity_id = $2 AND status = 'active'`,
      [this.#workspaceId, resolvedIdentityId],
    );
    const row = member.rows[0];
    if (row === undefined)
      throw new VerusError("AUTHORIZATION_DENIED", "No active membership exists.");
    await this.#client.query(
      `INSERT INTO authorization_sessions
         (workspace_id, session_id, subject_kind, membership_id, grant_version, expires_at)
       VALUES ($1, $2, 'human', $3, $4, $5)`,
      [this.#workspaceId, input.sessionId, row.membership_id, row.grant_version, input.expiresAt],
    );
    const grant = await this.resolveHumanGrant(input.sessionId);
    if (grant === undefined)
      throw new VerusError("AUTHORIZATION_DENIED", "Session grant is unavailable.");
    return grant;
  }

  async resolveHumanGrant(sessionId: string): Promise<AuthorizationGrant | undefined> {
    const result = await this.#client.query<HumanGrantRow>(
      `SELECT m.workspace_id, m.membership_id, m.role, m.status AS membership_status,
              m.grant_version, s.grant_version AS session_grant_version,
              i.status AS identity_status
       FROM authorization_sessions s
       JOIN memberships m
         ON m.workspace_id = s.workspace_id AND m.membership_id = s.membership_id
       JOIN identities i ON i.identity_id = m.identity_id
       WHERE s.workspace_id = $1 AND s.session_id = $2 AND s.subject_kind = 'human'
         AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()`,
      [this.#workspaceId, sessionId],
    );
    return result.rows[0] === undefined ? undefined : humanGrant(result.rows[0]);
  }

  async resolveServiceGrant(sessionId: string): Promise<AuthorizationGrant | undefined> {
    const result = await this.#client.query<ServiceGrantRow>(
      `SELECT a.workspace_id, a.service_account_id, a.role, a.status,
              a.grant_version, s.grant_version AS session_grant_version
       FROM authorization_sessions s
       JOIN service_accounts a
         ON a.workspace_id = s.workspace_id
        AND a.service_account_id = s.service_account_id
       WHERE s.workspace_id = $1 AND s.session_id = $2 AND s.subject_kind = 'service'
         AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()`,
      [this.#workspaceId, sessionId],
    );
    return result.rows[0] === undefined ? undefined : serviceGrant(result.rows[0]);
  }

  async createServiceSession(input: {
    readonly sessionId: string;
    readonly serviceAccountId: string;
    readonly expiresAt: Date;
  }): Promise<AuthorizationGrant> {
    const account = await this.#client.query<{ grant_version: string }>(
      `SELECT grant_version FROM service_accounts
       WHERE workspace_id = $1 AND service_account_id = $2 AND status = 'active'`,
      [this.#workspaceId, input.serviceAccountId],
    );
    const row = account.rows[0];
    if (row === undefined)
      throw new VerusError("AUTHORIZATION_DENIED", "Service account is unavailable.");
    await this.#client.query(
      `INSERT INTO authorization_sessions
         (workspace_id, session_id, subject_kind, service_account_id, grant_version, expires_at)
       VALUES ($1, $2, 'service', $3, $4, $5)`,
      [
        this.#workspaceId,
        input.sessionId,
        input.serviceAccountId,
        row.grant_version,
        input.expiresAt,
      ],
    );
    const grant = await this.resolveServiceGrant(input.sessionId);
    if (grant === undefined)
      throw new VerusError("AUTHORIZATION_DENIED", "Session grant is unavailable.");
    return grant;
  }

  /** Authorizes a human control-plane action and returns its audit actor identity. */
  async requireHumanAction(sessionId: string, action: AuthorizationAction): Promise<string> {
    return (await this.#requireHuman(sessionId, action)).subjectId;
  }

  async createInvitation(input: {
    readonly actorSessionId: string;
    readonly invitationId: string;
    readonly emailDigest: string;
    readonly tokenDigest: string;
    readonly role: Exclude<HumanRole, "owner">;
    readonly expiresAt: Date;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actor = await this.#requireHuman(input.actorSessionId, "membership.invite");
    await this.#client.query(
      `INSERT INTO invitations
         (workspace_id, invitation_id, email_digest, token_digest, role,
          invited_by_membership_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        this.#workspaceId,
        input.invitationId,
        input.emailDigest,
        input.tokenDigest,
        input.role,
        actor.subjectId,
        input.expiresAt,
      ],
    );
    await this.#audit({
      eventId: input.auditEventId,
      actorType: "user",
      actorId: actor.subjectId,
      action: "membership.invited",
      targetType: "invitation",
      targetId: input.invitationId,
      occurredAt: input.occurredAt,
      newState: { role: input.role, status: "pending" },
    });
  }

  async acceptInvitation(input: {
    readonly invitationId: string;
    readonly tokenDigest: string;
    readonly emailDigest: string;
    readonly identityId: string;
    readonly provider: string;
    readonly providerSubjectDigest: string;
    readonly membershipId: string;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const resolvedIdentityId = await this.resolveIdentity(input);
    const invitation = await this.#client.query<{ role: Exclude<HumanRole, "owner"> }>(
      `SELECT role FROM invitations
       WHERE workspace_id = $1 AND invitation_id = $2 AND token_digest = $3
         AND email_digest = $4 AND status = 'pending' AND expires_at > clock_timestamp()
       FOR UPDATE`,
      [this.#workspaceId, input.invitationId, input.tokenDigest, input.emailDigest],
    );
    const row = invitation.rows[0];
    if (row === undefined) {
      throw new VerusError(
        "AUTHORIZATION_DENIED",
        "Invitation is invalid, expired, or already used.",
      );
    }
    await this.#client.query(
      `INSERT INTO memberships
         (workspace_id, membership_id, identity_id, role, status, joined_at)
       VALUES ($1, $2, $3, $4, 'active', clock_timestamp())`,
      [this.#workspaceId, input.membershipId, resolvedIdentityId, row.role],
    );
    await this.#client.query(
      `UPDATE invitations
       SET status = 'accepted', accepted_by_identity_id = $3,
           accepted_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE workspace_id = $1 AND invitation_id = $2`,
      [this.#workspaceId, input.invitationId, resolvedIdentityId],
    );
    await this.#audit({
      eventId: input.auditEventId,
      actorType: "user",
      actorId: resolvedIdentityId,
      action: "membership.invitation_accepted",
      targetType: "membership",
      targetId: input.membershipId,
      occurredAt: input.occurredAt,
      newState: { role: row.role, status: "active" },
    });
  }

  async changeMembership(input: {
    readonly actorSessionId: string;
    readonly membershipId: string;
    readonly role: HumanRole;
    readonly status: "active" | "removed" | "suspended";
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actor = await this.#requireHuman(input.actorSessionId, "membership.manage");
    await this.#client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      this.#workspaceId,
    ]);
    const current = await this.#client.query<{ role: HumanRole; status: string }>(
      `SELECT role, status FROM memberships
       WHERE workspace_id = $1 AND membership_id = $2 FOR UPDATE`,
      [this.#workspaceId, input.membershipId],
    );
    const previous = current.rows[0];
    if (previous === undefined) throw new VerusError("NOT_FOUND", "Membership does not exist.");
    if ((previous.role === "owner" || input.role === "owner") && actor.role !== "owner") {
      throw new VerusError("AUTHORIZATION_DENIED", "Only an owner can change owner membership.");
    }
    await this.#client.query(
      `UPDATE memberships SET role = $3, status = $4,
         joined_at = CASE WHEN $4 = 'active' THEN coalesce(joined_at, clock_timestamp()) ELSE joined_at END
       WHERE workspace_id = $1 AND membership_id = $2`,
      [this.#workspaceId, input.membershipId, input.role, input.status],
    );
    await this.#audit({
      eventId: input.auditEventId,
      actorType: "user",
      actorId: actor.subjectId,
      action: "membership.changed",
      targetType: "membership",
      targetId: input.membershipId,
      occurredAt: input.occurredAt,
      previousState: previous,
      newState: { role: input.role, status: input.status },
    });
  }

  async createServiceAccount(input: {
    readonly actorSessionId: string;
    readonly serviceAccountId: string;
    readonly displayName: string;
    readonly role: ServiceRole;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actor = await this.#requireHuman(input.actorSessionId, "service_account.manage");
    await this.#client.query(
      `INSERT INTO service_accounts
         (workspace_id, service_account_id, display_name, role, created_by_membership_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [this.#workspaceId, input.serviceAccountId, input.displayName, input.role, actor.subjectId],
    );
    await this.#audit({
      eventId: input.auditEventId,
      actorType: "user",
      actorId: actor.subjectId,
      action: "service_account.created",
      targetType: "service_account",
      targetId: input.serviceAccountId,
      occurredAt: input.occurredAt,
      newState: { role: input.role, status: "active" },
    });
  }

  async changeServiceAccount(input: {
    readonly actorSessionId: string;
    readonly serviceAccountId: string;
    readonly role: ServiceRole;
    readonly status: GrantStatus;
    readonly auditEventId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    const actor = await this.#requireHuman(input.actorSessionId, "service_account.manage");
    const current = await this.#client.query<{ role: ServiceRole; status: GrantStatus }>(
      `SELECT role, status FROM service_accounts
       WHERE workspace_id = $1 AND service_account_id = $2 FOR UPDATE`,
      [this.#workspaceId, input.serviceAccountId],
    );
    const previous = current.rows[0];
    if (previous === undefined)
      throw new VerusError("NOT_FOUND", "Service account does not exist.");
    await this.#client.query(
      `UPDATE service_accounts SET role = $3, status = $4
       WHERE workspace_id = $1 AND service_account_id = $2`,
      [this.#workspaceId, input.serviceAccountId, input.role, input.status],
    );
    await this.#audit({
      eventId: input.auditEventId,
      actorType: "user",
      actorId: actor.subjectId,
      action: "service_account.changed",
      targetType: "service_account",
      targetId: input.serviceAccountId,
      occurredAt: input.occurredAt,
      previousState: previous,
      newState: { role: input.role, status: input.status },
    });
  }

  async #requireHuman(
    sessionId: string,
    action: AuthorizationAction,
  ): Promise<Extract<AuthorizationGrant, { kind: "human" }>> {
    const grant = await this.resolveHumanGrant(sessionId);
    assertAuthorized(grant, this.#workspaceId, action);
    if (grant.kind !== "human")
      throw new VerusError("AUTHORIZATION_DENIED", "Human grant required.");
    return grant;
  }

  async #audit(input: {
    readonly eventId: string;
    readonly actorType: "service" | "user";
    readonly actorId: string;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly occurredAt: Date;
    readonly previousState?: Readonly<Record<string, unknown>>;
    readonly newState?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.#client.query(
      `INSERT INTO audit_events
         (workspace_id, event_id, actor_type, actor_id, action, target_type, target_id,
          previous_state, new_state, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        this.#workspaceId,
        input.eventId,
        input.actorType,
        input.actorId,
        input.action,
        input.targetType,
        input.targetId,
        input.previousState ?? null,
        input.newState ?? null,
        input.occurredAt,
      ],
    );
  }
}
