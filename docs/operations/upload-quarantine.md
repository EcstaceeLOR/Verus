# Upload quarantine

Uploads are streamed into a private, mode-600 quarantine store and only receive opaque
`quarantine://sha256/...` references. The API and console never serve these bytes inline or expose
storage paths.

The policy limits uploads to 100 MiB, verifies the declared media type against PDF, OOXML/ZIP, or
plain-text signatures, rejects encrypted PDFs and unsupported/mismatched formats, and requires a
safety scanner result. Malicious, rejected, and scan-unavailable uploads remain quarantined; only a
separate parser worker may receive a scoped reference in later pipeline stages. Quarantined bytes
are deleted after 30 days by `cleanupExpired`, matching the data-handling retention policy.
