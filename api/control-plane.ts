import { createHash, createHmac, randomBytes } from "node:crypto";

import { createClerkClient, verifyToken } from "@clerk/backend";
import { Pool } from "pg";

import { issueApiKey, SecretValue } from "../packages/crypto/src/index.js";
import {
  HUMAN_ROLES,
  permissionsForRole,
  VerusError,
  type HumanRole,
} from "../packages/domain/src/index.js";
import {
  findWorkspaceMemberships,
  provisionWorkspaceWithOwner,
  withWorkspaceTransaction,
  workspaceId,
  type WorkspaceId,
} from "../packages/persistence/src/index.js";
import { StructuredLogger } from "../packages/observability/src/index.js";

import type { HostedRequest, HostedResponse } from "./http.js";
import { secureJson } from "./http.js";

const PROVIDER = "clerk";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const INVITABLE_ROLES = new Set<HumanRole>(HUMAN_ROLES.filter((role) => role !== "owner"));
const MEMBER_STATUSES = new Set(["active", "suspended", "removed"] as const);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 30_000,
});
const logger = new StructuredLogger("verus-console-api");

interface AuthenticatedUser {
  readonly userId: string;
  readonly providerSubjectDigest: string;
  readonly sessionSeed: string;
  readonly expiresAt: Date;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new VerusError("SERVICE_UNAVAILABLE", `${name} is not configured.`);
  }
  return value;
}

function secretFromEnvironment(name: string): SecretValue {
  const encoded = requiredEnvironment(name);
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.byteLength !== 32)
    throw new VerusError("SERVICE_UNAVAILABLE", `${name} must contain 32 bytes.`);
  return new SecretValue(bytes);
}

function header(request: HostedRequest, name: string): string | undefined {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return typeof value === "string" ? value : value?.[0];
}

function jsonBody(request: HostedRequest): Readonly<Record<string, unknown>> {
  let value = request.body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new VerusError("CONTRACT_VALIDATION_FAILED", "Request body is not valid JSON.");
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VerusError("CONTRACT_VALIDATION_FAILED", "A JSON object is required.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function textField(body: Readonly<Record<string, unknown>>, name: string, maximum: number): string {
  const value = body[name];
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maximum) {
    throw new VerusError("CONTRACT_VALIDATION_FAILED", `${name} is invalid.`);
  }
  return value.trim();
}

