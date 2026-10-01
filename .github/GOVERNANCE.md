# Project governance

## Roles

- **Contributors** propose and review changes and follow project policies.
- **Maintainers** triage issues, review changes, manage releases, and enforce community and security
  policy.
- **Code owners** provide required domain review for sensitive paths.
- **Security responders** receive private reports and coordinate remediation.
- **Release maintainers** approve artifacts and the release go/no-go record.

One person may hold several roles, but a pull-request author cannot supply the independent approval
required for their own change. High-risk review and release rules expand as the maintainer group
grows; they are not silently waived.

## Decisions

Routine decisions happen in linked issues and pull requests. Product scope, security semantics,
public contracts, architecture, compatibility, and release criteria require written rationale and
owner review. Architecture changes use a new ADR that supersedes the prior decision rather than
rewriting history.

Maintainers seek evidence-based consensus. When consensus is not practical, the responsible code
owner records the decision, alternatives, risks, and dissent. Safety requirements are not removed
merely to make a release pass.

## Merge policy

A merge requires a linked issue, complete template, passing required checks, resolved review
threads, required code-owner approval, and a documented rollback path when state or compatibility
changes. Squash merge is the default. Force pushes and direct commits to protected release branches
are prohibited outside the documented emergency process.

The repository's current single-maintainer bootstrap may use an administrator bypass to execute the
reviewed issue-by-issue build plan. The bypass is audited and does not waive tests, issue linkage,
PR creation, or acceptance evidence. Before v1.0 GA, a second qualified reviewer is required for
release approval and security-critical launch blockers.

## Releases

Releases use immutable tags, generated notes, reproducible artifacts, provenance, checksums,
signatures, an SBOM, migration and rollback instructions, and a documented support window. Only
release maintainers can promote a release.

## Security and conduct

Vulnerabilities and conduct concerns use the private routes in `SECURITY.md` and
`CODE_OF_CONDUCT.md`. Embargo membership is least privilege. Retaliation, premature disclosure, or
using confidential report data for another purpose is grounds for removal from a project role.

## Changing governance

Governance changes use a public issue and reviewed pull request unless disclosure would expose an
embargoed vulnerability. Changes cannot retroactively alter a contributor's license grant or erase
the history of a decision.
