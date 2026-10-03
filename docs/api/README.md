# REST API v1

The durable Verus API is a tenant-scoped, asynchronous interface. Submit untrusted context, retain
the returned scan identifier, poll the derived status, and consume findings or a signed Context
Capsule. API responses never return quarantined source bytes or parsed hostile text by default.

The machine-readable contract is [OpenAPI 3.1](openapi.v1.yaml). The canonical request and capsule
schemas remain under [`contracts/v1`](../../contracts/v1/README.md); the OpenAPI document describes
HTTP authentication, status codes, and resource routing around those contracts.

## Authentication

Every public request needs both headers:

```text
Authorization: Bearer vrk.key_<key-id>.<secret>
X-Verus-Workspace-Id: ws_<workspace-id>
```

The workspace header must match the workspace bound to the API key. Submission requires the
`scan.create` scope. Scan reads require `scan.read`; findings, evidence, and capsules use their own
least-privilege read scopes. Revoked keys, suspended/deleting workspaces, invalid tenant bindings,
and missing scopes fail before any record is read or written.

## Submit and poll

Set the environment variables locally without committing their values, then submit the checked
example:

```sh
curl --fail-with-body --request POST "$VERUS_API_URL/v1/ingestions" \
  --header "Authorization: Bearer $VERUS_API_KEY" \
  --header "X-Verus-Workspace-Id: $VERUS_WORKSPACE_ID" \
  --header "Content-Type: application/json" \
  --data-binary @docs/api/examples/ingestion-text.json
```

A new request returns `202`, a `Location` header, and a queued scan identifier. An exact idempotency
replay returns `200` and the same identifier. Reusing the key for a different request returns `409`.

Poll without exposing the submitted text:

```sh
curl --fail-with-body "$VERUS_API_URL/v1/scans/$VERUS_SCAN_ID" \
  --header "Authorization: Bearer $VERUS_API_KEY" \
  --header "X-Verus-Workspace-Id: $VERUS_WORKSPACE_ID"
```

`429` responses include `Retry-After`; clients should honor it and preserve the same idempotency key
when retrying a submission. The TypeScript SDK applies bounded retries only to retryable failures.

## Internal ingestion identity

An operator may configure a separate internal ingestion token for a trusted service-to-service
caller. It is not a substitute for the public API key and is never exposed to browsers, CLI users,
MCP clients, or third-party integrations. Both paths ultimately invoke the same validated,
tenant-bound ingestion service.
