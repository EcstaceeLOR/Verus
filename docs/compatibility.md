# Compatibility and support window

| Surface                    | Supported contract         | Compatibility promise                                                                                                   |
| -------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Context Capsule            | `1.0`                      | Consumers reject unknown versions; compatible readers retain the previous supported version during the declared window. |
| Ingestion envelope         | `1.0`                      | Unknown fields and incompatible versions fail validation.                                                               |
| REST API                   | `/v1`                      | Additive fields may be added; breaking changes require a new versioned route.                                           |
| TypeScript SDK and CLI     | Repository release version | SDK follows the REST and capsule compatibility rules and never silently downgrades verification.                        |
| MCP                        | Declared tool schema       | Tools expose only safe derived records; incompatible schema changes require a new tool/version.                         |
| Database and job envelopes | Expand/migrate/contract    | Deploy compatible readers before writers; retain older readers through rollback and queue-drain windows.                |

Before any upgrade, verify the signed release evidence, take a backup, run the reviewed expand
migration with the separate migration identity, deploy immutable image digests to staging, and run
health checks. Roll back application images to `previousRevision`; do not run destructive down
migrations in production. See [staged deployments](../deploy/README.md),
[database operations](operations/database.md), and [recovery](operations/recovery.md).
