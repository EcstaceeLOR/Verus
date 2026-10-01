# Retriever service

This isolated service resolves, pins, and retrieves HTTPS content from public networks. It must not
receive database, signing, provider, or exchange credentials. Each redirect is independently DNS
resolved and blocked when any answer is private, local, link-local, multicast, or reserved.

The versioned policy rejects credential URLs, non-default ports, encoded responses, unsupported
media types, excessive redirects, and bodies above 5 MiB. It records the redirect chain, resolved
addresses, TLS status, digest, and policy version without logging raw content.
