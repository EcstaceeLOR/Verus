# Observability

Safe structured logs, metrics, trace context, correlation propagation, and error reporting for
Verus. Raw content, secrets, object references, tenant identifiers, job identifiers, and portfolio
values are prohibited fields and labels.

The logger constructs events from a closed field set and converts errors to stable public codes. The
metric registry exposes only fixed definitions, exact labels, bounded label syntax, and a per-metric
series cap. `AsyncLocalStorage` carries request context within a process; propagation headers and
durable job envelopes carry it between services.

See the [observability runbook](../../docs/operations/observability.md) for conventions, SLOs,
alerts, and incident handling.
