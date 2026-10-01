# Domain

Framework-independent Verus error semantics and domain primitives.

The package owns stable error codes and converts internal failures to safe problem details. It does
not expose internal exception messages, causes, rejected input, or secrets. Public API and service
boundaries should pair it with `@verus/contracts`, which validates and freezes wire contracts before
they enter domain logic.

See [domain contract boundaries](../../docs/development/domain-contracts.md) for construction,
version-negotiation, error, and rollout rules.