function encodeCrockford(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = CROCKFORD[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

export function opaqueId(prefix: string): string {
  return `${prefix}_${encodeCrockford(randomBytes(16))}`;
}

function stableId(prefix: string, value: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(value, "utf8").digest().subarray(0, 16);
  return `${prefix}_${encodeCrockford(digest)}`;
}

function keyedDigest(value: string, secret: string): string {
  return `sha256:${createHmac("sha256", secret).update(value, "utf8").digest("hex")}`;
}

function publicDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function authorizedParties(): readonly string[] {
  const configured = process.env.VERUS_AUTHORIZED_PARTIES;
  return configured === undefined
    ? ["https://verus-ochre.vercel.app", "http://localhost:3000"]
    : configured
        .split(",")
        .map((party) => party.trim())
        .filter(Boolean);
}

async function authenticate(request: HostedRequest): Promise<AuthenticatedUser> {
  const authorization = header(request, "authorization");
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new VerusError("AUTHENTICATION_REQUIRED", "Sign in to continue.");
  }
  try {
    const token = await verifyToken(authorization.slice(7), {
      secretKey: requiredEnvironment("CLERK_SECRET_KEY"),
      authorizedParties: [...authorizedParties()],
    });
    if (typeof token.sub !== "string" || typeof token.sid !== "string") {
      throw new Error("Session claims are incomplete.");
    }
    const identitySecret = requiredEnvironment("VERUS_IDENTITY_PEPPER");
    return Object.freeze({
      userId: token.sub,
      providerSubjectDigest: keyedDigest(token.sub, identitySecret),
      sessionSeed: token.sid,
      expiresAt: new Date(token.exp * 1000),
    });
  } catch (error) {
    if (error instanceof VerusError) throw error;
    throw new VerusError("AUTHENTICATION_REQUIRED", "The sign-in session is invalid or expired.", {
      cause: error,
    });
  }
}

function sessionId(user: AuthenticatedUser, selectedWorkspaceId: WorkspaceId): string {
  return stableId(
    "session",
    `${user.sessionSeed}:${selectedWorkspaceId}`,
    requiredEnvironment("VERUS_IDENTITY_PEPPER"),
  );
}

async function loadControlPlane(user: AuthenticatedUser, requestedWorkspace?: string) {
  const memberships = await findWorkspaceMemberships(pool, {
    provider: PROVIDER,
    providerSubjectDigest: user.providerSubjectDigest,
  });
  const selectable = memberships.filter((membership) => membership.status === "active");
  const selected =
    requestedWorkspace === undefined
      ? selectable[0]
      : selectable.find((membership) => membership.workspaceId === requestedWorkspace);
  if (requestedWorkspace !== undefined && selected === undefined) {
    throw new VerusError("AUTHORIZATION_DENIED", "Workspace access is unavailable.");
  }
  const workspaceList = await Promise.all(
    memberships.map(async (membership) =>
      withWorkspaceTransaction(pool, membership.workspaceId, async (store) => {
        const workspace = await store.getWorkspace();
        return {
          id: membership.workspaceId,
          name: workspace.displayName,
          slug: workspace.slug,
          status: workspace.status,
          membershipStatus: membership.status,
          role: membership.role,
        };
      }),
    ),
  );
  if (selected === undefined) return { workspaces: workspaceList, activeWorkspace: null };

  const activeWorkspace = await withWorkspaceTransaction(
    pool,
    selected.workspaceId,
    async (store) => {
      const identity = store.identity();
      const stableSessionId = sessionId(user, selected.workspaceId);
      const grant = await identity.ensureHumanSession({
        sessionId: stableSessionId,
        identityId: stableId("user", user.userId, requiredEnvironment("VERUS_IDENTITY_PEPPER")),
        provider: PROVIDER,
        providerSubjectDigest: user.providerSubjectDigest,
        expiresAt: user.expiresAt,
      });
      if (grant.kind !== "human")
        throw new VerusError("AUTHORIZATION_DENIED", "A human workspace role is required.");
      const permissions = permissionsForRole(grant.role, "human");
      const workspace = await store.getWorkspace();
      const canReadMembers = permissions.includes("membership.read");
      const canManageKeys = permissions.includes("service_account.manage");
      return {
        id: selected.workspaceId,
        name: workspace.displayName,
        slug: workspace.slug,
        status: workspace.status,
        role: grant.role,
        permissions,
        members: canReadMembers ? await identity.listMemberships(stableSessionId) : [],
        invitations: canReadMembers ? await identity.listInvitations(stableSessionId) : [],
        apiKeys: canManageKeys ? await store.credentials().listApiKeys(stableSessionId) : [],
      };
    },
    { operationName: "console.load" },
  );
  return { workspaces: workspaceList, activeWorkspace };
}

async function selectedWorkspace(
  request: HostedRequest,
  user: AuthenticatedUser,
): Promise<WorkspaceId> {
  const requested = header(request, "x-verus-workspace-id");
  if (requested === undefined)
    throw new VerusError("CONTRACT_VALIDATION_FAILED", "Select a workspace first.");
  const parsed = workspaceId(requested);
  const memberships = await findWorkspaceMemberships(pool, {
    provider: PROVIDER,
    providerSubjectDigest: user.providerSubjectDigest,
  });
  if (
    !memberships.some(
      (membership) => membership.workspaceId === parsed && membership.status === "active",
    )
  ) {
    throw new VerusError("AUTHORIZATION_DENIED", "Workspace access is unavailable.");
  }
  return parsed;
}

async function verifiedPrimaryEmail(userId: string): Promise<string> {
  const clerk = createClerkClient({ secretKey: requiredEnvironment("CLERK_SECRET_KEY") });
  const user = await clerk.users.getUser(userId);
  const address = user.emailAddresses.find(
    (candidate) => candidate.id === user.primaryEmailAddressId,
  )?.emailAddress;
  if (address === undefined)
    throw new VerusError(
      "CONTRACT_VALIDATION_FAILED",
      "A primary email is required to accept an invitation.",
    );
  return address.trim().toLowerCase();
}

async function performAction(
  request: HostedRequest,
  user: AuthenticatedUser,
  body: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const action = textField(body, "action", 64);
  const now = new Date();
  const identitySecret = requiredEnvironment("VERUS_IDENTITY_PEPPER");

  if (action === "create_workspace") {
    const displayName = textField(body, "name", 80);
    const workspace = workspaceId(opaqueId("ws"));
    const slugBase =
      displayName
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48) || "workspace";
    await provisionWorkspaceWithOwner(pool, {
      workspaceId: workspace,
      slug: `${slugBase}-${workspace.slice(-8).toLowerCase()}`,
      displayName,
      identityId: stableId("user", user.userId, identitySecret),
      provider: PROVIDER,
      providerSubjectDigest: user.providerSubjectDigest,
      membershipId: opaqueId("member"),
      auditEventId: opaqueId("event"),
      occurredAt: now,
    });
    logger.emit({ level: "info", event: "console.workspace_created", outcome: "success" });
    return { workspaceId: workspace };
  }

  if (action === "accept_invitation") {
    const invitationWorkspace = workspaceId(textField(body, "workspaceId", 64));
    const invitationId = textField(body, "invitationId", 64);
    const token = textField(body, "token", 256);
    const email = await verifiedPrimaryEmail(user.userId);
    await withWorkspaceTransaction(
      pool,
      invitationWorkspace,
      (store) =>
        store.identity().acceptInvitation({
          invitationId,
          tokenDigest: publicDigest(token),
          emailDigest: keyedDigest(email, identitySecret),
          identityId: stableId("user", user.userId, identitySecret),
          provider: PROVIDER,
          providerSubjectDigest: user.providerSubjectDigest,
          membershipId: opaqueId("member"),
          auditEventId: opaqueId("event"),
          occurredAt: now,
        }),
      { operationName: "console.invitation_accept" },
    );
    logger.emit({ level: "info", event: "console.invitation_accepted", outcome: "success" });
    return { accepted: true, workspaceId: invitationWorkspace };
  }

  const selected = await selectedWorkspace(request, user);
  const stableSessionId = sessionId(user, selected);
  const sessionInput = {
    sessionId: stableSessionId,
    identityId: stableId("user", user.userId, identitySecret),
    provider: PROVIDER,
    providerSubjectDigest: user.providerSubjectDigest,
    expiresAt: user.expiresAt,
  };

  if (action === "create_invitation") {
    const email = textField(body, "email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new VerusError("CONTRACT_VALIDATION_FAILED", "Enter a valid email address.");
    const role = textField(body, "role", 32) as HumanRole;
    if (!INVITABLE_ROLES.has(role))
      throw new VerusError("CONTRACT_VALIDATION_FAILED", "Select an invitational role.");
    const invitationId = opaqueId("invite");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await withWorkspaceTransaction(pool, selected, async (store) => {
      const identity = store.identity();
      await identity.ensureHumanSession(sessionInput);
      await identity.createInvitation({
        actorSessionId: stableSessionId,
        invitationId,
        emailDigest: keyedDigest(email, identitySecret),
        tokenDigest: publicDigest(token),
        role: role as Exclude<HumanRole, "owner">,
        expiresAt,
        auditEventId: opaqueId("event"),
        occurredAt: now,
      });
    });
    const publicUrl = process.env.VERUS_PUBLIC_URL ?? "https://verus-ochre.vercel.app";
    const inviteUrl = new URL(publicUrl);
    inviteUrl.searchParams.set("invite", `${selected}.${invitationId}.${token}`);
    logger.emit({ level: "info", event: "console.invitation_created", outcome: "success" });
    return { inviteUrl: inviteUrl.toString(), expiresAt: expiresAt.toISOString() };
  }

  if (action === "change_membership") {
    const membershipId = textField(body, "membershipId", 64);
    const role = textField(body, "role", 32) as HumanRole;
    const status = textField(body, "status", 16) as "active" | "removed" | "suspended";
    if (!HUMAN_ROLES.includes(role) || !MEMBER_STATUSES.has(status))
      throw new VerusError("CONTRACT_VALIDATION_FAILED", "Role or membership status is invalid.");
    await withWorkspaceTransaction(pool, selected, async (store) => {
      const identity = store.identity();
      await identity.ensureHumanSession(sessionInput);
      await identity.changeMembership({
        actorSessionId: stableSessionId,
        membershipId,
        role,
        status,
        auditEventId: opaqueId("event"),
        occurredAt: now,
      });
    });
    logger.emit({ level: "info", event: "console.membership_changed", outcome: "success" });
    return { updated: true };
  }

  if (action === "create_api_key") {
    const displayName = textField(body, "name", 80);
    const serviceAccountId = opaqueId("svc");
    const keyId = opaqueId("key");
    const scopes = ["workspace.read", "scan.create", "scan.read", "finding.read"] as const;
    const pepper = secretFromEnvironment("VERUS_API_KEY_PEPPER");
    const issued = issueApiKey(keyId, scopes, pepper);
    try {
      await withWorkspaceTransaction(pool, selected, async (store) => {
        const identity = store.identity();
        await identity.ensureHumanSession(sessionInput);
        await identity.createServiceAccount({
          actorSessionId: stableSessionId,
          serviceAccountId,
          displayName,
          role: "integration_client",
          auditEventId: opaqueId("event"),
          occurredAt: now,
        });
        await store.credentials().registerApiKey({
          actorSessionId: stableSessionId,
          keyId,
          serviceAccountId,
          prefix: issued.metadata.prefix,
          verifier: issued.metadata.verifier,
          verifierVersion: 1,
          scopes,
          auditEventId: opaqueId("event"),
          occurredAt: now,
        });
      });
      logger.emit({ level: "info", event: "console.api_key_created", outcome: "success" });
      return { apiKey: issued.revealOnce(), keyId, scopes };
    } catch (error) {
      issued.destroy();
      throw error;
    } finally {
      pepper.destroy();
    }
  }

  if (action === "revoke_api_key") {
    const keyId = textField(body, "keyId", 64);
    await withWorkspaceTransaction(pool, selected, async (store) => {
      const identity = store.identity();
      await identity.ensureHumanSession(sessionInput);
      await store.credentials().revokeApiKey({
        actorSessionId: stableSessionId,
        keyId,
        auditEventId: opaqueId("event"),
        occurredAt: now,
      });
    });
    logger.emit({ level: "info", event: "console.api_key_revoked", outcome: "success" });
    return { revoked: true };
  }

  throw new VerusError("CONTRACT_VALIDATION_FAILED", "Action is not supported.");
}

function errorStatus(error: unknown): number {
  if (!(error instanceof VerusError)) return 500;
  if (error.code === "AUTHENTICATION_REQUIRED") return 401;
  if (error.code === "AUTHORIZATION_DENIED") return 403;
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "CONFLICT") return 409;
  if (error.code === "CONTRACT_VALIDATION_FAILED") return 400;
  return 503;
}

export default async function controlPlane(
  request: HostedRequest,
  response: HostedResponse,
): Promise<void> {
  secureJson(response);
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }
  try {
    const user = await authenticate(request);
    const result =
      request.method === "GET"
        ? await loadControlPlane(user, header(request, "x-verus-workspace-id"))
        : await performAction(request, user, jsonBody(request));
    response.status(200).json(result);
  } catch (error) {
    const status = errorStatus(error);
    logger.emit({
      level: "error",
      event: "console.request_failed",
      component: "control-plane",
      outcome: "failure",
      errorCode: error instanceof VerusError ? error.code : "INTERNAL_ERROR",
    });
    response.status(status).json({
      error: error instanceof VerusError ? error.code : "INTERNAL_ERROR",
      message:
        error instanceof VerusError && status < 500
          ? error.message
          : "Verus could not complete this request. Try again shortly.",
    });
  }
}
