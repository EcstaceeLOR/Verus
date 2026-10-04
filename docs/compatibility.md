# Compatibility and support window

| Surface                    | Supported contract            | Compatibility promise                                                                                                   |
| -------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Context Capsule            | `1.0`                         | Consumers reject unknown versions; compatible readers retain the previous supported version during the declared window. |
| Ingestion envelope         | `1.0`                         | Unknown fields and incompatible versions fail validation.                                                               |
| REST API                   | `/v1`                         | Additive fields may be added; breaking changes require a new versioned route.                                           |
| TypeScript SDK and CLI     | Repository release version    | SDK follows the REST and capsule compatibility rules and never silently downgrades verification.                        |
| MCP                        | Declared tool schema          | Tools expose only safe derived records; incompatible schema changes require a new tool/version.                         |
| Database and job envelopes | Expand/migrate/contract       | Deploy compatible readers before writers; retain older readers through rollback and queue-drain windows.                |
| Webhooks                   | Envelope `1.0`, signature `1` | Additive body fields may appear; signature input and existing event meanings remain stable for the major version.       |

## Version and support policy

Verus uses semantic versioning for released packages and immutable release evidence. The REST major
version is carried in the route, artifact versions are carried in each artifact, and webhook
envelope and signature versions are explicit. MCP tool names are stable within a major release.

The current major and the immediately previous major receive security and correctness fixes. A major
version remains supported for at least 12 months after its successor becomes generally available. A
deprecation is announced in release notes and documentation at least 180 days before removal.
Critical security changes may shorten that period; the advisory must explain impact, mitigation, and
the exceptional sunset date.

Additive response fields, optional request fields, new error codes, new webhook event types, and new
MCP tools are compatible changes. Removing or renaming a field, making an optional field required,
changing an existing field or event meaning, narrowing accepted input, changing signature bytes, or
reusing an error code with different semantics is breaking and requires a new major version.
Consumers must ignore unknown response and webhook fields but reject unknown artifact versions.

SDK and CLI minor releases target every supported REST major. Their major version changes when a
supported public type or command contract breaks. Deprecations emit a machine-readable warning and
name the replacement and sunset release; credentials and source content are never included.

## Release gate

The shared conformance suite executes the same scan-status operation through the real REST handler,
the TypeScript SDK, the JSON CLI, and the official MCP client. Every surface must produce the same
checked-in semantic artifact, and the OpenAPI response schema must remain compatible with it. The
suite is part of the workspace `check` command, so mismatch blocks pull-request and release checks.
Contract fixtures are reviewed as public API: update them only with the version and deprecation
decision required by the rules above.

Before a release, run the full check and PostgreSQL integration workflow, confirm supported-version
matrices in release notes, and exercise webhook signing with both current and retiring keys. A
rollback must keep readers compatible with data and deliveries already written by the candidate.

Before any upgrade, verify the signed release evidence, take a backup, run the reviewed expand
migration with the separate migration identity, deploy immutable image digests to staging, and run
health checks. Roll back application images to `previousRevision`; do not run destructive down
migrations in production. See [staged deployments](../deploy/README.md),
[database operations](operations/database.md), and [recovery](operations/recovery.md).
