# ADR-0002: PostgreSQL as the system of record

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Verus needs transactional workspace state, policy versions, idempotency, review
concurrency, job coordination, audit records, retention tombstones, and reliable
recovery. Hosted and self-hosted installations need equivalent semantics.

## Decision

Use PostgreSQL as the authoritative store for mutable relational state and job
metadata. Every tenant-owned relation includes workspace identity. Application
authorization is mandatory; row-level security is an additional containment
layer, not the only authorization mechanism.

Use reviewed forward migrations, transaction-scoped repositories, optimistic
concurrency where humans edit state, and an append-only audit event model.
Cache entries and search indexes are derived and disposable. Large or hostile
bytes live in object storage and are referenced by immutable version and digest.

## Alternatives considered

- **Document database:** flexible ingestion shapes, but weaker relational and
  migration guarantees for policy, identity, audit, and review workflows.
- **Separate databases per capability:** independent scaling, but greater
  operational cost and distributed transaction risk before scale requires it.
- **SQLite as the production default:** excellent local simplicity, but does
  not meet horizontal worker, lease, and hosted availability requirements.
- **Cloud-vendor database API:** convenient hosted operation, but would break
  self-hosted parity and make deterministic recovery provider-specific.

## Consequences

Transactions, constraints, and one backup system simplify correctness. Heavy
job and audit workloads must be partitioned, indexed, archived, and observed to
avoid affecting request latency. Storage adapters prevent database details from
entering domain and policy packages.

## Evolution and rollback

Migrations follow expand, backfill, validate, contract. Each deployment states
the oldest compatible schema. Destructive contraction occurs only after the
rollback window. Point-in-time recovery and restore drills verify database and
object references together.
