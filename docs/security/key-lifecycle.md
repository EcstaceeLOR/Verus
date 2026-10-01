# Key and secret lifecycle

Verus separates public lifecycle metadata from secret material. PostgreSQL stores key IDs, scopes,
one-way API-key verifiers, provider references, public signing keys, validity windows, status, and
audit records. Recoverable secrets and private signing keys exist only behind the `SecretProvider`
port.

## API keys

API keys contain 256 random bits and are revealed exactly once. Verus stores an HMAC-SHA-256
verifier made with a separately delivered pepper; it never stores the bearer value. Each key belongs
to one service account, has explicit scopes that must be a subset of that service role, and may have
an expiry. Verification uses constant-time comparison after the public key ID selects one record.

Rotate by issuing a new key before changing the old key to `retiring`. Both remain usable during the
configured overlap, allowing clients to update without downtime. Confirm new-key use, then revoke
the old key. Pepper rotation uses `verifier_version`: readers support the old and new pepper during
the migration window, while new credentials use only the new version.

## Recoverable secrets

Hosted production should implement `SecretProvider` with an approved managed secret service and
workload identity. Self-hosted Verus can use the AES-256-GCM sealed-file provider. Its 32-byte
master key must arrive through an external secret mount or process credential, never a repository,
image, database, log, or command-line argument. The provider authenticates the immutable provider
reference as associated data, writes mode-0600 ciphertext through an atomic link, and refuses
overwrite.

Write new provider material first under a new immutable reference, then commit its metadata. If the
metadata transaction fails, delete the unreferenced provider object. During rotation, keep the prior
version in `retiring` until all consumers confirm the new reference. Revocation stops use;
destruction deletes provider material and records the purge. A reconciler must alert on unreferenced
provider objects and metadata whose provider object is missing.

## Context Capsule signing keys

Signing keys use Ed25519. The signing provider accepts only the `context_capsule` purpose and
refuses to sign unless SHA-256 of the supplied canonical bytes matches the declared artifact digest.
This prevents a general signing oracle. Private PKCS#8 bytes remain in the secret provider;
discovery publishes only key ID, algorithm, SPKI public key, status, and validity window.

Create and validate the replacement key before activation. In one database transaction, move the old
key to `retiring`, stop new signatures at the replacement's `not_before`, activate the new key, and
link the versions. Public discovery continues returning old keys through `verify_until`, even after
private material is destroyed, so retained capsules remain verifiable. Revoked public keys stay
discoverable with revoked status so verifiers can apply incident policy rather than treating the key
as unknown.

## Audit, telemetry, and incidents

Issuance, rotation, revocation, destruction, scope changes, and signing-key activation append an
immutable audit event in the same transaction as metadata. Operational telemetry may contain only
operation, provider class, status, reason code, and bounded latency. It must never contain bearer
keys, verifiers, provider references, private/public key bytes, plaintext secrets, or tenant labels.

On suspected compromise, revoke the credential, rotate its pepper or provider material where
necessary, stop signing with the affected key, preserve public verification metadata, inspect usage
and audit records, and follow the incident-response process. Do not re-sign historical capsules.

## Rollback

Migration `0003_key_lifecycle` is additive and has a down path for empty installations and restore
drills. Production application rollback keeps the metadata tables and public keys intact. Never run
the down migration while retained capsules, active API keys, or provider objects depend on it.
