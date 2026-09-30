# ADR-0005: Canonical signing and key providers

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Context Capsules must be verifiable offline across runtimes. Hosted deployments
need non-exportable keys, while self-hosted deployments need an interoperable
local option. Signing must not grant a general-purpose key oracle.

## Decision

Use RFC 8785 JSON canonicalization, UTF-8, SHA-256 digests, and Ed25519 capsule
signatures as defined by the v1 wire contract. Verification is a pure local
operation using published public-key metadata and revocation state.

Define a narrow signing-provider port that accepts purpose, workspace, key ID,
artifact digest, and canonical bytes. Hosted production uses a managed KMS or
HSM-backed provider when it supports the required algorithm and controls.
Self-hosted Verus uses an encrypted sealed-key provider with separate master-key
delivery and filesystem permissions. Private material never enters a capsule,
log, job envelope, or general application configuration.

## Alternatives considered

- **HMAC:** small and fast, but verifiers would need the signing secret and
  could forge artifacts.
- **RSA signatures:** broad support, but larger keys and signatures without a
  v1 interoperability advantage.
- **ECDSA P-256:** strong ecosystem, but signature encoding and nonce behavior
  add cross-runtime complexity.
- **Provider-native envelope only:** strong hosted keys, but no portable local
  verification format.

## Consequences

Capsules have compact portable signatures and deterministic bytes. KMS support
for Ed25519 varies, so a deployment must pass signing-provider conformance before
activation. Key lifecycle, publication, revocation, and time validity remain
separate required controls.

## Evolution and rollback

Algorithm is explicit in every signature. New algorithms require an additive
reader rollout and contract change before writers use them. Key rotation keeps
old public keys available for retained artifacts. Rollback changes the active
signing key but never re-signs history in place.
