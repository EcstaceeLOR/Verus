# Support and security intake

Use the following channels without including source content, credentials, API keys, session tokens,
portfolio values, or tenant identifiers in public reports.

| Need                           | Channel                                     | Include                                                                                                    |
| ------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Product or integration support | Repository issue using the support template | Product version, safe correlation ID, component, stable error code, and reproduction steps without content |
| Service incident               | On-call incident process                    | Safe correlation ID, affected component, start time, alert ID, and operator actions                        |
| Suspected vulnerability        | Private repository security advisory        | Impact, affected version, minimal safe reproduction, and safe contact method                               |
| Data-rights request            | Authorized workspace administrator          | Workspace-approved request through the retention/export process                                            |

## Triage and response

Support verifies the reporter's workspace authorization before accessing tenant-scoped audit
records. Start from a correlation ID and use authorized tooling; never ask a reporter to paste
hostile content or secrets. Security reports receive an acknowledgement, severity assessment,
remediation owner, and closure evidence through the private channel. Critical/high vulnerabilities
block production release until remediated or a time-bounded, documented compensating control is
approved.

For a service incident, preserve audit continuity, stop unsafe promotion, and follow the relevant
runbook: [observability](observability.md), [durable jobs](durable-jobs.md), or
[recovery](recovery.md). Do not retry destructive operations blindly and do not use a support export
as a substitute for a tenant-authorized data export.
