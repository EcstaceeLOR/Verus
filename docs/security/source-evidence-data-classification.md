# Source, evidence, and data-classification rules

- **Status:** Normative for Verus v1
- **Threats addressed:** THR-EVD-001, THR-EVD-002, THR-EVD-003,
  THR-DAT-001
- **Machine-readable inventory:** `data-handling-matrix.v1.json`

This document defines three independent assessments:

1. source identity and provenance;
2. the quality of evidence supporting a specific claim; and
3. the sensitivity and lifecycle of data stored by Verus.

No score from one assessment substitutes for another. A verified source can be
wrong, a true statement can come from an unknown source, and public content can
be dangerous to parse.

## 1. Invariants

Verus implementations must preserve these rules:

- Source identity is not claim truth.
- Source popularity, follower count, domain age, traffic, or prior accuracy
  cannot independently verify a claim.
- Every material verified claim has an exact citation and an applicable
  evidence assessment.
- Freshness, amendment state, subject, period, unit, and currency are evaluated
  before evidence can support a claim.
- Unknown, mismatched, stale, superseded, or unverifiable evidence never
  silently becomes `verified`.
- More copies of the same upstream report do not create independent
  corroboration.
- Data inherits the highest sensitivity of its inputs unless an approved,
  tested transformation removes that sensitivity.
- Retention expiry, tenant deletion, and legal hold are explicit states and are
  reconciled across primary storage, indexes, caches, exports, and backups.

## 2. Source representation

A source assessment records `source_class`, `identity_state`, and `source_tier`
separately. Verus producers populate all three. Their omission from an older
compatible payload is treated as `unknown`, never inferred as trusted.

### 2.1 Source class

- `primary`: the entity responsible for the underlying event or an official
  authority publishing an original record. Examples include an issuer filing,
  regulator record, exchange notice, or court order.
- `secondary`: a party reporting, analyzing, aggregating, or republishing
  another party's information.
- `user_supplied`: content supplied by a tenant or end user without an
  independently verified publication channel.
- `unknown`: the origin or relationship to the claim is not established.

“Primary” is claim-relative. An exchange is primary for its own listing notice
but may be secondary for an issuer's revenue statement. A copied filing hosted
on a news site remains secondary even when its text matches the filing.

### 2.2 Identity state

- `verified`: the observed origin matches a registry-backed or connector-backed
  identity using the current verification procedure.
- `unknown`: identity could not be established with sufficient assurance.
- `mismatched`: the content claims an identity that conflicts with the observed
  origin, signature, registry, or canonical channel.

Identity verification records the method, verifier version, time, canonical
origin, redirects, and relevant certificate or signing-key reference. A domain
name or TLS certificate alone does not prove issuer authority.

### 2.3 Source tier

- `verified_primary`: verified identity and primary for the assessed claim.
- `verified_secondary`: verified identity but secondary for the assessed claim.
- `attributed`: attributable to a stable origin that is not fully verified.
- `unverified`: user-supplied or unknown origin without a verified identity.
- `blocked`: identity mismatch, prohibited origin, or failed integrity check.

The tier determines provenance handling and minimum corroboration. It does not
declare content true. A `verified_primary` source can still publish an error,
forward-looking statement, correction, or maliciously altered page.

### 2.4 Default handling by source class

| Source class | Default use | Minimum behavior |
| --- | --- | --- |
| Primary | Candidate support | Verify identity, citation, and time |
| Secondary | Candidate corroboration | Trace upstream source and independence |
| User supplied | Lead or scan input | Never self-corroborating |
| Unknown | Lead only | Mark unknown and require review or exclusion |

A `blocked` source cannot support a claim. Its content can still be retained in
quarantine for authorized investigation under the applicable retention rule.

## 3. Evidence representation

An evidence item records its source assessment, immutable snapshot digest,
publication and retrieval times, freshness state, exact locator, and
`quality_grade`. The claim records aggregate evidence confidence in
`claim.confidence_bps`.

### 3.1 Evidence quality grades

