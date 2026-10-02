# Evidence freshness and corrections

Verus retains every observed claim version. A correction points to the record it replaces; the prior
record becomes `superseded` and remains available for replay and audit.

Decision builders must call `evaluateEvidenceTimeline` with an explicit ISO-8601 `asOf` time and may
use only records returned as `current`. `stale`, `future`, `invalid`, and `superseded` records must
not be injected into trading-agent context. Conflicting current values are emitted as a
contradiction pair and require review; Verus never averages them.

Freshness windows are versioned policy. Invalid time input and invalid policy values fail closed as
`invalid`, with a low-cardinality telemetry event. Roll back a policy by deploying the prior policy
version; immutable observations require no data migration.
