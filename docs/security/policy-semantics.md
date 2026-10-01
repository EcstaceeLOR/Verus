# Verus policy and decision semantics

- **Status:** Normative for Verus v1
- **Threats addressed:** THR-POL-001, THR-POL-002
- **Related contracts:** `contracts/v1/verus.schema.json`

This document defines how Verus turns findings, control results, and evidence quality into one
deterministic disposition. It is a security contract. Product interfaces may explain the result
differently, but they may not change it.

## 1. Decision invariants

The v1 evaluator obeys these invariants:

1. `allow < review < block` is a monotonic restriction lattice. A later rule may raise a disposition
   but cannot lower it.
2. Only the versioned deterministic evaluator emits a disposition. A model, parser, connector,
   content item, extension, or client cannot emit or force `allow`.
3. Platform baseline controls cannot be disabled or weakened by environment, workspace, integration,
   or content-derived configuration.
4. Every required check is explicitly `pass`, `fail`, or `unavailable`. Missing, unknown, or
   unevaluated required checks fail closed.
5. An `allow` requires all required safety checks to pass and every applicable policy layer to
   permit release.
6. Findings, reasons, and the original policy verdict are append-only. Human review creates a
   separate resolution; it does not rewrite history.
7. Unknown enum values, unsupported policy versions, invalid policy state, and evaluator errors
   produce `block`, never `allow`.

These invariants apply equally to hosted and self-hosted Verus.

## 2. Deterministic evaluation input

A decision input is the immutable tuple below:

- workspace and integration identifiers;
- canonical content digest and normalized representation digest;
- ordered findings with detector IDs, detector versions, and reason codes;
- required-control results;
- evidence snapshot IDs, grades, and `as_of` time;
- unresolved conflict records;
- active policy ID, version, and digest;
- component and model versions pinned by that policy; and
- declared evaluation mode and feature flags.

Set-like collections are sorted by stable ID before evaluation. Policy rules may use only declared
fields, pure operators, exact integer arithmetic, and UTC timestamps supplied in the decision input.
They may not read wall-clock time, network state, mutable process state, locale, random values, or
unordered map iteration.

The same serialized decision input and policy digest must produce the same disposition and ordered
reason-code list on every supported runtime. Replay of historical decisions uses the stored input
tuple. A new source snapshot or component version is a new decision input, not the same evaluation.

## 3. Findings

A finding describes a condition observed by a detector. It is not itself a policy decision.

### 3.1 Categories

- `direct_prompt_injection`: explicit instructions addressed to an agent or model.
- `indirect_prompt_injection`: embedded instructions intended to alter downstream behavior.
- `obfuscation`: encoding, fragmentation, or visual tricks that conceal relevant content.
- `hidden_content`: content not normally visible but available to a parser or model.
- `source_mismatch`: claimed identity, origin, or canonical source does not match evidence.
- `stale_evidence`: evidence outside freshness requirements or superseded.
- `contradiction`: material claims conflict across applicable evidence.
- `parser_risk`: parsing was unsafe, incomplete, ambiguous, or constrained.
- `policy_failure`: policy, required-control, or evaluator integrity failed.
- `other`: a registered finding with no more specific v1 category.

`other` is not a compatibility escape hatch. Its detector and reason code must be registered in the
active policy. An unregistered category, detector, or reason code is a policy-integrity failure and
produces `block`.

### 3.2 Severity

Severity is the impact if a finding is true, not the probability that it is true.

| Severity   | Impact                                                 | Platform floor |
| ---------- | ------------------------------------------------------ | -------------- |
| `info`     | Context with no direct safety impact                   | `allow`        |
| `low`      | Limited impact; useful for correlation or audit        | `allow`        |
| `medium`   | Material uncertainty or plausible safety impact        | `review`       |
| `high`     | Likely unsafe downstream context or major control loss | `block`        |
| `critical` | Active compromise, boundary bypass, or integrity loss  | `block`        |

The floor is applied to every policy-relevant finding regardless of detector confidence. A policy
may be stricter, such as escalating repeated low findings to `review`, but cannot be weaker.

Severity assignment belongs to the registered detector definition. Model text cannot select its own
severity. When a model assists classification, an adapter validates its bounded output and a
deterministic mapping assigns category, severity, and reason code.

## 4. Confidence and evidence strength

Verus keeps different uncertainties separate.

### 4.1 Detector confidence

`finding.confidence_bps` is detector confidence: the calibrated likelihood that the detector
classified the observed condition correctly. It is an integer from 0 to 10,000 basis points. It is
optional only for deterministic findings where confidence would be misleading, such as a digest
mismatch.

Detector confidence:

- never measures the truth of a financial claim;
- never lowers the severity floor;
- cannot turn a failed or unavailable required control into a pass; and
- may be used by stricter correlation rules only when the detector definition declares a calibration
  version and threshold.

### 4.2 Evidence confidence

`claim.confidence_bps` is evidence confidence: the strength of support for that specific claim after
source identity, citation match, freshness, independence, and contradiction checks. It is not model
confidence and is not a security finding score.

Evidence confidence:

- is calculated by a versioned deterministic evidence policy;
- is scoped to one claim and one evidence snapshot set;
- cannot erase or reduce a security finding; and
- below the policy's release threshold triggers `review` or exclusion of the claim, never silent
  promotion to verified status.

Interfaces must label these values as “detection confidence” and “evidence confidence.” A generic
“confidence score” is prohibited.

## 5. Required-control results and partial failure

Each pipeline stage declares whether it is required for the active input type. The evaluator
receives an explicit result for every required stage.

