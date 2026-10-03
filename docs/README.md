# Verus documentation

Verus is a context firewall: it turns hostile financial inputs into a signed Context Capsule before
they reach a trading or research agent. A capsule is a security and provenance record, not a trade
approval or a claim of investment truth.

## Choose your path

| I need to...                                | Start here                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Run Verus locally                           | [Local development](development/local-development.md)                                                      |
| Recreate staging or promote a release       | [Staged deployments](../deploy/README.md)                                                                  |
| Integrate an agent                          | [OpenAPI contract](api/openapi.v1.yaml), [SDK](../packages/sdk/README.md), or [MCP](../apps/mcp/README.md) |
| Understand scans and capsules               | [Context Capsules](operations/context-capsules.md) and [v1 contracts](../contracts/v1/README.md)           |
| Operate jobs, alerts, recovery, or capacity | [Operations guides](#operations)                                                                           |
| Configure policy and security controls      | [Policy semantics](security/policy-semantics.md) and [Threat model](security/threat-model.md)              |
| Connect a read-only Bitget portfolio        | [Bitget portfolio impact](operations/bitget-portfolio.md)                                                  |
| Report a problem or vulnerability           | [Support and security intake](operations/support.md)                                                       |

## Integration contract

Use only the versioned API, MCP, CLI, or SDK contracts. Consumers must validate the supported schema
version, Context Capsule signature and key state, workspace/audience binding, disposition,
freshness, and replay context before use. In strict mode, source bytes do not cross the integration
boundary. A consumer must treat `review`, `block`, missing evidence, invalid signatures, and
unavailable dependencies as non-actionable.

The REST surface is specified in [OpenAPI v1](api/openapi.v1.yaml). The TypeScript SDK and `verus`
CLI read `VERUS_API_URL`, `VERUS_API_KEY`, and `VERUS_WORKSPACE_ID`; keep those values in a secret
manager, not shell history or source control. The MCP server deliberately offers a small,
read-oriented agent surface and must not be given trading authority.

## Hosted and self-hosted responsibilities

Hosted operators maintain service isolation, release promotion, backups, and the shared security
baseline. Self-hosted operators additionally maintain identity configuration, network policy,
secrets, patch timing, and recovery. Both must supply an external secret manager, TLS termination,
private state services, no-egress parser isolation, and read-only Bitget credentials. The full
responsibility split is in the
[threat model](security/threat-model.md#10-hosted-and-self-hosted-responsibility-model).

## Operations

- [Ingestion](operations/ingestion.md), [upload quarantine](operations/upload-quarantine.md), and
  [retrieval quarantine](operations/retrieval-quarantine.md)
- [Durable jobs](operations/durable-jobs.md),
  [trusted worker](operations/trusted-worker.md),
  [capacity and resilience](operations/capacity-and-resilience.md), and
  [observability](operations/observability.md)
- [Database operations](operations/database.md), [recovery](operations/recovery.md), and
  [immutable provenance replay](operations/provenance-replay.md)
- [Model providers](operations/model-providers.md), [webhooks](operations/webhooks.md), and
  [tenant controls](operations/tenant-controls.md)

## Limits and responsible use

Verus does not execute trades, custody funds, determine financial truth, guarantee safety, or
replace exchange permissions, human approval, position limits, compliance review, or an execution
firewall. It supports only the documented input formats, evidence connectors, and contract versions.
Unsupported, stale, encrypted, malformed, unavailable, or conflicting inputs fail closed or require
review. See the [product limitations](product/requirements-v1.md#non-goals-and-explicit-limitations)
and
[security residual risks](security/threat-model.md#8-threats-controls-residual-risk-and-evidence).
