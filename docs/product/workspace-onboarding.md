# Workspace onboarding and access

The hosted console turns a signed-in Verus user into a tenant-scoped operator. Authentication is
delegated to Clerk; roles and permissions are resolved by Verus from PostgreSQL on every control
plane request. Browser claims never grant a Verus role.

## First run

1. Select **Sign in**, then **Open console**.
2. Create a workspace. Verus creates the owner membership and immutable audit event in one
   serializable transaction.
3. Use **Open scanner** to test the live firewall. The hosted scanner needs no account or API key.
4. Optionally invite a teammate or create a scoped Verus integration key.

The console never requests an exchange, Bitget, wallet, trading, or withdrawal credential. A Verus
integration key can submit scans and read scan findings only. It is shown once, must be stored in a
secret manager, and can be revoked from the console.

## Roles and safe failure

The console renders the exact permission list returned by the backend. Owners and administrators can
invite members and manage integration keys. Other roles see read-only explanations in place of
controls they cannot use. The backend repeats authorization inside the workspace transaction, so
hiding a browser control is never the security boundary.

Invitation email addresses and identity-provider subject identifiers are stored as keyed digests.
Invitation links expire after seven days and are bound to the signed-in user's primary email. An
expired session, stale grant, suspended membership, wrong workspace, or unavailable dependency
returns an explicit failure; it never becomes an allow decision.

## Operations and rollback

The hosted route requires `DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`VERUS_IDENTITY_PEPPER`, and `VERUS_API_KEY_PEPPER`. `VERUS_AUTHORIZED_PARTIES` restricts accepted
Clerk session origins, and `VERUS_PUBLIC_URL` determines invitation links. The two peppers must be
independent 32-byte base64url secrets.

Migration 0011 adds only the security-definer identity-to-workspace lookup required before a tenant
transaction can be opened. Its down migration removes that function. Roll back the application
deployment before applying the down migration; existing workspaces, memberships, invitations, and
keys are unaffected.
