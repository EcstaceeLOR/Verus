# Context Capsules

Context Capsules are signed, portable decisions. Builders accept only policy-approved verified
claims and current, identity-verified evidence. The canonical unsigned payload is SHA-256 digested
and signed with Ed25519; every signed field is therefore protected.

Offline consumers verify against retained public keys. Key rotation activates a replacement key for
new capsules while retaining old public keys through their verification window. Capsule records are
immutable; a conflicting write for an existing ID fails closed.

Replay first verifies the stored signature, then processes the exact capsule. If an external model
used by the original decision is unavailable, replay returns `EXTERNAL_MODEL_UNAVAILABLE` rather
than claiming reproducibility. Capsule creation, verification, and reproducible replay append audit
events. Rollback selects an earlier active signing key or policy version for new capsules;
historical artifacts are never re-signed.
