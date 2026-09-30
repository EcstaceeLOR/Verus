# Verus

**The context firewall for trading agents.**

Verus converts untrusted financial content into verified, structured, and
auditable context before that content reaches an AI trading or research agent.

Financial agents routinely ingest news, filings, issuer announcements, social
posts, webpages, and uploaded documents. Those inputs can contain prompt
injection, hidden instructions, impersonated sources, stale claims, malformed
content, or contradictory data. A conventional order-risk check happens after
the model has already reasoned over that material. Verus protects the earlier
boundary: what the model is allowed to see and trust.

> **Status:** Verus is in active pre-release development. The public interfaces
> and security contracts are being specified before implementation. It is not
> yet suitable for live trading or production security decisions.

## What Verus does

Verus accepts a URL, document, text payload, or feed event and processes it as
untrusted data. It then:

1. quarantines and safely retrieves the content;
2. canonicalizes text and exposes hidden or deceptive representation;
3. detects direct and indirect prompt-injection patterns;
4. separates factual claims from instructions and executable intent;
5. verifies source identity, publication time, and evidence provenance;
6. checks important claims against trusted primary sources;
7. records conflicts, freshness, and confidence without hiding uncertainty;
8. emits a signed **Context Capsule** for downstream agents; and
9. preserves a tamper-evident audit trail for operators and reviewers.

Verus is designed to sit in front of research agents, trading copilots, RAG
pipelines, MCP clients, and other systems that use external financial content.

## Why a context firewall

An execution firewall can reject an oversized or prohibited order, but it
cannot repair reasoning that was manipulated upstream. Verus treats retrieved
content as hostile until it has crossed an explicit trust boundary.

```text
 News · filings · webpages · feeds · uploaded documents
                         │
                         ▼
              Untrusted ingestion boundary
                         │
         ┌───────────────┴────────────────┐
         │ quarantine · normalize · scan │
         └───────────────┬────────────────┘
                         │
          source verification · claim checks
                         │
                         ▼
                Signed Context Capsule
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       Research/trading agent   Human review console
```

The downstream agent receives constrained facts, citations, security findings,
and a disposition. In strict mode, it does not receive the original raw content.

## Context Capsules

A Context Capsule is the versioned output contract between Verus and a
downstream agent. The exact v1 schema will be published and versioned in this
repository. A representative shape is:

```json
{
  "schema_version": "1.0",
  "capsule_id": "cap_01...",
  "input_digest": "sha256:...",
  "subject": {
    "kind": "equity",
    "symbols": ["NVDA"]
  },
  "facts": [
    {
      "claim": "The issuer updated its quarterly revenue guidance.",
      "source_id": "src_01...",
      "published_at": "2026-09-30T20:05:00Z",
      "confidence": 0.98
    }
  ],
  "findings": [
    {
      "category": "indirect_prompt_injection",
      "severity": "high",
      "location": "document.body[17]"
    }
  ],
  "conflicts": [],
  "disposition": "review",
  "policy_version": "policy_01...",
  "signature": "ed25519:..."
}
```

Capsule signatures prove integrity and provenance within the Verus system. They
do not, by themselves, prove that a real-world claim is true.

## Security model

Verus is being built around the following principles:

- **Fail closed.** Retrieval, parsing, verification, and policy failures cannot
  silently become trusted context.
- **Data is not instruction.** Untrusted content is never allowed to redefine
  system policy or authorize tool use.
- **Deterministic controls first.** Models may assist classification and
  extraction, but deterministic policy decides what crosses the boundary.
- **Evidence over confidence.** Every accepted material claim must remain tied
  to a retrievable, timestamped source.
- **Least privilege.** Connectors and downstream integrations receive only the
  permissions required for their task. Trading-account access is read-only by
  default.
- **Reproducible decisions.** A verdict records the input digest, policy
  version, detector versions, evidence, and resulting disposition.
- **Explicit uncertainty.** Conflicting, stale, incomplete, or unverifiable
  evidence is surfaced rather than averaged into false certainty.
- **No security theatre.** Verus will publish its threat model, benchmark
  corpus, limitations, and residual risks.

Verus is one layer in a defense-in-depth architecture. It does not replace
exchange permissions, human approval, position limits, or an outbound execution
firewall.

## Product surfaces

The production release is planned to provide:

- a scanning and Context Capsule REST API;
- an MCP server for agent-native integration;
- a CLI for local scanning, verification, and automation;
- a TypeScript SDK;
- a web console for scans, evidence, policies, and audit records;
- connectors for authoritative financial sources;
- read-only portfolio impact mapping;
- webhook delivery for verdicts and source-health events; and
- a public red-team benchmark and reproducible evaluation harness.

These interfaces will share the same policy engine and versioned contracts so a
scan has equivalent semantics across local, hosted, and agent integrations.

## Initial scope

Version 1 focuses on financial research content used by agents:

- SEC filings and exhibits;
- issuer investor-relations releases;
- exchange and product announcements;
- financial news webpages and feeds;
- user-supplied text and documents; and
- structured events consumed by trading research workflows.

The first release will classify content as `allow`, `review`, or `block`. It
will not place trades, hold funds, manage exchange credentials with withdrawal
permission, or claim to determine investment truth.

## Production definition of done

Verus v1.0 will not be declared generally available until it has:

- versioned public schemas and migration rules;
- reproducible builds and automated release artifacts;
- unit, integration, end-to-end, adversarial, and failure-path coverage;
- measurable benchmark results, including false-positive reporting;
- authentication, authorization, rate limiting, and tenant isolation;
- durable jobs with idempotency, retries, and dead-letter handling;
- signed capsules and independent signature verification;
- documented retention, export, and deletion controls;
- observable service-level indicators and actionable alerts;
- backup and recovery procedures tested in staging;
- a published threat model and vulnerability-reporting process;
- operator, user, API, SDK, CLI, and MCP documentation; and
- a release-candidate security review with every blocking finding resolved.

## Roadmap and backlog

Development is organized as a dependency-ordered production backlog:

1. product and security contracts;
2. platform foundation;
3. secure ingestion;
4. detection and policy engine;
5. evidence intelligence and signed Context Capsules;
6. agent, model, and Bitget integrations;
7. operator console and review workflows;
8. production security and operations; and
9. v1.0 release qualification and General Availability.

Start with the pinned [v1.0 production roadmap](https://github.com/EcstaceeLOR/Verus/issues/1),
then use the [open milestones](https://github.com/EcstaceeLOR/Verus/milestones)
for acceptance criteria, native dependencies, and current progress.

## Contributing

Verus is at the contract-first stage. Before opening a large implementation
pull request, start with the relevant issue and confirm its dependencies are
complete. Security-sensitive changes must include tests, documented failure
behavior, and an update to the threat model when the trust boundary changes.

Contribution guidelines, local setup instructions, architectural decisions,
and a security policy will be added during the foundation milestone.

## Responsible use

Verus is security infrastructure, not financial advice. A clean scan is not a
guarantee that content is accurate, safe, complete, or suitable for a trading
decision. Operators remain responsible for model permissions, account controls,
human review, and compliance with applicable laws and platform terms.
