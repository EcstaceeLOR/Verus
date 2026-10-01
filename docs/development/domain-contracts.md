# Domain contract boundaries

Verus treats JSON Schema in `contracts/v1` as the runtime authority and the matching TypeScript
definitions as its compile-time interface. `@verus/contracts` exposes constructors for every public
contract; services must use them before data enters the domain layer.

## Construction rules

- Constructors accept `unknown`, reject undeclared fields and invalid states, and return a deeply
  frozen clone. Caller-owned input is never mutated or retained.
- Only exact, explicitly supported contract versions are accepted. Version `1.0` is the current
  version; wildcards and implicit downgrade are not supported.
- The caller orders offered versions by preference. Negotiation selects the first exact match or
  fails with `UNSUPPORTED_CONTRACT_VERSION`.
- The build copies the authoritative schemas into the contracts package. Workspace verification also
  prevents packaged TypeScript definitions from drifting from `contracts/v1/types.ts`.

## Error boundary

`@verus/domain` owns stable error codes and converts internal failures into safe problem details.
Responses contain a type URI, title, HTTP status, code, retryability, and an optional validated
correlation ID. Validation failures may include at most 20 structural issues.

Internal exception messages, causes, rejected values, secrets, and hostile source content must never
be placed in a public response. Unknown failures map to `INTERNAL_ERROR`; applications should log
their internal diagnostics through the observability layer using the correlation ID.

## Version changes and rollback

Additive changes still require a new documented schema version when they alter the accepted wire
shape. Introduce the new schema and parser alongside the old version, add round-trip fixtures, and
only then advertise support. Keep the previous parser during the compatibility window so rollout can
be reversed without accepting unvalidated data. Removing a version requires a separately approved
deprecation and migration plan.
