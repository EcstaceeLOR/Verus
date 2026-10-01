# Retrieval quarantine

The retriever is the only Verus boundary with general outbound network access. It has no database,
signing, provider, or exchange credentials.

Policy version `1.0` permits HTTPS only on port 443. It rejects credentialed URLs and validates
every DNS answer before connecting; private, loopback, link-local, carrier-grade NAT, multicast,
reserved, and IPv4-mapped private IPv6 addresses are blocked. Redirects are manual, limited to five,
and revalidate URL and DNS policy for each hop. There is no fallback client or automatic redirect
path.

Responses use `Accept-Encoding: identity`, reject any content encoding, require an allowlisted media
type, and stream no more than 5 MiB. The returned provenance includes policy version, final URL,
redirect chain, resolved addresses, TLS authorization/protocol, fetch time, and SHA-256 digest. Raw
content is not emitted to logs or metrics.
