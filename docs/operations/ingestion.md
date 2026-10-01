# Ingestion boundary

`POST /v1/ingestions` accepts only version `1.0` ingestion contracts after a trusted internal tenant
resolver establishes the workspace. It does not trust a caller-provided workspace header.

Each accepted request is size-checked before parsing or persistence, assigned a scan ID, and stored
as an immutable, tenant-scoped envelope with request and input SHA-256 digests. Reusing an
idempotency key with the same canonical request returns the original scan; a different request is a
conflict. The API returns RFC 7807-style safe errors with a correlation ID and never reflects raw
content in telemetry or error responses.
