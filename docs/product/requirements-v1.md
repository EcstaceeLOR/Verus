<!-- markdownlint-disable MD013 -->

# Verus v1 Product Requirements and Release Contract

Status: Approved baseline  
Target release: Verus v1.0 General Availability  
Owners: Verus maintainers  
Applies to: Hosted and self-hosted Verus deployments

## 1. Purpose

This document is the authoritative product contract for Verus v1. It defines the users, supported
workflows, functional and non-functional requirements, service boundaries, measurable release gates,
and explicit non-goals for the first generally available release.

Verus v1 is complete only when every requirement marked `Required` has passing acceptance evidence
and the production-readiness process has no unresolved release blocker. A working interface,
isolated happy path, or demonstration is not sufficient for General Availability.

## 2. Product statement

Verus is a context firewall for trading agents. It accepts untrusted financial content, processes it
inside a controlled ingestion boundary, detects attempts to manipulate downstream agents, verifies
material claims against attributable evidence, applies deterministic policy, and emits a signed
Context Capsule that an agent or human can inspect and verify.

Verus protects the information boundary before model reasoning. It complements, but does not
replace, account permissions, human approval, position limits, execution risk controls, or
exchange-side protections.

## 3. Product principles

1. **Fail closed:** a missing required signal, failed parser, unavailable model, or unverifiable
   source cannot silently become allowed context.
2. **Data is not instruction:** retrieved material cannot change system policy, grant itself
   authority, or authorize tool use.
3. **Deterministic authority:** models may classify, extract, and explain; deterministic policy owns
   the final disposition.
4. **Evidence remains inspectable:** every material accepted claim stays linked to a timestamped
   source and exact citation location.
5. **Uncertainty stays visible:** stale, incomplete, ambiguous, and conflicting evidence is
   represented rather than compressed into false certainty.
6. **Least privilege:** integrations receive the smallest possible capability; exchange connectivity
   is read-only in v1.
7. **Progressive disclosure:** the interface presents the decision and next action first. Technical
   evidence and diagnostics remain available on demand.
8. **Reproducible security:** verdicts record the content, component, model, source, and policy
   versions required to explain or replay the result.

### Requirement ownership

| Requirement group                                           | Accountable owner                  |
| ----------------------------------------------------------- | ---------------------------------- |
| Product contract, personas, workflows, and non-goals        | Product maintainers                |
| Domain contracts, persistence, identity, and jobs           | Platform maintainers               |
| Retrieval, uploads, parsers, normalization, and provenance  | Ingestion maintainers              |
| Threat taxonomy, detectors, policy, and calibration         | Detection and security maintainers |
| Sources, claims, citations, and Context Capsules            | Evidence maintainers               |
| REST, MCP, CLI, SDK, models, Bitget, and webhooks           | Integration maintainers            |
| Console, review workflow, accessibility, and content design | Product experience maintainers     |
| Deployment, privacy, reliability, recovery, and support     | Operations maintainers             |
| Release benchmarks, qualification, and go/no-go decision    | Release maintainers                |

Individuals may hold more than one role, but every pull request and release artifact must identify
the accountable role rather than leaving ownership implicit.

## 4. Primary users

### P1. Agent developer

Builds research or trading-agent workflows and needs a stable API, MCP server, CLI, or SDK that
returns constrained, verifiable context instead of raw hostile content.

Primary jobs:

- submit content without building a security pipeline;
- wait for or receive the final disposition;
- provide only approved Context Capsules to an agent;
- verify capsule integrity offline;
- diagnose integration failures without seeing secrets.

### P2. Trading researcher or reviewer

Needs to understand whether financial content is safe to use, which claims are supported, what
conflicts exist, and what changed, while retaining the final decision.

Primary jobs:

- scan a URL, document, feed item, or pasted text;
- understand `allow`, `review`, or `block` in plain language;
- inspect the minimum evidence necessary to make a decision;
- resolve review-required scans through an audited workflow;
- see which watched or owned Bitget instruments may be affected.

### P3. Security operator

Owns detection policy, review escalation, source trust configuration, security testing, and incident
investigation.

Primary jobs:

- understand why content received a disposition;
- simulate policy changes before promotion;
- investigate quarantined input without activating it;
- reproduce a decision from retained evidence;
- measure attacks blocked, false positives, and detector regressions.

