# Tenant controls

Tenant isolation is enforced by workspace-scoped PostgreSQL transactions, API-key workspace binding,
object and queue workspace scope, and the public API admission boundary. A resource lookup from the
wrong workspace returns the same safe not-found result as a missing record.

`TenantQuotaAdmission` applies a workspace-wide limit before a key-specific limit. It returns a
bounded `Retry-After` value for quota pressure and does not disclose other workspace activity.
Production deployments replace its local counter storage with the environment's shared tenant-scoped
counter backend; the API contract remains identical.

An owner or admin changes workspace status only through `WorkspacePersistence.setWorkspaceStatus`.
That action requires `workspace.update`, rejects deleting workspaces, and appends an immutable
`workspace.status_changed` audit event. A suspended workspace's API keys are rejected during
authentication, before data access.

Abuse response starts by suspending admission, rotating compromised keys where needed, and reviewing
the authorized audit trail. Do not put workspace identifiers, request bodies, or customer content in
rate-limit telemetry or incident notes.
