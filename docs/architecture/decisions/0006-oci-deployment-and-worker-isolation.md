# ADR-0006: OCI deployment and worker isolation

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Verus must run as a hosted service and as a supported self-hosted product. It processes hostile
files, arbitrary URLs, and model inputs that require stronger boundaries than package conventions.

## Decision

Build reproducible, signed OCI images for the API, console, trusted worker, retriever, parser, and
model gateway. Hosted and clustered deployments use a container orchestrator with separate
identities, network policies, resource limits, read-only roots, non-root users, and
workload-specific autoscaling.

Support a Docker Compose single-node self-hosted profile using the same images and environment
schema. Local development adds deterministic test providers but keeps hostile workers on separate
networks and credentials.

The system is a modular service, not a microservice per package. A new runtime boundary requires a
distinct threat, scaling, resource, or availability reason.

## Alternatives considered

- **Single process:** easiest deployment, but cannot enforce parser, network, model, and signing
  capabilities.
- **Function-as-a-service only:** convenient scaling, but runtime limits and network controls vary
  and self-hosted parity is poor.
- **Virtual machine per scan:** strong isolation, but cost and startup latency are excessive as the
  default for all stages.
- **A service per domain package:** maximizes independent deployment but creates unnecessary network
  and operational complexity.

## Consequences

The same artifacts run across environments and hostile boundaries are enforced outside application
code. Operators must maintain container, network, resource, and image-signature policy. High-risk
parsers may add microVM or sandbox runtime isolation later behind the parser service contract.

## Evolution and rollback

Images are immutable and promoted by digest. Database and envelope compatibility permit rolling
deployment and one-version rollback. Network-policy or identity changes are staged and tested before
traffic. Rollback never combines hostile workers with the trusted control plane.