- `corroborated`: applicable, current evidence from at least two genuinely
  independent sources, including a verified primary source when one exists.
- `supported`: applicable, current, exact evidence from a verified primary
  source, with no unresolved material contradiction.
- `limited`: relevant evidence exists but is secondary, incomplete, near its
  freshness limit, or missing desired corroboration.
- `weak`: evidence is user-supplied, unverified, ambiguously matched, or only a
  lead to an upstream source.
- `unusable`: mismatched, stale beyond policy, superseded, corrupted, missing an
  exact citation, bound to the wrong subject or period, or prohibited.

Grade is calculated per claim. One source snapshot can be `supported` for the
date of an announcement and `unusable` for a revenue value it never states.

### 3.2 Evidence independence

Verus assigns an independence group using upstream citation chains, syndication
metadata, canonical URLs, content similarity, timestamps, and known ownership.
Items in the same group count once toward quorum. A hundred articles copied
from one wire story are one evidence path.

Unknown independence never increases a grade to `corroborated`. It produces
`limited` or a review trigger according to policy.

### 3.3 Applicability checks

Before evidence contributes to a material claim, Verus checks:

- resolved legal entity and instrument;
- symbol and venue, including historical symbol reuse;
- event type and effective date;
- reporting period and fiscal calendar;
- amount, scale, unit, and currency;
- statement type, such as actual, estimate, guidance, or opinion;
- publication, retrieval, and `as_of` time; and
- correction, amendment, retraction, and supersession state.

An ambiguous material binding cannot be silently selected. The claim remains
`ambiguous`, is excluded, or receives `review` under deterministic policy.

### 3.4 Freshness and temporal state

- `current`: within the policy window and not known to be replaced.
- `stale`: outside the policy window or too old for the claim type.
- `superseded`: a correction, amendment, later filing, or explicit retraction
  replaces it.
- `unknown`: required publication or version information is unavailable.

Freshness windows are versioned by claim and source type. Retrieval time never
replaces publication time. A freshly downloaded old filing remains old.
Unknown freshness cannot produce `supported` or `corroborated` evidence.
Superseded evidence remains available for history but cannot support a current
claim unless the claim explicitly concerns the historical state.

### 3.5 Claim verification state

- `verified`: applicable evidence meets the configured grade and confidence
  threshold with no unresolved material contradiction.
- `contradicted`: applicable evidence contains an unresolved material conflict.
- `unsupported`: no usable evidence meets the minimum support requirement.
- `ambiguous`: entity, period, unit, event, or interpretation is unresolved.
- `pending`: required retrieval or evaluation has not completed.

Only `verified` claims are candidates for an `allow` capsule. Policy can still
exclude them or block the whole artifact because source verification and claim
verification do not override security findings.

## 4. Confidence calculation

Evidence confidence is a deterministic integer from 0 to 10,000 basis points.
Its versioned inputs include evidence grade, exact-citation match, identity,
freshness, applicability, independent corroboration, and contradictions.

The calculation must not use a source's popularity as a truth probability. A
model may extract or classify evidence but cannot set final confidence. Missing
inputs reduce the grade or cause review; they are not replaced with optimistic
defaults.

Confidence thresholds are policy inputs and are recorded with the verdict.
Changing a threshold creates a new policy version. Historical claim states are
not recalculated in place.

## 5. Data classes

Verus uses these ordered sensitivity classes:

- `public`: intentionally public data with no tenant restriction.
- `internal`: non-public operational data whose disclosure has limited impact.
- `confidential`: tenant content, derived artifacts, policy, and audit data.
- `restricted`: portfolio, account, personal, security-investigation, or other
  high-impact tenant data.
- `secret`: credentials, private keys, tokens, and authentication material.

Combining data uses the highest class. Declassification requires a documented
transformation, tests showing sensitive fields cannot be reconstructed, and an
owner-approved purpose. Hashing or pseudonymization alone does not necessarily
declassify data.

The machine-readable inventory defines each asset's class, storage, logging,
export, encryption, retention trigger, default, maximum, deletion objective,
and backup expiry.

## 6. Handling requirements

