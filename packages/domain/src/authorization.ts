import { VerusError } from "./errors.js";

export const HUMAN_ROLES = [
  "owner",
  "admin",
  "policy_manager",
  "reviewer",
  "analyst",
  "auditor",
] as const;
export type HumanRole = (typeof HUMAN_ROLES)[number];

export const SERVICE_ROLES = [
  "ingestion_service",
  "scan_worker",
  "evidence_worker",
  "integration_client",
  "audit_exporter",
] as const;
export type ServiceRole = (typeof SERVICE_ROLES)[number];

export const AUTHORIZATION_ACTIONS = [
  "workspace.read",
  "workspace.update",
  "workspace.delete",
  "membership.read",
  "membership.invite",
  "membership.manage",
  "service_account.manage",
  "scan.create",
  "scan.read",
  "scan.process",
  "finding.read",
  "finding.write",
  "evidence.read",
  "evidence.write",
  "review.resolve",
  "policy.read",
  "policy.write",
  "policy.promote",
  "capsule.read",
  "audit.read",
  "audit.export",
  "integration.manage",
  "key.manage",
] as const;
export type AuthorizationAction = (typeof AUTHORIZATION_ACTIONS)[number];

export type GrantStatus = "active" | "suspended" | "revoked";

export type AuthorizationReason =
  | "ALLOW"
  | "INACTIVE_GRANT"
  | "MISSING_GRANT"
  | "ROLE_DENIED"
  | "STALE_GRANT"
  | "WORKSPACE_MISMATCH";

export interface AuthorizationDecisionEvent {
  readonly action: AuthorizationAction;
  readonly outcome: "allow" | "deny";
  readonly reason: AuthorizationReason;
  readonly subjectKind?: "human" | "service";
}

export interface AuthorizationTelemetry {
  emit(event: AuthorizationDecisionEvent): void;
}

export type AuthorizationGrant =
  | Readonly<{
      kind: "human";
      workspaceId: string;
      subjectId: string;
      role: HumanRole;
      status: GrantStatus;
      currentGrantVersion: number;
      presentedGrantVersion: number;
    }>
  | Readonly<{
      kind: "service";
      workspaceId: string;
      subjectId: string;
      role: ServiceRole;
      status: GrantStatus;
      currentGrantVersion: number;
      presentedGrantVersion: number;
    }>;

const allActions = new Set<AuthorizationAction>(AUTHORIZATION_ACTIONS);
const readActions = [
  "workspace.read",
  "scan.read",
  "finding.read",
  "evidence.read",
  "policy.read",
  "capsule.read",
] as const satisfies readonly AuthorizationAction[];

const humanPermissions: Readonly<Record<HumanRole, ReadonlySet<AuthorizationAction>>> = {
  owner: allActions,
  admin: new Set(AUTHORIZATION_ACTIONS.filter((action) => action !== "workspace.delete")),
  policy_manager: new Set([
    ...readActions,
    "scan.create",
    "review.resolve",
    "policy.write",
    "policy.promote",
  ]),
  reviewer: new Set([...readActions, "review.resolve"]),
  analyst: new Set([...readActions, "scan.create"]),
  auditor: new Set([...readActions, "audit.read", "audit.export"]),
};

const servicePermissions: Readonly<Record<ServiceRole, ReadonlySet<AuthorizationAction>>> = {
  ingestion_service: new Set(["workspace.read", "scan.create", "scan.read"]),
  scan_worker: new Set([
    "workspace.read",
    "scan.read",
    "scan.process",
    "finding.write",
    "evidence.read",
    "policy.read",
  ]),
  evidence_worker: new Set([
    "workspace.read",
    "scan.read",
    "evidence.read",
    "evidence.write",
    "finding.read",
  ]),
  integration_client: new Set([
    "workspace.read",
    "scan.create",
    "scan.read",
    "finding.read",
    "evidence.read",
    "capsule.read",
  ]),
  audit_exporter: new Set(["workspace.read", "audit.read", "audit.export"]),
};

function emitDecision(
  telemetry: AuthorizationTelemetry | undefined,
  event: AuthorizationDecisionEvent,
): void {
  try {
    telemetry?.emit(event);
  } catch {
    // Decision telemetry cannot alter authorization semantics.
  }
}

function deny(
  internalReason: string,
  reason: AuthorizationReason,
  action: AuthorizationAction,
  telemetry: AuthorizationTelemetry | undefined,
  subjectKind?: "human" | "service",
): never {
  emitDecision(telemetry, {
    action,
    outcome: "deny",
    reason,
    ...(subjectKind === undefined ? {} : { subjectKind }),
  });
  throw new VerusError("AUTHORIZATION_DENIED", internalReason);
}

export function isAuthorized(
  grant: AuthorizationGrant,
  requestedWorkspaceId: string,
  action: AuthorizationAction,
): boolean {
  if (grant.workspaceId !== requestedWorkspaceId || grant.status !== "active") return false;
  if (grant.currentGrantVersion !== grant.presentedGrantVersion) return false;
  return grant.kind === "human"
    ? humanPermissions[grant.role].has(action)
    : servicePermissions[grant.role].has(action);
}

export function assertAuthorized(
  grant: AuthorizationGrant | undefined,
  requestedWorkspaceId: string,
  action: AuthorizationAction,
  telemetry?: AuthorizationTelemetry,
): asserts grant is AuthorizationGrant {
  if (grant === undefined)
    deny("No authorization grant was resolved.", "MISSING_GRANT", action, telemetry);
  if (grant.workspaceId !== requestedWorkspaceId) {
    deny(
      "Grant workspace does not match the request.",
      "WORKSPACE_MISMATCH",
      action,
      telemetry,
      grant.kind,
    );
  }
  if (grant.status !== "active") {
    deny("Grant is not active.", "INACTIVE_GRANT", action, telemetry, grant.kind);
  }
  if (grant.currentGrantVersion !== grant.presentedGrantVersion) {
    deny("Grant version is stale.", "STALE_GRANT", action, telemetry, grant.kind);
  }
  const permitted =
    grant.kind === "human"
      ? humanPermissions[grant.role].has(action)
      : servicePermissions[grant.role].has(action);
  if (!permitted) {
    deny("Role does not permit this action.", "ROLE_DENIED", action, telemetry, grant.kind);
  }
  emitDecision(telemetry, {
    action,
    outcome: "allow",
    reason: "ALLOW",
    subjectKind: grant.kind,
  });
}

export function permissionsForRole(role: HumanRole, kind: "human"): readonly AuthorizationAction[];
export function permissionsForRole(
  role: ServiceRole,
  kind: "service",
): readonly AuthorizationAction[];
export function permissionsForRole(
  role: HumanRole | ServiceRole,
  kind: "human" | "service",
): readonly AuthorizationAction[] {
  const permissions =
    kind === "human"
      ? humanPermissions[role as HumanRole]
      : servicePermissions[role as ServiceRole];
  if (permissions === undefined) throw new TypeError("Role does not belong to the subject kind.");
  return Object.freeze(AUTHORIZATION_ACTIONS.filter((action) => permissions.has(action)));
}
