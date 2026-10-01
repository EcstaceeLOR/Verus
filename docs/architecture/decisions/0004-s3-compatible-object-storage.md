# ADR-0004: S3-compatible immutable object storage

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Raw downloads, uploads, normalized representations, evidence snapshots, and exports can be large,
hostile, and retention-sensitive. They need immutable addressing without bloating database backups.

## Decision

Use an S3-compatible object API for opaque immutable bytes. Each committed object has tenant scope,
data class, media type, byte length, SHA-256 digest, creation time, retention state, and provider
version ID in PostgreSQL.

Writes use a staging key, bounded streaming upload, digest verification, and a database commit
before promotion. Reads use scoped expiring capabilities where available. Hostile objects are never
served inline from the application origin. Lifecycle deletion is driven by Verus tombstones and
reconciled with provider rules.

## Alternatives considered

- **Database binary columns:** transactional, but expands backups and exposes hostile bytes to
  broadly privileged database paths.
- **Shared filesystem:** simple on one host, but weak for horizontal workers, durability, and
  clustered self-hosting.
- **Provider-specific blob API:** may offer richer controls, but prevents one portable storage
  contract.
- **Digest-only content addressing without metadata:** deduplicates, but risks cross-tenant
  existence disclosure and incorrect retention coupling.

## Consequences

The system gains scalable byte storage and narrow worker access. Database and object operations are
not one transaction, so staging and reconciliation are required. Deduplication is tenant-scoped
unless an explicit safe public-data policy says otherwise.

## Evolution and rollback

The object adapter supports dual-write and verified copy between providers. Readers accept both
locations during migration. Rollback retains the old copy until digest, retention, restore, and
access-policy checks pass.
