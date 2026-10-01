# Parser service

The parser converts untrusted HTML, RSS, Atom, and plain text into bounded, deterministic
representations. It does not fetch links, execute scripts, load active content, or make network
calls. A parser failure must never produce allowed context.

`parseUntrustedContent` returns separately addressable raw and normalized representations, visible
links with source offsets, first-wins metadata, and hidden or inactive regions for later policy
inspection. Inputs are capped at 5 MiB and normalized content at 1 million characters.

Use `createUntrustedContentParser` in production workers. It records structured success/failure
events and bounded parser-duration/failure metrics without logging document contents.
