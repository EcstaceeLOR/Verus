# Verus production architecture

- **Status:** Approved for v1 implementation
- **Decision records:** [`decisions/`](decisions/)
- **Threats addressed:** THR-ING-003, THR-NET-001, THR-MOD-001,
  THR-TEN-001, THR-SUP-001

Verus is a modular service with isolated workers for hostile work. The control
plane owns identity, policy, jobs, and audit. Data-plane workers retrieve,
parse, classify, and verify content through narrow, versioned envelopes.

## 1. Design goals

- Keep untrusted bytes outside the API, console, and policy process.
- Make deterministic policy and offline capsule verification independent of
  models and external services.
- Scale retrieval, parsing, detection, evidence, and delivery workers
  horizontally with at-least-once execution and idempotent effects.
- Preserve one behavior across local, hosted, and self-hosted installations.
- Minimize required infrastructure while retaining durable state and recovery.
- Keep the default console focused on one primary action and progressive
  disclosure of technical detail.

## 2. Logical topology

```text
Browser / SDK / CLI / MCP client
                |
                v
       API and control plane ---------------- Console static assets
         |       |      |
         |       |      +---- PostgreSQL: tenant state, jobs, audit
         |       +----------- S3-compatible object store: immutable bytes
         +------------------- signing provider: KMS or local sealed key
                |
        durable job envelopes
                |
     +----------+-----------+----------------+
     |                      |                |
     v                      v                v
Network-quarantined   Parser sandbox   Model gateway
retriever             no network       provider allowlist
     |                      |                |
     +----------+-----------+----------------+
                |
                v
     deterministic detection, evidence, and policy workers
                |
                v
       signed capsule and audited delivery
```

The diagram shows logical responsibilities, not a requirement for one process
per box. Local development may co-locate trusted components. Retrieval, parsing,
and model execution always retain separate credentials and capability policies.

## 3. Runtime boundaries

### API and control plane

The API authenticates callers, checks workspace authorization, validates public
contracts, creates idempotent scan records, and returns status. It never fetches
remote URLs, opens uploaded documents, executes models, or interprets hostile
HTML. It has no outbound internet permission except approved identity and
operational dependencies.

### Durable coordinator

PostgreSQL is the source of truth for job state. Transactional outbox records
connect state changes to worker leases. Jobs are at least once, carry tenant and
input identifiers rather than large payloads, use bounded retries, and enter a
dead-letter state after exhaustion. Every effect has an idempotency key.

### Retriever

The retriever is the only component allowed general outbound HTTP. Egress policy
blocks private, link-local, metadata, loopback, and disallowed address ranges
before and after DNS resolution and on every redirect. It receives no tenant
database credentials, signing keys, model keys, or exchange credentials. Output
is an immutable object plus a digest and provenance envelope.

### Parser sandbox

The parser reads quarantined objects through expiring object capabilities. It
has no network, signing key, control-plane credential, or shared writable
filesystem. CPU, memory, time, process, output, and archive-expansion limits are
mandatory. A crash or incomplete parse cannot produce allowed context.

### Model gateway

The model gateway receives minimized, labeled data and a versioned constrained
request. It has only provider-specific network access and provider credentials.
It cannot call tools, fetch URLs, query tenant data, write policy, sign capsules,
or set a disposition. Invalid or unavailable output becomes an explicit control
result for deterministic policy.

### Detection, evidence, and policy workers

These trusted workers consume normalized content and immutable references. The
policy evaluator is pure and has no network access. Evidence connectors use
connector-specific outbound allowlists and credentials. Only the capsule
builder can request a signing operation, and signing policy binds the workspace,
artifact digest, key ID, and allowed purpose.

### Console

The console consumes the same REST API as external clients. It never renders
hostile input as active HTML and receives no infrastructure credentials. Its
default result view contains disposition, short reason, subject, freshness,
and next action; evidence and diagnostics require deliberate expansion.

## 4. Repository layout

```text
apps/
  api/                 authenticated REST control plane
  console/             accessible React operator console
  mcp/                 narrow MCP server
  worker/              trusted job coordinator and worker entry points
services/
  retriever/           network-quarantined fetch service
  parser/              resource-isolated document parser
  model-gateway/       constrained provider adapter service
packages/
  contracts/           generated and authored public wire contracts
  domain/              entities, value objects, errors, and ports
  policy/              pure deterministic evaluator
  evidence/            claim and evidence domain logic
  crypto/              canonicalization, signing, and verification ports
  persistence/         PostgreSQL adapters and migrations
  jobs/                job envelopes, leases, retry, and outbox adapters
  observability/       safe logging, metrics, tracing, and audit helpers
  sdk/                 public TypeScript client
  testkit/             deterministic fixtures and integration harnesses
deploy/
  compose/             local and single-node self-hosted topology
  helm/                hosted and clustered self-hosted deployment
  terraform/           hosted infrastructure modules
docs/                  product, security, architecture, API, and operations
```

