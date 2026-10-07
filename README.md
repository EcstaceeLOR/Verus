# Verus

**The context firewall for trading agents.**

Verus converts untrusted financial content into verified, structured, and auditable context before
that content reaches an AI trading or research agent.

Financial agents routinely ingest news, filings, issuer announcements, social posts, webpages, and
uploaded documents. Those inputs can contain prompt injection, hidden instructions, impersonated
sources, stale claims, malformed content, or contradictory data. A conventional order-risk check
happens after the model has already reasoned over that material. Verus protects the earlier
boundary: what the model is allowed to see and trust.

> **Status:** Verus is a security control in active pre-release qualification. Do not use it for
> live trading or as the sole security decision-maker until your deployment has completed its
> documented staging, recovery, security-review, and release gates.


## Hackathon judge path

The fastest way to understand Verus is the hosted **Agent demo**. It shows the same financial
context taking two paths: an unprotected agent receives raw retrieved text, while the Verus-protected
path runs the live hosted detector before anything crosses into inference.

The judge flow then exposes the product layers that sit behind that decision:

1. **Agent Playground** — protected versus unprotected context exposure using the real hosted scan
   endpoint.
2. **Bitget portfolio impact** — a credential-free sample showing how a verified AAPL event maps to
   an owned Reality/rToken instrument while the production integration remains strictly read-only.
3. **Attack Lab** — live hosted attacks are separated from threat classes that require the full
   canonicalization and evidence pipeline.
4. **Context Capsule inspector** — the live hosted result is explicitly unsigned; a separate v1
   contract fixture demonstrates the richer signed capsule format without pretending the public
   demo produced a live signature.
5. **Reproducible benchmark proof** — the frozen v1 deterministic corpus currently contains three
   attack samples and one benign control. The checked-in evaluation report records 3/3 attack
   detections, 0/1 benign false positives, and 100% recall for each category represented in the
   frozen partition.

Those benchmark numbers are deliberately small-sample regression evidence, not a claim of universal
prompt-injection resistance. Reproduce the corpus gate with:

```sh
corepack pnpm verify
```

See [the frozen evaluation report](corpus/v1/evaluation-report.v1.md),
[the samples](corpus/v1/samples.v1.json), and
[the release thresholds](corpus/v1/release-thresholds.v1.json) for the exact denominators,
methodology, and limitations.

## Quick start

The repository pins Node.js 24.19.0 and pnpm 12.8.1. From a clean checkout:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm dev
```

The console opens at `http://127.0.0.1:3000` and the API at `http://127.0.0.1:3001`. See the
[local development guide](docs/development/local-development.md) for Docker dependencies, supported
commands, ports, and safe cleanup.

## What Verus does

Verus accepts a URL, document, text payload, or feed event and processes it as untrusted data. It
then:

1. quarantines and safely retrieves the content;
2. canonicalizes text and exposes hidden or deceptive representation;
3. detects direct and indirect prompt-injection patterns;
4. separates factual claims from instructions and executable intent;
5. verifies source identity, publication time, and evidence provenance;
6. checks important claims against trusted primary sources;
7. records conflicts, freshness, and confidence without hiding uncertainty;
8. emits a signed **Context Capsule** for downstream agents; and
9. preserves a tamper-evident audit trail for operators and reviewers.

Verus is designed to sit in front of research agents, trading copilots, RAG pipelines, MCP clients,
and other systems that use external financial content.

## Why a context firewall

An execution firewall can reject an oversized or prohibited order, but it cannot repair reasoning
that was manipulated upstream. Verus treats retrieved content as hostile until it has crossed an
explicit trust boundary.

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

The downstream agent receives constrained facts, citations, security findings, and a disposition. In
strict mode, it does not receive the original raw content.

## Context Capsules

A Context Capsule is the versioned output contract between Verus and a downstream agent. The
published [v1 wire contract](contracts/v1/README.md) defines its exact JSON Schema, TypeScript
types, deterministic serialization, signature input, compatibility rules, and conformance fixtures.
A simplified shape is:

