# Database operations

PostgreSQL is the system of record for workspace state, scans, policy versions, finding and evidence
metadata, jobs, key metadata, audit references, and the transactional outbox. Opaque source bytes
remain in object storage and are referenced by digest.

## Runtime roles

Use separate credentials for migration and application traffic. The migration role owns the schema.
The application role must be non-superuser, must not own tenant tables, and must not have
`BYPASSRLS`. Grant only the table and sequence privileges its deployed services need. Every tenant
operation must use `withWorkspaceTransaction`; direct unscoped queries are prohibited.

Row-level security is forced on every tenant table. It reads `app.workspace_id`, which the adapter
sets with transaction-local `set_config`. An absent scope sees no tenant rows. RLS is containment in
addition to application authorization, not a replacement for it.

## Deploy and migrate

1. Back up the database and verify the restore point before a production schema change.
2. Deploy an application version compatible with both the old and expanded schema when required.
3. Set `DATABASE_URL` to the migration-role connection and run
   `pnpm --filter @verus/persistence migrate`.
4. Confirm the recorded version and migration telemetry before shifting traffic.

The runner takes a PostgreSQL advisory lock, verifies every previously applied checksum, and applies
each migration in its own transaction. A second runner waits rather than racing. Re-running an
up-to-date release is safe and makes no schema changes.

## Interrupted migration recovery

PostgreSQL rolls back the migration transaction if the process, statement, or connection fails. The
version is recorded only after all statements succeed. Preserve the failed release artifact and
database logs, correct the environmental cause, and rerun the same release. Never insert, delete, or
edit `verus_schema_migrations` manually.

If checksum verification fails, stop deployment. Restore the release containing the recorded
migration or ship a new forward migration; never rewrite an already applied file. If PostgreSQL
reports a non-transactional side effect from a future migration, follow that migration's specific
repair procedure before retrying.

## Rollback

`pnpm --filter @verus/persistence migrate:down` targets version zero and is destructive. Use it only
for a new installation, an explicitly approved rollback window, or a restore drill. In production,
prefer application rollback while retaining expanded columns, then contract the schema in a later
reviewed release. Verify backup, compatibility, and data-retention requirements before any down
migration.

## Transaction and concurrency rules

- Keep network calls and model inference outside database transactions.
- Use `read committed` for ordinary writes and request stronger isolation explicitly for invariants
  spanning multiple rows.
- Scan transitions require both the expected state and state version. A stale writer receives a
  conflict and must reload; it must not retry a state decision blindly.
- Write an outbox event in the same transaction as any state change that requires downstream work.
- Store identifiers and safe error codes in operational telemetry, never tenant content or secrets.

Job leases, retries, and dead-letter recovery have additional operational requirements in the
[durable jobs runbook](./durable-jobs.md).
