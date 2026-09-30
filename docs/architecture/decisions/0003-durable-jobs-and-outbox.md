# ADR-0003: Durable jobs and transactional outbox

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Retrieval, parsing, model calls, evidence collection, signing, and delivery can
outlive an HTTP request and fail independently. Work must survive process loss,
scale horizontally, avoid duplicate effects, and remain practical to self-host.

## Decision

Use a PostgreSQL-backed durable job abstraction with transactional outbox,
leases, heartbeats, scheduled availability, bounded exponential retries,
cancellation, and dead-letter state. Delivery is at least once. Handlers must be
idempotent and use compare-and-set state transitions and effect-specific keys.

Job envelopes contain identifiers, versions, deadlines, and object references,
not large content or secrets. Queue names separate trust and resource classes.
Workers claim only supported versions and never silently discard an unknown
envelope.

## Alternatives considered

- **Redis queue:** strong ecosystem and latency, but adds a required durable
  system and complicates atomic state-to-job publication.
- **Managed cloud queue:** excellent operations, but provider semantics and
  local emulation weaken self-hosted parity.
- **Workflow orchestration platform:** powerful durable execution, but adds
  material operational weight and a second programming model for v1.
- **In-process tasks:** easy locally, but lose work on restart and cannot scale
  safely.

## Consequences

Verus has fewer mandatory infrastructure components and atomic job publication.
PostgreSQL receives queue load and needs fair polling, indexes, retention, and
capacity limits. The abstraction permits a future queue backend if measurements
justify it without changing domain handlers.

## Evolution and rollback

Envelope schemas are versioned. Deploy readers before writers and drain or
retain older workers through the compatibility window. Rollback stops new
claims, returns leases after timeout, and resumes with the prior compatible
worker. Dead-letter replay always creates an audited attempt.
