# Persistence

PostgreSQL repositories, migrations, and transaction boundaries for Verus.

All tenant operations run through `withWorkspaceTransaction`. It sets a transaction-local workspace
scope before constructing a repository; callers cannot supply workspace identity to individual
queries. SQL predicates and forced PostgreSQL row-level security both enforce the boundary.

Run migrations with `pnpm --filter @verus/persistence migrate`. See the
[database runbook](../../docs/operations/database.md) before deploying or rolling back a schema.
