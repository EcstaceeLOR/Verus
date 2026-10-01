# Contributing to Verus

Thank you for helping make agent-consumed financial context safer. Verus is a security-sensitive
product, so changes need evidence proportional to their risk.

## Before you start

- Read the [product contract](docs/product/requirements-v1.md),
  [threat model](docs/security/threat-model.md), and [architecture](docs/architecture/README.md).
- Search existing issues and pull requests.
- Use the applicable issue or open one before a large change.
- Never place a suspected vulnerability, secret, customer data, or live malicious payload in a
  public issue. Follow [SECURITY.md](SECURITY.md).

## Development workflow

1. Fork or branch from current `main`.
2. Keep one coherent outcome per pull request.
3. Add tests for normal, boundary, abuse, and failure paths.
4. Update contracts, threat mappings, migrations, runbooks, and user docs when behavior changes.
5. Run every repository check affected by the change.
6. Complete the pull-request template and link the issue with `Closes #...`.
7. Address review and keep the branch current without rewriting shared history.

Use the exact install, development, and verification commands in the
[local development guide](docs/development/local-development.md). Run the standalone verifiers
documented next to any changed contracts as part of the complete merge gate.

## Required change evidence

Every pull request must explain:

- the user or operator outcome;
- security and privacy impact;
- compatibility and migration impact;
- failure and rollback behavior;
- tests run and results; and
- documentation and telemetry changes.

Generated files must be reproducible from committed source. Do not commit real credentials,
production payloads, personal data, or licensed datasets without documented redistribution rights.

## Review and merge

Maintainer review is required. Changes to security policy, public contracts, cryptography,
authentication, tenant isolation, retention, migrations, release workflows, or CODEOWNERS require
explicit owner review. Authors do not approve their own pull requests.

Required checks must pass, review conversations must be resolved, and the pull request must be
mergeable before squash merge. Emergency security work follows the private advisory process and
receives retrospective public documentation after coordinated disclosure.

## Commit and compatibility expectations

Use clear imperative commit subjects. Public contracts follow their documented compatibility policy.
Database and envelope changes use expand, migrate, contract sequencing and preserve the supported
rollback window. Historical signed artifacts are never rewritten.

## Certificate of origin

By submitting a contribution, you represent that you have the right to submit it under the
repository's Apache-2.0 license. Use `git commit -s` when a maintainer or employer policy requires a
Developer Certificate of Origin signoff.

## Conduct and help

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For usage questions and
operational help, follow [SUPPORT.md](SUPPORT.md).
