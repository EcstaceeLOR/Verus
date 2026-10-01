# Crypto

One-way API-key verification, secret-provider ports, self-hosted sealed secret storage, and a narrow
Ed25519 Context Capsule signer. Private keys never enter public configuration or persistence as
plaintext values, and secret-bearing objects redact their string and JSON representations.

Hosted deployments implement the `SecretProvider` port with an approved KMS/HSM or secret manager.
Self-hosted deployments may use `SealedFileSecretProvider` with a separately delivered 32-byte
master key and a private absolute directory. See the
[key lifecycle runbook](../../docs/security/key-lifecycle.md).
