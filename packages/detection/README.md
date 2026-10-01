# Detection

`@verus/detection` provides a pure, deterministic first-pass detector. Rules are literal phrases,
not executable expressions. Every verdict records the canonical SHA-256 digest and version of the
active rule set, with precise source locations for review.

Rule reloads are atomic: invalid configuration is rejected and the last known-good rule set remains
active. Any scope-based exception is explicit and can be limited to specific tenant or source IDs;
content cannot create or change an exception.
