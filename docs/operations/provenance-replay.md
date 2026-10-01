# Immutable provenance and replay

Capture every retrieved or accepted content body with `FileSystemSnapshotStore` before parsing.
Store the returned content and metadata digests, parent digests, component versions, retrieval
facts, and retention deadline in `content_snapshots`. A snapshot object reference is opaque and is
never an application-origin URL.

Use `replaySnapshot` for investigation and regression reproduction. It verifies the content bytes
and canonical descriptor metadata first, then passes only captured bytes and recorded component
versions to the replay processor. Replay must not make a network request or use mutable source data.

At retention expiry, remove the content object first and mark `content_deleted_at` in the same
workspace transaction. Preserve the snapshot ID, digests, component versions, timestamps, and
permitted retrieval audit facts; do not preserve raw content or sensitive metadata beyond its
policy. Any digest mismatch is an integrity incident: block replay, preserve the audit record, and
investigate storage access.
