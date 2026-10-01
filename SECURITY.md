# Security policy

## Supported versions

Verus is in pre-release development. Security fixes currently target `main` and
the latest published pre-release. At General Availability, this table will be
replaced by the announced support window for released versions.

| Version | Security fixes |
| --- | --- |
| `main` | Yes |
| Latest pre-release | Yes |
| Older or unmaintained builds | No |

Do not use pre-release Verus for live trading decisions.

## Report a vulnerability privately

Use GitHub's private
[Report a vulnerability](https://github.com/EcstaceeLOR/Verus/security/advisories/new)
form. Private vulnerability reporting is enabled for this repository.

Do not open a public issue, pull request, discussion, or social-media post for a
suspected vulnerability. Do not include credentials, personal data, portfolio
data, tenant content, or weaponized payloads beyond the minimum reproduction.

Include, when available:

- affected version or commit and deployment mode;
- impact and the security boundary crossed;
- minimal reproduction and required configuration;
- relevant logs with secrets and tenant data removed; and
- whether the issue is known to be exploited or publicly disclosed.

## Response and coordinated disclosure

Maintainers aim to acknowledge a report within two business days and provide an
initial triage decision within five business days. These are response targets,
not a warranty or service-level agreement.

The reporter and maintainers coordinate on validation, severity, remediation,
credit, advisory content, CVE handling when applicable, and disclosure timing.
The default embargo target is up to 90 days from confirmed receipt. It may be
shortened for active exploitation or public disclosure, or extended by mutual
agreement when a safe fix or downstream coordination reasonably needs more time.

During embargo:

- access is limited to people needed to investigate and remediate;
- branches, artifacts, logs, and test cases remain private;
- public commits and release notes avoid revealing the flaw before a fix; and
- reporters are asked not to exploit, disclose, or access data beyond what is
  necessary to demonstrate impact.

After a fix is available, maintainers publish an advisory proportionate to the
risk, affected versions, upgrade or mitigation instructions, credit preference,
and known limitations. Evidence that could enable unsafe exploitation may be
delayed or minimized.

## Severity and remediation targets

Verus uses CVSS as one input and also considers trading-agent reach, tenant
isolation, credential exposure, integrity of signed artifacts, exploitability,
and existing controls. Target remediation after confirmation is seven days for
critical, 30 days for high, 90 days for medium, and a planned release for low
severity. Active exploitation triggers the incident process immediately.

## Safe-harbor intent

Good-faith research should avoid privacy violations, service degradation,
social engineering, physical testing, credential theft, market manipulation,
and accessing or changing data that is not yours. Stop and report if you
encounter sensitive data. This statement expresses project intent and is not a
promise on behalf of third parties or a waiver of applicable law.
