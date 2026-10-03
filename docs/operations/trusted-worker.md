# Trusted scan worker

The trusted worker turns durable `scan.process` jobs into signed Context Capsules. Run one worker
deployment for one workspace and active policy; it never accepts a workspace ID from a job as a
configuration override.

Set these variables before starting it:

- `VERUS_DATABASE_URL`
- `VERUS_WORKER_WORKSPACE_ID`
- `VERUS_WORKER_POLICY_ID`
- `VERUS_WORKER_RULESET_JSON` — a valid version `1.0` detector ruleset
- `VERUS_WORKER_SECRETS_DIRECTORY` — an absolute, private directory containing sealed signing keys
- `VERUS_WORKER_SEALING_MASTER_KEY` — an unpadded base64url 32-byte sealing secret
- `VERUS_WORKER_ID` — a stable, deployment-unique worker identifier

Build the workspace, apply migrations, and start the executable with:

```sh
corepack pnpm build
corepack pnpm --filter @verus/persistence migrate
corepack pnpm --filter @verus/worker start
```

The process checks PostgreSQL readiness before claiming work, claims at most one compatible job per
poll, and releases its database pool and key material after `SIGINT` or `SIGTERM`. It retries a
temporarily unavailable queue with bounded idle polling; durable-job attempt and deadline rules
remain the source of truth for job retries.