### P4. Platform operator

Runs hosted or self-hosted Verus and is responsible for reliability, isolation, cost, upgrades,
recovery, and incident response.

Primary jobs:

- deploy and upgrade reproducibly;
- observe service and source health;
- restore data and roll back releases safely;
- enforce quotas and protect tenants;
- respond to failures without exposing hostile or sensitive content.

### P5. Workspace administrator

Controls membership, roles, machine credentials, retention, integrations, and workspace-level policy
within platform-enforced limits.

Primary jobs:

- invite and remove members;
- issue, scope, rotate, and revoke API keys;
- configure safe workspace policy;
- manage permitted data flows and retention;
- export or delete workspace data when authorized.

## 5. Required end-to-end workflows

### W1. Scan and consume

1. An authenticated user or client submits a URL, text payload, supported file, or feed event with
   an idempotency key.
2. Verus records an immutable input digest and scan identifier.
3. Content enters quarantine and is fetched or stored under bounded limits.
4. Parsers extract content without executing active material.
5. Canonicalization exposes hidden, encoded, or deceptive representations.
6. Deterministic and isolated semantic detectors produce findings.
7. Source and claim services collect and evaluate supporting evidence.
8. Versioned policy emits `allow`, `review`, or `block`.
9. Verus builds and signs the permitted Context Capsule.
10. The client retrieves the capsule or receives a signed webhook.
11. A downstream agent consumes only permitted capsule fields in strict mode.

### W2. Human review

1. A `review` result enters the authorized workspace queue.
2. A reviewer sees the disposition, short explanation, and inert evidence.
3. The reviewer can inspect more detail through progressive disclosure.
4. The reviewer records a reasoned resolution; configured high-risk cases can require a second
   approver.
5. Verus preserves the original verdict and appends the review outcome.
6. Only the specifically approved capsule version becomes releasable.

### W3. Policy change

1. An authorized operator creates a draft policy version.
2. Verus validates it and prevents changes to non-overridable controls.
3. The operator simulates the draft against representative and frozen cases.
4. A distinct authorized reviewer approves promotion when required.
5. New scans use the promoted version; historical verdicts remain unchanged.
6. An operator can roll back to a prior valid version with a recorded reason.

### W4. Investigation and replay

1. An authorized operator locates a scan through the audit trail.
2. Verus verifies stored content and artifact digests.
3. Replay runs with the recorded component and policy versions when available.
4. Differences caused by external model or source unavailability are explicit.
5. The operator exports an integrity-checkable evidence package when permitted.

### W5. Workspace and credential lifecycle

1. An administrator creates a workspace and assigns least-privilege roles.
2. Human sessions and service credentials have distinct scopes.
3. Keys can be rotated and revoked without service downtime.
4. Signing keys rotate while retained capsules remain verifiable.
5. Workspace export, retention change, and deletion follow authorization and documented
   data-lifecycle rules.

### W6. Deploy, upgrade, recover, and roll back

1. An operator creates or updates an environment from reviewed infrastructure.
2. Pre-deploy checks validate artifacts, configuration, migrations, and backup.
3. The release is promoted through staging before production.
4. Smoke checks and service-level indicators validate the rollout.
5. Failure triggers a tested application and migration rollback path.
6. Backup restore and signing-key continuity are verified during recovery.

## 6. Supported v1 inputs

| Input                     | Required behavior                                                              |
| ------------------------- | ------------------------------------------------------------------------------ |
| URL                       | Hardened retrieval with SSRF, redirect, DNS, size, timeout, and media controls |
| Plain text                | Versioned content envelope, size limits, canonicalization, and provenance      |
| HTML/article              | Script-free parsing with visible and hidden-region extraction                  |
| RSS/Atom item             | Feed and item provenance with canonical-link handling                          |
| PDF                       | Isolated, bounded page-aware extraction with partial-result labeling           |
| Supported office document | Isolated extraction with explicit unsupported/encrypted handling               |
| Image-only document       | Bounded OCR path with OCR-derived text labeled separately                      |
| SEC filing or exhibit     | Authoritative accession, filing metadata, amendment, and citation support      |
| Issuer IR material        | Verified issuer-domain provenance and version tracking                         |
| Bitget announcement       | Official publication/update time and affected-symbol context                   |

