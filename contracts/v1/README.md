# Verus wire contracts v1

This directory is the authoritative wire contract for Verus 1.x. JSON Schema
defines runtime validity. `types.ts` provides a matching, read-only TypeScript
view for consumers.

## Published contracts

- `context-capsule.schema.json`: signed decision artifact delivered to an
  agent.
- `ingestion-request.schema.json`: URL, text, upload, or feed event submitted
  for scanning.
- `source-record.schema.json`: source identity and canonical origins.
- `policy-verdict.schema.json`: policy decision before capsule assembly.

`verus.schema.json` contains the shared definitions. Consumers should validate
against the contract-specific wrapper, not the union at the root of the shared
schema.

## Scalar rules

- IDs combine a lowercase resource prefix, `_`, and a 26-character Crockford
  Base32 ULID. Examples include `cap_01ARZ3NDEKTSV4RRFFQ69G5FAV` and
  `scan_01ARZ3NDEKTSV4RRFFQ69G5FAV`. IDs are immutable and case-sensitive.
- Timestamps are UTC RFC 3339 strings ending in `Z`, with whole seconds or
  exactly three fractional digits. Producers must never emit local offsets.
- Digests are lowercase SHA-256 values prefixed with `sha256:`. The digest is
  calculated over the exact bytes named by the field, not a decoded or
  normalized substitute.
- Decimal quantities are base-10 strings. Binary floating-point values are not
  permitted on the wire. Confidence values are integer basis points from 0 to
  10,000.
- Enumerations and reason codes are case-sensitive.

## Canonical serialization and signatures

Verus uses the JSON Canonicalization Scheme (JCS, RFC 8785) encoded as UTF-8.
Object member order in ordinary JSON input has no meaning. Array order is
semantic and is preserved. Producers must sort set-like arrays by stable ID or
lexical value before assembly so independently produced capsules remain
reproducible.

To sign a Context Capsule, construct this envelope:

```json
{
  "capsule": "<the complete capsule object with signature removed>",
  "signature_metadata": {
    "algorithm": "<signature.algorithm>",
    "key_id": "<signature.key_id>",
    "signed_at": "<signature.signed_at>"
  }
}
```

The placeholder above is explanatory: `capsule` is an object in the real
envelope. Canonicalize the envelope with JCS, encode it as UTF-8, sign those
bytes with Ed25519, and encode the 64-byte signature as unpadded base64url. The
signature value is therefore 86 characters.

A verifier must fail closed when schema validation fails, the algorithm is not
supported, the key is unknown/revoked/outside its validity window, or signature
verification fails. A valid signature proves artifact integrity; it does not
override the capsule disposition, evidence freshness, or local policy.

`fixtures/canonicalization-vectors.json` provides runtime-neutral examples. A
conforming runtime must produce the exact `canonical` string and SHA-256 digest
for every vector.

## Unknown fields and extensions

Core objects reject unknown properties. Optional product-specific data belongs
under `extensions`, keyed by a lowercase reverse-domain name such as
`com.example.strategy`. Consumers must ignore extension keys they do not
understand, preserve them when relaying signed content, and include them in
signature verification.

Extensions must not redefine core fields, weaken a disposition, carry secrets,
or introduce behavior that is required to interpret the safety decision. A
feature that changes the security meaning of a capsule requires a versioned
core-contract change.

## Compatibility and evolution

`schema_version` is explicit and currently fixed at `1.0`.

- Patch releases may clarify documentation and tighten implementation tests but
  do not change the accepted wire shape.
- A compatible minor contract may add optional data or a documented extension.
  Support is opt-in; consumers reject a minor version they have not declared.
- Removing or renaming a field, changing a field's meaning or type, adding a
  required field, or changing signing bytes requires a new major version and a
  new contract directory and schema ID.
- Unsupported versions are rejected before any policy decision or side effect.
  They are never coerced to the nearest known version.
- Signed historical artifacts are immutable. Migration creates a derived
  artifact that records its source digest and receives a new ID and signature;
  it never rewrites the original.

This strict behavior prevents silent interpretation drift. Deployments should
add readers before writers during a version rollout and retain the preceding
reader until rollback is no longer required.

## Validation

Valid fixtures live in `fixtures/valid`; deliberate failures live in
`fixtures/invalid`. From the repository root, each fixture can be checked with
Ajv 8 and draft 2020-12 support. For example:

```sh
npx ajv-cli@5 validate --spec=draft2020 \
  -r contracts/v1/verus.schema.json \
  -s contracts/v1/context-capsule.schema.json \
  -d contracts/v1/fixtures/valid/context-capsule.json
```

Invalid fixtures must fail for the reason recorded in their adjacent manifest.
