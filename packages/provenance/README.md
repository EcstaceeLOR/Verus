# Provenance snapshots

`@verus/provenance` stores untrusted content as private, immutable, content-addressed objects. A
snapshot records the raw content digest, metadata digest, parent digests, retrieval facts, and exact
component versions. It never returns a local storage path.

Call `replaySnapshot` for deterministic reprocessing. It verifies content and descriptor metadata
before passing captured bytes to the supplied processor; the processor has no retrieval capability.
Retention uses `deleteContent`, which removes raw bytes while retaining a digest-addressed metadata
record for permitted audit evidence.
