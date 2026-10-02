# Bitget portfolio impact

Verus uses only the read-only account-assets endpoint and locally supplied watchlists. The
integration has no order, transfer, withdrawal, or credential-escalation operation. A revoked
credential or unavailable endpoint produces no impact data; it never changes a security disposition.

Portfolio context is tenant-confidential and separate from public evidence. It is excluded from
model prompts unless an explicit permission grants that narrow use. Impact results show
relationship, mapping confidence, event `asOf`, and freshness. Revoke credentials at the provider,
remove the integration binding, and delete retained portfolio context according to workspace
retention policy.
