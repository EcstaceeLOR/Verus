# Release security controls

Verus production releases are blocked unless the release evidence is generated from the reviewed
commit, independently verified, and approved by a release maintainer who did not author the change.
A successful test suite is necessary but is not release authorization.

## Evidence

For the exact 40-character commit SHA, generate and verify the evidence in a clean checkout:

```sh
node scripts/generate-release-evidence.mjs --revision <sha> --output artifacts/release-evidence
node scripts/verify-release-evidence.mjs --revision <sha> --directory artifacts/release-evidence
```

The verifier checks the CycloneDX SBOM digest against the in-toto SLSA provenance statement and
binds it to the requested source revision and lockfile digest. Store both files with the signed
release record; reject changed, missing, or unverifiable evidence.

## Application and deployment baseline

- API responses send a deny-by-default CSP, frame, MIME, referrer, permissions, cache, and
  cross-origin policy. API routes do not accept cookie authentication or opt into CORS.
- HSTS is enabled only when the deployment explicitly sets `VERUS_ENFORCE_HTTPS=true`; plaintext
  local development cannot accidentally advertise an HTTPS-only policy.
- Untrusted uploads remain quarantined and parsing runs without outbound egress. Releases use
  immutable image digests, separated migration credentials, and the infrastructure policy check.
- Dependencies are locked, production high-severity advisories fail CI, and workflow actions are
  SHA-pinned with read-only permissions.

## Independent review and remediation

Before every production major/minor release, commission an independent security review covering the
current threat model, public API, authorization, upload/parser isolation, egress, tenant isolation,
release evidence, and cloud permissions. Record each finding with severity, owner, due date,
validation evidence, and closure decision in the private security tracker. Critical and high
findings block release until fixed and independently retested; an accepted risk requires the
security owner and release maintainer to document the expiry and compensating control.

Report vulnerabilities privately through the repository security advisory channel. Do not place
exploit details or tenant data in public issues.
