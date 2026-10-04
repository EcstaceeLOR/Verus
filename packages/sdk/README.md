# Verus TypeScript SDK and CLI

The SDK and JSON-only CLI expose the production Verus scan lifecycle to services, terminals, and CI.
They use the authenticated v1 REST contract and never return submitted hostile source bytes.

## Install

The workspace package is packable as `@verus/sdk` and targets Node.js 24. The release tarball
bundles its version-matched Verus contract and cryptography runtime, so installation does not depend
on unpublished workspace packages. Build it from this repository with:

```text
corepack pnpm --filter @verus/sdk build
```

The package exports `VerusClient`, typed request and response models, offline verification, stable
errors, and the `verus` executable. Release consumers should pin an exact published version and roll
back by restoring the previous package-lock entry; REST v1 remains compatible under the rules in
[the compatibility policy](../../docs/compatibility.md).

## Authentication

Network commands read these values:

- `VERUS_API_URL`: HTTPS API origin. Plain HTTP is accepted only for `localhost`, `127.0.0.1`, or
  `[::1]` development stacks.
- `VERUS_API_KEY`: scoped bearer credential.
- `VERUS_WORKSPACE_ID`: workspace bound to that credential.

Inject credentials through the process supervisor or CI secret store. Do not paste bearer values
into commands, arguments, source files, logs, or shell history. The CLI never echoes them, and the
client keeps them in private fields that are not serialized.

## CLI

Every invocation writes exactly one JSON value to stdout. Diagnostics contain stable codes, never
request content or credentials.

| Command                                      | Result                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `verus scan request.json`                    | Submits a versioned ingestion request.                                              |
| `verus wait scan_id`                         | Polls until the scan reaches a terminal state.                                      |
| `verus inspect scan_id`                      | Reads status, findings, evidence metadata, and the signed capsule when available.   |
| `verus status scan_id`                       | Reads only the current scan state.                                                  |
| `verus verify capsule.json public-keys.json` | Verifies a capsule offline; API configuration is not required.                      |
| `verus policy scan_id`                       | Returns the signed policy reference, disposition, and reason codes.                 |
| `verus replay request.json`                  | Re-submits the exact idempotent request and fails unless the API confirms a replay. |

`wait` accepts `--timeout-ms` and `--interval-ms`. Run `verus --help` for the machine-readable
command synopsis.

### Stable exit codes

|  Code | Meaning                                         |
| ----: | ----------------------------------------------- |
|   `0` | Success or `allow`.                             |
|   `2` | Policy review required.                         |
|   `3` | Policy blocked the context.                     |
|   `4` | Scan failed or was cancelled.                   |
|  `64` | Invalid command usage.                          |
|  `65` | Invalid input, capsule, key file, or signature. |
|  `69` | Non-retryable API failure.                      |
|  `70` | Unexpected CLI failure.                         |
|  `75` | Retryable or rate-limited API failure.          |
|  `77` | Authentication or authorization failure.        |
|  `78` | Missing or unsafe configuration.                |
| `124` | Scan wait timed out.                            |

`review` and `block` are successful security decisions but intentionally use non-zero codes so CI
cannot accidentally continue as though context was allowed.

## TypeScript

```ts
import { VerusClient } from "@verus/sdk";

const verus = new VerusClient({
  baseUrl: process.env.VERUS_API_URL!,
  apiKey: process.env.VERUS_API_KEY!,
  workspaceId: process.env.VERUS_WORKSPACE_ID!,
  telemetry: (event) => metrics.record("verus_sdk_request", event),
});

const accepted = await verus.scan(request);
const terminal = await verus.wait(accepted.scan_id, { timeoutMs: 120_000 });
const inspection = await verus.inspect(terminal.scan_id);
```

The typed client provides `scan`, `replay`, `status`, `wait`, `findings`, `evidence`, `capsule`,
`inspect`, `policy`, `scans`, and `iterateScans`. Retryable network, `429`, and `5xx` responses use
bounded exponential backoff and honor bounded `Retry-After` values. Pagination is cursor based.
Callers can cancel requests with an `AbortSignal`.

Telemetry includes only a normalized route, success or error outcome, duration, HTTP status, and
stable error code. A telemetry callback failure never changes request behavior.

## Offline verification

`verifyCapsuleOffline(capsule, publicKeys)` canonicalizes all signed fields, selects the declared
Ed25519 key ID, verifies the signature, and returns the artifact digest. Its public-key file format
is a JSON array:

```json
[
  {
    "keyId": "key_01ARZ3NDEKTSV4RRFFQ69G5FB5",
    "algorithm": "Ed25519",
    "publicKey": "base64url-spki-public-key"
  }
]
```

A valid signature proves artifact integrity. Consumers must still enforce workspace binding,
disposition, evidence freshness, key revocation state, and supported schema versions.

## Failure and replay behavior

- Requests fail closed on invalid JSON, unsafe URLs, missing credentials, unsupported capsules, or
  unavailable signing keys.
- `scan` is safe to retry because the v1 request carries a required idempotency key.
- `replay` is stricter: it returns only when the server confirms the same immutable submission was
  already accepted. A new acceptance produces `IDEMPOTENT_REPLAY_NOT_FOUND`.
- `inspect` omits the capsule while a scan is non-terminal or ends without a signed artifact.
- Raw submitted context is never included in SDK telemetry or CLI error output.

The local-stack conformance tests execute the documented scan, wait, inspect, policy, replay, and
offline verify workflows over an actual HTTP listener in CI.