Every accepted input is untrusted. Supporting a format means Verus can process it safely and report
failure accurately; it does not imply that the content is truthful.

## 7. Required v1 outputs

### O1. Scan record

Contains tenant scope, immutable input digest, provenance, processing state, component versions,
timestamps, bounded status information, and stable errors.

### O2. Security findings

Each finding contains category, severity, detector, reason code, safe source location,
representation information, confidence where applicable, and policy relevance.

### O3. Evidence record

Contains source identity state, retrieval snapshot, publication/as-of time, claim support or
contradiction, citation anchors, freshness, and uncertainty.

### O4. Policy verdict

The only v1 dispositions are:

- `allow`: the configured required checks passed and policy permits a capsule;
- `review`: a human decision is required before configured downstream release;
- `block`: policy prohibits downstream release of the content.

A security disposition is not an investment recommendation and does not certify that every accepted
claim is objectively true.

### O5. Signed Context Capsule

Uses the published versioned schema and canonical serialization. It identifies the input digest,
permitted facts, findings, conflicts, evidence, policy and component versions, disposition, signing
key, and signature.

### O6. Audit and operational events

Append-only events cover security decisions, review actions, policy lifecycle, key lifecycle,
membership, exports, deletions, administrative actions, and delivery attempts without logging
secrets or unsafe raw content by default.

## 8. Required product surfaces

| Surface            | v1 contract                                                                    |
| ------------------ | ------------------------------------------------------------------------------ |
| REST API           | Authenticated, versioned OpenAPI contract for all supported workflows          |
| MCP server         | Small safe surface for submit, status, capsule retrieval, and verification     |
| CLI                | Scan, wait, inspect, verify, policy, and replay with stable exit codes         |
| TypeScript SDK     | Typed API with retries, pagination, and compatibility guarantees               |
| Web console        | Onboarding, scan, review, evidence, capsule, policy, audit, and administration |
| Webhooks           | Signed, replayable, deduplicated, rotated, and bounded event delivery          |
| Model adapter      | Provider-neutral contract with Qwen support and deterministic test provider    |
| Bitget integration | Read-only market, announcement, watchlist, and portfolio-impact context        |

All interfaces use the same domain contracts and policy engine. Interface-specific shortcuts may not
change security semantics.

## 9. Deployment modes and service boundaries

### Hosted

Multi-tenant Verus operated by the project. Hosted v1 requires workspace isolation, RBAC, quotas,
privacy controls, audited administration, backups, incident response, and published service
expectations.

### Self-hosted

Documented deployment using published, signed artifacts. Self-hosted v1 must support local
verification, externalized configuration and secrets, migrations, backup and restore, upgrades, and
the same policy semantics as hosted Verus.

### Logical service boundaries

- edge/API and authentication;
- control plane for tenants, policy, sources, and keys;
- network-quarantined retrieval;
- resource-isolated parsing and OCR;
- deterministic detection and policy evaluation;
- isolated model-provider execution;
- evidence and connector workers;
- relational metadata and transactional state;
- content-addressed evidence storage;
- durable job queue and dead-letter handling;
- signing and offline verification;
- web console and public developer interfaces;
- telemetry, audit, and operational tooling.

Implementations may combine deployable processes when isolation and scaling requirements remain
enforceable. Trust boundaries may not be combined away for convenience.

## 10. Functional requirements

