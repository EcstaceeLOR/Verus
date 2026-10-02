# Backup, restore, and incident recovery

Verus targets a 30-minute RPO and 20-minute RTO for the hosted control plane. Backups use provider
envelope encryption and include a database digest plus an object-store manifest digest. A restore is
not complete until the artifact digest, audit chain, and Context Capsule signature verification
pass.

Run a staging restore drill at least quarterly: restore a real encrypted artifact to an isolated
environment, replay retention tombstones before traffic, verify audit/signature integrity, and
record the RPO/RTO result with corrective actions for any failure.

For an incident, the incident commander owns severity and communication; the security lead contains
credentials and preserves evidence; the operations lead restores service; and the scribe records
timeline and corrective actions. Stop unsafe delivery, preserve immutable audit records, rotate
affected credentials, and communicate only sanitized facts. Do not place source content, secrets, or
tenant identifiers in incident channels.