```json
{
  "schema_version": "1.0",
  "capsule_id": "cap_01...",
  "input_digest": "sha256:...",
  "subject": {
    "kind": "equity",
    "symbols": ["NVDA"]
  },
  "claims": [
    {
      "claim_id": "claim_01...",
      "statement": "The issuer updated its quarterly revenue guidance.",
      "verification": "verified",
      "confidence_bps": 9800,
      "citations": []
    }
  ],
  "findings": [
    {
      "category": "indirect_prompt_injection",
      "severity": "high",
      "reason_code": "INDIRECT_INSTRUCTION_DETECTED",
      "location": {
        "representation": "canonical",
        "text_start": 942,
        "text_end": 1017
      }
    }
  ],
  "conflicts": [],
  "disposition": "review",
  "policy": {
    "policy_id": "policy_01...",
    "version": "1.0.0",
    "digest": "sha256:..."
  },
  "signature": {
    "algorithm": "Ed25519",
    "key_id": "key_01...",
    "signed_at": "2026-09-30T20:05:04Z",
    "value": "..."
  }
}
```

Capsule signatures prove integrity and provenance within the Verus system. They do not, by
themselves, prove that a real-world claim is true.

## Security model

Verus is being built around the following principles:

- **Fail closed.** Retrieval, parsing, verification, and policy failures cannot silently become
  trusted context.
- **Data is not instruction.** Untrusted content is never allowed to redefine system policy or
  authorize tool use.
- **Deterministic controls first.** Models may assist classification and extraction, but
  deterministic policy decides what crosses the boundary.
- **Evidence over confidence.** Every accepted material claim must remain tied to a retrievable,
  timestamped source.
- **Least privilege.** Connectors and downstream integrations receive only the permissions required
  for their task. Trading-account access is read-only by default.
- **Reproducible decisions.** A verdict records the input digest, policy version, detector versions,
  evidence, and resulting disposition.
- **Explicit uncertainty.** Conflicting, stale, incomplete, or unverifiable evidence is surfaced
  rather than averaged into false certainty.
- **No security theatre.** Verus will publish its threat model, benchmark corpus, limitations, and
  residual risks.

The normative [threat model](docs/security/threat-model.md) and
[policy and decision semantics](docs/security/policy-semantics.md) define these guarantees,
precedence rules, failure behavior, and residual risks. The
[source, evidence, and data-classification rules](docs/security/source-evidence-data-classification.md)
keep identity assurance separate from claim verification and govern sensitive data throughout its
lifecycle.

Verus is one layer in a defense-in-depth architecture. It does not replace exchange permissions,
human approval, position limits, or an outbound execution firewall.

The security objectives, trust boundaries, abuse cases, control mappings, and residual risks are
maintained in the [Verus Threat Model](docs/security/threat-model.md). The approved
[production architecture](docs/architecture/README.md) defines runtime isolation, dependency
direction, storage, execution, and supported deployment topologies.

## Product surfaces

The implemented product surfaces are documented at [docs/README.md](docs/README.md):

- a versioned REST API and signed Context Capsule contract;
- an MCP server, TypeScript SDK, and JSON-only CLI;
- a low-information web console for scans and review;
- vetted evidence connectors, read-only Bitget portfolio context, and webhooks; and
- reproducible policy, corpus, release, recovery, and operational controls.

These interfaces share the same policy engine and versioned contracts so a scan has equivalent
semantics across local, hosted, and agent integrations.

## Initial scope

Version 1 focuses on financial research content used by agents:

- SEC filings and exhibits;
- issuer investor-relations releases;
- exchange and product announcements;
- financial news webpages and feeds;
- user-supplied text and documents; and
- structured events consumed by trading research workflows.

The first release will classify content as `allow`, `review`, or `block`. It will not place trades,
hold funds, manage exchange credentials with withdrawal permission, or claim to determine investment
truth.

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

Start with the pinned [v1.0 production roadmap](https://github.com/EcstaceeLOR/Verus/issues/1), then
use the [open milestones](https://github.com/EcstaceeLOR/Verus/milestones) for acceptance criteria,
native dependencies, and current progress.

The authoritative v1 scope, supported workflows, measurable requirements, and release gates are
defined in the
[Verus v1 Product Requirements and Release Contract](docs/product/requirements-v1.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Start with the relevant issue and
confirm its dependencies are complete. Security-sensitive changes require tests, documented failure
behavior, and an update to the threat model when a trust boundary changes. Report vulnerabilities
only through the private route in [SECURITY.md](SECURITY.md).

## Responsible use

Verus is security infrastructure, not financial advice. A clean scan is not a guarantee that content
is accurate, safe, complete, or suitable for a trading decision. Operators remain responsible for
model permissions, account controls, human review, and compliance with applicable laws and platform
terms.

## License

Verus is licensed under the [Apache License 2.0](LICENSE).