### 6.1 Public and internal

Public data still passes through untrusted-content isolation. “Public” means
confidentiality is low; it does not mean content is safe to render or parse.
Internal data requires authenticated access and must not be exposed to tenants.

### 6.2 Confidential

Confidential data requires tenant scoping, encryption in transit and at rest,
least-privilege service access, audited export, and redaction from logs. Search
indexes, caches, queues, analytics, and support tooling preserve tenant scope
and retention state.

### 6.3 Restricted

Restricted data additionally requires field-level minimization, explicit
purpose, tighter service scopes, access audit, approved regions, and masked
support views. It cannot enter general analytics, model training, prompts, or
third-party services without explicit configuration and consent.

Portfolio integrations are read-only in v1. Verus stores the minimum instrument
and exposure data needed for impact mapping, not order authority or unnecessary
account history.

### 6.4 Secret

Secret values are never logged, indexed, exported, placed in telemetry, or
returned after creation. Passwords and API keys are stored as one-way verifiers
where possible. Recoverable connector and signing secrets use an approved
secret manager or envelope encryption with separate key access.

Secret metadata, such as key ID, scope, creator, last use, and revocation time,
is not secret but remains confidential audit data. Revocation or rotation starts
the purge objective for recoverable secret material.

## 7. Retention and deletion

The defaults in `data-handling-matrix.v1.json` are product defaults, not a
promise to retain data for the maximum duration. A workspace can select a
shorter permitted duration. Longer retention requires a documented legal or
contractual basis and an approved policy change.

Deletion follows this state machine:

1. an authorized request or retention expiry creates a tombstone;
2. active reads stop and new processing is rejected;
3. primary rows, objects, indexes, caches, and queued payloads are deleted;
4. lifecycle reconciliation verifies every active-system target;
5. encrypted backups expire within the inventory's backup window; and
6. an audit record stores identifiers and completion evidence, not deleted
   content.

Legal hold suspends ordinary deletion only for inventory entries that permit
it. The hold records scope, authority, owner, start, review date, and release.
Secret values cannot be retained by a generic legal hold.

Exports inherit classification and retention metadata. Creating an export does
not reset retention. Expired or deleted data cannot be restored into active use
from a backup. Restore procedures replay tombstones before opening traffic.

## 8. Safe failure behavior

If classification is missing, Verus uses `restricted` until classified. If a
retention rule is missing or malformed, ingestion fails closed rather than
creating ungoverned data. If lifecycle deletion fails, the item remains
tombstoned and inaccessible while reconciliation retries and alerts an owner.

Evidence fails safely as follows:

- missing identity becomes `unknown` and no higher than `weak`;
- mismatched identity becomes `blocked` and `unusable`;
- unknown freshness cannot exceed `limited`;
- stale or superseded evidence becomes `unusable` for a current claim;
- ambiguous subject binding cannot become `verified`; and
- missing provenance or snapshot digest blocks evidence use.

## 9. Telemetry and audit

Metrics include source-tier counts, grade transitions, freshness failures,
corroboration-group collapse, classification fallbacks, retention backlog,
deletion age, legal-hold count, and backup-expiry reconciliation. Dimensions
use stable codes and versions, never raw URLs, claims, portfolio values, user
text, or secret material.

Audit events cover source verification, tier changes, evidence-grade changes,
classification overrides, exports, deletion, legal holds, secret lifecycle,
and administrative access. Each event records actor, tenant, target ID, prior
and new state, reason code, policy version, and time.

## 10. Evolution and rollback

Source and evidence assessments record the rule and connector versions that
produced them. A new rule creates a new assessment; it does not rewrite the old
one. Policy rollback affects future assessments and replays only.

Data-class changes require a migration plan that can move data to stricter
controls before readers adopt the new class. Rollback cannot lower protection
for already migrated data. Retention changes apply without extending the life
of items already scheduled for earlier deletion unless an authorized hold
exists.

The inventory verifier checks required asset coverage and ensures restricted
or secret data cannot be configured for logs, general analytics, or unencrypted
storage.