| ID    | Requirement                                                    | Measure                                       | Owner        |
| ----- | -------------------------------------------------------------- | --------------------------------------------- | ------------ |
| FR-01 | Accept every supported v1 input through one versioned envelope | Contract and end-to-end tests pass            | Platform     |
| FR-02 | Quarantine remote and uploaded content before parsing          | No parser receives unregistered content       | Ingestion    |
| FR-03 | Preserve immutable provenance and replayable snapshots         | Digest verification and offline replay pass   | Ingestion    |
| FR-04 | Detect taxonomy-covered injection and obfuscation              | Frozen benchmark meets published threshold    | Detection    |
| FR-05 | Apply deterministic versioned policy                           | Repeated evaluation is byte-equivalent        | Detection    |
| FR-06 | Verify source identity and material claim evidence             | Evidence conformance suite passes             | Evidence     |
| FR-07 | Detect stale, amended, corrected, and contradictory evidence   | Temporal fixture suite passes                 | Evidence     |
| FR-08 | Build and sign schema-valid Context Capsules                   | Tamper and offline verification tests pass    | Evidence     |
| FR-09 | Support audited human review and controlled release            | Authorization and concurrency tests pass      | Product      |
| FR-10 | Support draft, simulation, promotion, and rollback of policy   | Policy lifecycle suite passes                 | Product      |
| FR-11 | Expose equivalent semantics through REST, MCP, CLI, and SDK    | Shared conformance suite passes               | Integrations |
| FR-12 | Deliver signed, deduplicated webhooks                          | Replay and rotation tests pass                | Integrations |
| FR-13 | Provide read-only Bitget impact mapping                        | Permission and freshness tests pass           | Integrations |
| FR-14 | Support complete workspace and credential lifecycle            | RBAC and lifecycle tests pass                 | Platform     |
| FR-15 | Provide audit search and integrity-checkable export            | Export authorization and integrity tests pass | Product      |

## 11. Security and privacy requirements

| ID      | Requirement                                                                              | Release evidence                            |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| SEC-01  | Retrieval resists SSRF, rebinding, redirect, local-network, and resource attacks         | Adversarial network suite                   |
| SEC-02  | Files and parsers are isolated and bounded                                               | Malformed corpus, resource, and crash tests |
| SEC-03  | Models have no tool, credential, policy, or network authority unless explicitly required | Sandbox and permission tests                |
| SEC-04  | Deterministic controls cannot be weakened by content or model output                     | Policy authorization tests                  |
| SEC-05  | Tenant ownership is enforced across storage, jobs, cache, export, and delivery           | Cross-tenant suite                          |
| SEC-06  | API, service, and signing keys support scope, rotation, revocation, and audit            | Key lifecycle drill                         |
| SEC-07  | Secrets and hostile raw content are excluded from default logs and errors                | Telemetry inspection tests                  |
| SEC-08  | Release artifacts have SBOM, provenance, signatures, and pinned build inputs             | Artifact verification                       |
| SEC-09  | Critical and high security findings block release                                        | Security review register                    |
| PRIV-01 | Data classes have enforced retention schedules                                           | Lifecycle tests                             |
| PRIV-02 | Authorized export and deletion propagate through active systems                          | Export/deletion acceptance                  |
| PRIV-03 | External model data flow is configurable and documented                                  | Provider privacy matrix                     |

## 12. Reliability and operational requirements

| ID     | Requirement                                                                             | Release evidence              |
| ------ | --------------------------------------------------------------------------------------- | ----------------------------- |
| OPS-01 | Accepted jobs survive worker and service restarts without duplicate final artifacts     | Restart and idempotency tests |
| OPS-02 | Retry, timeout, cancellation, and dead-letter behavior is bounded and observable        | Failure-path suite            |
| OPS-03 | Hosted service has published SLIs, SLOs, alerts, owners, and runbooks                   | SLO review                    |
| OPS-04 | Deployment, migration, promotion, and rollback are automated and staged                 | Release drill                 |
| OPS-05 | Encrypted backups restore within approved RPO/RTO objectives                            | Restore report                |
| OPS-06 | Overload and provider failure degrade safely and fail closed                            | Load and chaos report         |
| OPS-07 | Capacity and cost limits exist per scan and tenant                                      | Capacity report and alerts    |
| OPS-08 | Incidents have severity, containment, evidence, communication, and follow-up procedures | Incident exercise             |

Numerical SLOs and benchmark thresholds will be fixed after baseline measurement and before
release-candidate qualification. They may not be invented after the final benchmark is observed.

## 13. User-experience requirements

| ID    | Requirement                                                                                   | Measure                          |
| ----- | --------------------------------------------------------------------------------------------- | -------------------------------- |
| UX-01 | Each primary screen has one visually dominant next action                                     | Design review and usability test |
| UX-02 | Default views show disposition, short reason, affected subject, freshness, and next step only | UI acceptance test               |
| UX-03 | Findings, citations, raw metadata, and diagnostics use progressive disclosure                 | UI acceptance test               |
| UX-04 | Security language is plain and distinguishes unsafe content from unsupported truth claims     | Content review                   |
| UX-05 | Raw hostile content never renders as active HTML                                              | Browser security suite           |
| UX-06 | Core workflows meet WCAG 2.2 AA targets and work by keyboard                                  | Automated and manual audit       |
| UX-07 | Empty, loading, degraded, retry, denied, and terminal failure states explain recovery         | State coverage test              |
| UX-08 | Responsive workflows remain usable on supported mobile and desktop widths                     | Browser matrix                   |

