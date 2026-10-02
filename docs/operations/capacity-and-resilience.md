# Capacity and resilience

Production admission is fail-closed. Do not accept a scan unless its durable queue reservation and
the workspace's concurrency, queue-depth, per-scan cost, and hourly cost budgets are available.
Return a bounded retry response; never discard an already accepted durable job to free capacity.

The initial production budget is eight active scans per worker pool, 100 ready jobs per tenant, 20
cost units per scan, and 500 cost units per tenant per hour. Operators may only raise these after
isolated staging qualification records p95 latency, ready-job age, accepted-job durability, parser
CPU/memory, provider failures, and total cost without source content in telemetry.

Run the qualification suite before a release:

```sh
corepack pnpm --filter @verus/observability test -- reliability.test.ts
```

The scenarios cover saturated concurrency/queue admission, cost exhaustion, and dependency circuit
transitions. For production qualification, repeat the scenarios against staging for one hour,
including parser crash, object-store loss, provider outage, worker restart, and sustained backlog.
Accepted jobs must remain durable; new work receives safe backpressure.

After three consecutive dependency failures, open its circuit. After the cooling period allow one
probe only; a failed probe reopens it and a successful probe closes it. During an open circuit mark
the dependent stage unavailable and preserve quarantine/audit data for later retry. Page on queue
age, dead-letter growth, and error-budget burn before raising limits.
