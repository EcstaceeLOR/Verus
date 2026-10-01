# Identity and authorization

Verus delegates authentication to a configured OIDC-capable identity provider and owns workspace
authorization. Browser claims never select a workspace role. The server resolves an authenticated
provider subject to a current database membership and evaluates the shared policy in `@verus/domain`
for every protected action.

## Identity-provider boundary

An API adapter must verify signature, issuer, audience, expiry, nonce, and provider session state
before calling persistence. It then HMACs the provider subject and normalized email with a dedicated
identity pepper. Verus stores only the resulting `sha256:` digests. Raw provider subjects, email
addresses, passwords, bearer tokens, and invitation tokens are not persisted or logged.

The provider adapter supplies a candidate Verus identity ID, provider name, and verified subject
digest. A restricted security-definer database function resolves an existing identity or creates the
candidate. The application role has no direct identity-table mutation permission. Deployments must
grant that role `EXECUTE` on `verus_resolve_identity(text, text, text)` and scoped table privileges,
never table ownership, superuser, or `BYPASSRLS`.

## Human roles

| Role             | Intended authority                                                                     |
| ---------------- | -------------------------------------------------------------------------------------- |
| `owner`          | All workspace actions, including ownership transfer and workspace deletion             |
| `admin`          | Membership, service account, key, integration, policy, review, and operational control |
| `policy_manager` | Read workspace data; create scans; author, promote, and review policy decisions        |
| `reviewer`       | Read scans, findings, evidence, policy, and capsules; resolve reviews                  |
| `analyst`        | Submit and inspect scans, findings, evidence, policy, and capsules                     |
| `auditor`        | Read product records and audit data; export authorized audit evidence                  |

Only an owner can change an owner membership. Invitations cannot grant `owner`; ownership is an
explicit audited role change. A database guard serializes owner changes and refuses to remove or
demote the final active owner.

## Service-account roles

| Role                 | Intended authority                                              |
| -------------------- | --------------------------------------------------------------- |
| `ingestion_service`  | Create and read scans                                           |
| `scan_worker`        | Process scans and write findings using readable policy/evidence |
| `evidence_worker`    | Read scans/findings and read or write evidence                  |
| `integration_client` | Submit/read scans and read findings, evidence, and capsules     |
| `audit_exporter`     | Read and export audit records                                   |

Service roles never inherit human administration, policy promotion, or review approval. Credentials
for these accounts are implemented by the separate key-lifecycle boundary; the RBAC layer stores no
secret material.

## Sessions and revocation

Authorization sessions store the grant version present when the session was created. Every decision
requires an active subject, exact workspace match, unexpired and unrevoked session, current grant
version, and permitted action. Database triggers increment the grant version and revoke all affected
sessions whenever a membership or service-account role/status changes. Disabling an external
identity also fails authorization when the grant is resolved.

Session IDs and invitation tokens must contain at least 256 bits of CSPRNG entropy. Store only a
peppered token digest where a bearer secret is involved. Invitation acceptance checks workspace,
token digest, verified email digest, pending state, and expiry under a row lock, then consumes the
invitation and creates the membership atomically.

## Audit and telemetry

Invitation creation/acceptance, membership changes, owner creation, and service-account changes
append an audit event in the same transaction as the administrative mutation. Audit rows are
append-only. Authorization telemetry contains only action, human/service kind, allow/deny outcome,
and a bounded reason code; it contains no subject, workspace, email, token, or source content.

## Rollback

Migration `0002_identity_rbac` has a paired down migration for new-installation and restore testing.
Do not roll it back after issuing production memberships or sessions without an approved export and
restore plan. Application rollback remains safe because the migration is additive to the platform
schema; retain the tables through the compatibility window and contract them only in a later
release.
