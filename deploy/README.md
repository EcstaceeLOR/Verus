# Staged deployments

Verus deployment is provider-neutral but never configuration-neutral. `environments.json` is the
reviewed environment contract: preview, staging, and production have isolated state, separate
identities, private data services, DNS/TLS/CDN at the edge, and the parser has no outbound egress.
Secrets belong in the selected external secret manager; neither this repository nor release files
contain credentials.

## Recreate staging

1. Provision the resources and identities in `environments.json` with the deployment provider's
   reviewed infrastructure runner. Create a dedicated PostgreSQL database, queue, object store,
   secret namespace, private network, DNS record, certificate, and CDN distribution.
2. Grant workloads read-only secret access and grant a distinct migration identity schema changes.
   Do not give application workloads exchange-write credentials.
3. Build and sign each OCI image, record its immutable digest in a release file based on
   `release.example.json`, then validate the release:

   ```sh
   node scripts/verify-infrastructure.mjs
   node scripts/plan-release.mjs --environment staging --release deploy/release.json
   ```

4. Take and verify a database backup, run the forward migration with the migration identity, deploy
   the digests, and smoke-test `/health/live` and `/health/ready` before traffic promotion.

## Promotion and rollback

Only `main` may progress to staging or production. Production is protected by a GitHub Environment
approval gate and must use a reviewed release file. The deployment workflow validates the plan but
does not receive deployment credentials; the external deployment runner receives a short-lived,
scoped identity only after that gate.

If smoke checks fail, stop traffic promotion, retain the expanded schema, and redeploy the immutable
`previousRevision`. Verify both health endpoints and queue compatibility. Do not run a destructive
down migration in production; restore data only through the database recovery procedure.