Issue #9 creates this layout. Empty placeholder packages are not required;
packages appear with their first tested capability.

## 5. Dependency direction

Dependencies point inward toward contracts and domain rules:

```text
contracts
   ^
   |
domain <---- policy / evidence / crypto
   ^                    ^
   |                    |
persistence / jobs / observability / SDK
   ^
   |
apps and isolated service adapters
```

Rules:

- Applications and services may compose packages; packages never import apps
  or services.
- `domain` depends only on `contracts` and standard-library abstractions.
- `policy` is pure and cannot depend on persistence, queues, network, models,
  application code, or framework request types.
- Isolated services communicate through versioned envelopes and object
  capabilities; they do not import control-plane persistence adapters.
- No application imports another application and no service imports another
  service.
- Runtime composition supplies implementations to domain ports. A domain
  package never looks up global infrastructure.

`dependency-rules.json` is the machine-readable allowlist. The architecture
test rejects cycles, undeclared nodes, layer inversions, and forbidden
capabilities before implementation packages exist.

## 6. Data and transaction boundaries

PostgreSQL owns mutable tenant, policy, job, review, key-metadata, and audit
state. S3-compatible storage owns immutable input, snapshot, parse, evidence,
and export objects. Database rows reference object version and SHA-256 digest.

A transaction can atomically change database state and append an outbox record.
It cannot atomically commit object storage or an external API call. Those flows
use staged object writes, digest verification, idempotency keys, and a database
state transition. Reconciliation detects abandoned stages and missing objects.

Tenant ID is part of every tenant-owned primary key, job envelope, object key,
cache key, audit event, and authorization check. Services receive scoped object
capabilities rather than bucket-wide credentials where the platform supports
them.

## 7. Execution model

Synchronous work is limited to authentication, authorization, schema validation,
idempotent resource creation, small reads, and offline signature verification.
Network retrieval, uploads, parsing, OCR, detection, model calls, evidence
collection, signing, exports, and webhook delivery are durable jobs.

Workers claim leases with bounded duration and heartbeat. A lost lease makes a
job eligible for retry; it does not imply the previous attempt made no external
effect. Idempotency and compare-and-set state transitions make duplicate work
safe. Horizontal scaling is partitioned by queue and optionally workspace, not
by in-process ownership.

## 8. Deployment topologies

### Local development

Docker Compose starts PostgreSQL, an S3-compatible object store, safe test
providers, the API, console, and workers. Hostnames and network policy mirror
production boundaries. Test providers do not weaken production code paths.

### Hosted

OCI images run as separate workloads on a container orchestrator. Managed
PostgreSQL and object storage use private networking, backups, and encryption.
Retriever, parser, model gateway, and trusted workloads have distinct service
accounts, network policies, resource limits, and autoscaling signals. Signing
uses a managed non-exportable key provider.

### Self-hosted

The supported single-node profile uses Docker Compose with PostgreSQL and an
S3-compatible store. The clustered profile uses the same OCI images and Helm
values with an external PostgreSQL and S3 API. A local sealed signing-key
provider replaces hosted KMS without changing capsule verification.

Self-hosted installations expose the same API, policy semantics, migrations,
health checks, backup format, and conformance tests. Optional managed services
cannot be required for correctness.

## 9. Failure, telemetry, and recovery

Every boundary has timeout, retry, cancellation, maximum payload, and stable
error semantics. Security-control uncertainty blocks; evidence uncertainty
reviews; optional enrichment failure remains visible without changing safety.

Services emit OpenTelemetry traces, RED metrics, job state and age, resource
limit failures, dependency health, and stable reason codes. Telemetry excludes
raw content, secrets, portfolio values, and unbounded tenant labels. Audit events
are durable domain records, not best-effort logs.

Schema and database migrations use expand, migrate, contract sequencing.
Deployments support a compatible previous application version during rollback.
Queue envelopes and objects remain readable through their declared support
window. A rollback never rewrites signed artifacts or weakens stored data
classification.

## 10. Architecture verification

Run from the repository root:

```sh
node docs/architecture/verify-dependencies.mjs
```

The test validates the planned graph today. Issue #9 will also scan workspace
manifests and TypeScript imports so declared and implemented dependencies stay
aligned.