The console must not become an observability dashboard disguised as a product. Detailed system
information belongs behind explicit inspection actions or in the operator area, not in the primary
research workflow.

## 14. Release metrics

The v1 evaluation report must publish, at minimum:

- attack block rate overall and by taxonomy category;
- false-positive rate on the frozen benign corpus;
- precision, recall, and calibration for model-assisted classifications;
- unsupported and contradicted claim detection rates;
- scan latency percentiles by input type and size;
- queue delay, retry, dead-letter, and connector-freshness measurements;
- capsule signature and replay success rates;
- availability and error-budget behavior during qualification;
- cross-interface conformance results;
- accessibility, browser, load, soak, recovery, and rollback results; and
- known failures, blind spots, excluded formats, and residual risks.

Published metrics must include dataset versions, denominators, environment, policy, detector and
model versions, seeds where applicable, and reproduction instructions.

## 15. Explicit non-goals for v1

Verus v1 will not:

- place, modify, cancel, route, or recommend trades;
- request exchange withdrawal or trading permissions;
- custody funds or exchange secrets with write capability;
- guarantee that allowed content is true, complete, legal, or profitable;
- replace an outbound order firewall or account risk controls;
- provide high-frequency or latency-sensitive execution;
- render arbitrary active webpages inside the console;
- allow customers to disable platform-critical security controls;
- train provider models on customer content as a required product behavior;
- support every document format, language, exchange, or financial source;
- claim compliance certification that has not been independently obtained; or
- declare production readiness based only on a demo, screenshot, or happy path.

Requests outside these boundaries require a new versioned product decision and threat-model review,
not an undocumented expansion of v1.

## 16. Release requirement traceability

Every implementation issue is mapped to the contract below. Issue closure must link its acceptance
evidence back to the relevant requirement groups.

| Issues  | Contract coverage                                                                   |
| ------- | ----------------------------------------------------------------------------------- |
| #3-#8   | Product principles, threat model, domain semantics, trust, architecture, governance |
| #9-#15  | FR-14, SEC-05 through SEC-07, OPS-01 through OPS-04, platform foundations           |
| #16-#22 | FR-01 through FR-03, SEC-01, SEC-02, supported inputs and provenance                |
| #23-#29 | FR-04, FR-05, SEC-03, SEC-04, detection metrics and policy behavior                 |
| #30-#37 | FR-06 through FR-08, evidence outputs, temporal behavior, signed capsules           |
| #38-#43 | FR-11 through FR-13, REST, MCP, CLI, SDK, model, Bitget, and webhooks               |
| #44-#51 | FR-09, FR-10, FR-15, UX-01 through UX-08, complete console workflows                |
| #52-#59 | SEC-05 through SEC-09, PRIV-01 through PRIV-03, OPS-02 through OPS-08               |
| #60     | Release metrics and frozen benchmark requirements                                   |
| #61     | W1 through W6, installation, upgrade, migration, rollback, and recovery             |
| #62     | Release-blocker policy, residual-risk ownership, and go/no-go approval              |
| #63     | Signed artifacts, documentation, support window, monitoring, and v1.0 GA            |

## 17. Definition of General Availability

Verus v1.0 is generally available only when:

1. issues #3 through #62 are complete with acceptance evidence;
2. all nine milestone exit criteria have passed;
3. no critical, high, P0, or P1 release blocker remains open;
4. the frozen evaluation report and known limitations are public;
5. hosted and self-hosted installation paths have passed qualification;
6. upgrade, migration rollback, application rollback, restore, key rotation, dependency outage, and
   incident-response drills have passed;
7. user, developer, security, privacy, support, and operator documentation is current for the
   release commit;
8. release artifacts are signed and independently verifiable; and
9. launch monitoring, rollback ownership, and incident ownership are active.

Changing this release contract requires a reviewed pull request that explains the user, security,
operational, and schedule impact. Removing a requirement to make a release pass is not completion.