| Failure class         | Examples                                           | Disposition |
| --------------------- | -------------------------------------------------- | ----------- |
| Security boundary     | network quarantine, malware scan, isolation        | `block`     |
| Content completeness  | parser truncation, unsupported encryption          | `block`     |
| Integrity             | digest, schema, signature, provenance              | `block`     |
| Policy authority      | missing policy, invalid rule, unknown detector     | `block`     |
| Audit durability      | verdict or mandatory audit event cannot persist    | `block`     |
| Evidence availability | source unavailable or no corroboration             | `review`    |
| Optional enrichment   | non-required metadata unavailable                  | unchanged   |
| Delivery              | webhook or notification unavailable after decision | unchanged   |

An unavailable model-assisted detector produces `review` only when the active policy marks it
optional, deterministic coverage completed successfully, and no other rule blocks. If it is
required, the result is `block`.

An unchanged disposition does not hide failure. Optional and delivery failures remain visible as
stable reason codes and operational events.

## 6. Policy layers and precedence

Policies are immutable, content-addressed versions. Evaluation applies these layers in order:

1. contract and evaluator validity;
2. non-overridable platform baseline;
3. signed emergency deny policy;
4. environment policy;
5. workspace policy;
6. integration policy; and
7. deterministic aggregation and release checks.

Every matching rule contributes `allow`, `review`, or `block`. The result is the maximum restriction
across all contributions. Rule order within a layer cannot change the outcome. A `block` is terminal
for release, although evaluation should continue safely when possible to collect explanations.

Lower layers may narrow accepted inputs, increase required evidence, escalate severity, or require
human review. They cannot disable a detector, mark a required control optional, reduce severity,
suppress a reason, lower a disposition, or replace a platform threshold with a weaker value.

If no valid promoted policy matches the input, Verus emits `block` with `POLICY_NO_MATCH`. Draft,
expired, revoked, partially loaded, or digest-mismatched policies are never used as a fallback.

## 7. Aggregation algorithm

The v1 result is defined by this pure procedure:

1. Validate the decision-input schema, policy state, versions, and digests.
2. Start at `allow` with an empty reason set.
3. Apply required-control failure mappings.
4. Apply each finding's platform severity floor.
5. Apply evidence thresholds, freshness rules, and material conflicts.
6. Evaluate every matching rule in every policy layer.
7. Select the greatest disposition in the restriction lattice.
8. Sort unique reason codes lexically. Select the primary explanation by disposition rank,
   policy-layer priority, then lexical code.
9. Emit the policy digest and all component versions with the verdict.

Any exception before a durable verdict is produced maps to `block` and `POLICY_EVALUATION_FAILED`.
The service must not return a partially evaluated `allow`.

Material unresolved contradictions and evidence below the required confidence floor contribute
`review`. A policy may exclude a non-material claim instead, but exclusion must be explicit and
auditable.

## 8. Human review and overrides

Review answers whether a specific quarantined artifact may be released under an allowed exception.
It does not retrain detectors, mutate policy, or certify financial truth.

A review resolution records the reviewer, role, reason code, safe note, source verdict ID, evidence
viewed, timestamp, and policy version. High-risk workflows may require two distinct approvers.
Optimistic concurrency prevents decisions against stale evidence or a superseded verdict.

The following are not review-overridable:

- critical findings;
- high direct or indirect prompt-injection findings;
- malware, isolation, integrity, signature, schema, or policy failures;
- unknown or incompatible versions; and
- any case prohibited by emergency deny policy.

An eligible review approval creates a new release decision and, when needed, a new signed capsule
linked to the original. The original `review` verdict stays unchanged. A rejection raises release
state to `block`.

## 9. Explanation contract

Every non-`allow` verdict has at least one stable reason code. An `allow` also records the required
controls and policy version that passed. User-facing text is generated from a versioned reason-code
catalog, not arbitrary model prose.

The default product view presents only:

- disposition;
- one short primary reason;
- affected subject;
- evidence freshness; and
- the next available action.

More findings, confidence values, policy traces, and raw diagnostics remain behind explicit
disclosure. This keeps the interface usable without hiding decision evidence.

## 10. Telemetry and audit

The evaluator emits structured counters for disposition, stable reason code, policy version,
evaluator version, and failure class, plus duration and matched rule count. It records an
append-only audit event for policy selection, evaluation, and any review resolution.

Metrics and logs must not contain raw untrusted content, citations, secrets, free-text reviewer
notes, or portfolio data. Unexpected `allow` rate changes, evaluation errors, unknown reason codes,
and review-release anomalies alert the security owner.

## 11. Policy promotion and rollback

A policy version moves through draft, validated, simulated, approved, promoted, superseded, or
revoked states. Promotion requires schema validation, invariant checks, decision-vector tests,
regression simulation, and authorized approval. Production reads an atomic pointer to one immutable
promoted version.

Rollback changes that pointer to a previously approved version and records the actor and reason. It
affects new evaluations only. Stored verdicts and signed capsules retain their original policy
digest. Emergency deny policy can be activated independently and may only make decisions stricter.

## 12. Conformance examples

Executable cases live in `contracts/v1/fixtures/policy-decision-vectors.json`. They cover:

- conflicting `allow` and `block` contributions;
- medium findings that require review;
- required security-control failure;
- partial evidence failure;
- optional enrichment failure;
- unknown categories and missing policy; and
- attempts by model-derived data to request `allow`.

`contracts/v1/verify-policy-vectors.mjs` evaluates every case twice, reverses unordered input
collections, and requires identical dispositions and reason codes. These vectors are normative until
the production engine replaces the reference evaluator with the same conformance suite.
