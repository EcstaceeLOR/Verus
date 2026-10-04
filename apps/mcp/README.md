# Verus MCP server

The Verus MCP server gives agent hosts a narrow, authenticated interface to the context firewall. It
uses the official MCP TypeScript SDK and exposes the same REST-backed policy and authorization path
as other Verus clients.

## Tools

| Tool            | Purpose                                              | Source content returned |
| --------------- | ---------------------------------------------------- | ----------------------- |
| `verus_submit`  | Submit a versioned ingestion request                 | No                      |
| `verus_status`  | Read safe scan status and verdict metadata           | No                      |
| `verus_capsule` | Retrieve an authorized, signed Context Capsule       | No                      |
| `verus_verify`  | Verify a capsule with configured Ed25519 public keys | No                      |

Tool names, descriptions, and JSON Schemas are fixed in source. Scanned content cannot alter them.
API credentials are transport configuration and never appear in model-visible tool arguments.

## Build and verify

From the repository root:

```sh
corepack pnpm --filter @verus/mcp typecheck
corepack pnpm --filter @verus/mcp lint
corepack pnpm --filter @verus/mcp test
corepack pnpm --filter @verus/mcp build
```

The compatibility suite uses the official MCP client over in-memory, spawned stdio, and Streamable
HTTP transports. The stdio test launches the real executable and calls a local REST server.

## Configuration

| Variable                    | Required    | Meaning                                                  |
| --------------------------- | ----------- | -------------------------------------------------------- |
| `VERUS_API_URL`             | Yes         | REST base URL; HTTPS is required outside loopback        |
| `VERUS_API_KEY`             | stdio       | Bearer key bound by the local agent host                 |
| `VERUS_WORKSPACE_ID`        | stdio       | Workspace sent to REST authorization                     |
| `VERUS_SIGNING_KEYS_JSON`   | No          | Public verification keys; never private signing material |
| `VERUS_MCP_HOST`            | HTTP        | Bind host; defaults to `127.0.0.1`                       |
| `PORT`                      | HTTP        | Bind port; defaults to `3100`                            |
| `VERUS_MCP_ALLOWED_HOSTS`   | Public HTTP | Comma-separated accepted Host values                     |
| `VERUS_MCP_ALLOWED_ORIGINS` | Public HTTP | Comma-separated accepted Origin hostnames                |

Signing key JSON has this shape:

```json
[
  {
    "key_id": "key_verus_2026_01",
    "public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  }
]
```

Do not commit API keys or place them in agent prompts, shell history, or MCP tool arguments. Inject
them with the agent host's secret/environment configuration.

## Local stdio transport

Build once, then point an MCP-capable host at the executable:

```json
{
  "mcpServers": {
    "verus": {
      "command": "node",
      "args": ["/absolute/path/to/Verus/apps/mcp/dist/stdio.js"],
      "env": {
        "VERUS_API_URL": "http://127.0.0.1:3001",
        "VERUS_API_KEY": "${VERUS_API_KEY}",
        "VERUS_WORKSPACE_ID": "${VERUS_WORKSPACE_ID}"
      }
    }
  }
}
```

The stdio process writes protocol data only to stdout. Bounded operational events go to stderr and
contain the tool name, outcome, and duration only.

## Hosted Streamable HTTP transport

Start the Node HTTP entry after building:

```sh
corepack pnpm --filter @verus/mcp start:http
```

- MCP endpoint: `POST /mcp` (plus protocol-defined GET/DELETE behavior)
- Health endpoint: `GET /health`
- Required request headers: `Authorization: Bearer ...` and `x-verus-workspace-id: ...`
- Maximum MCP body: 1 MiB

The HTTP entry rejects missing transport credentials before negotiation, forwards them to the REST
client, and relies on the REST API for key validation, tenant isolation, scope enforcement, policy,
rate limits, and audit behavior. A public deployment must explicitly set allowed Host and Origin
values; the safe default accepts loopback only.

## Failure and rollback behavior

- Invalid tool input returns an MCP `isError` result and is never forwarded to REST.
- REST authentication, authorization, rate-limit, and service errors remain non-success tool
  results.
- Unknown response fields that could contain hostile source text are removed before serialization.
- Startup fails with exit code `78` when required configuration is absent or insecure.
- No database migration is required. Rollback is replacing the MCP process with the previous image
  or executable; the REST API and stored scans are unchanged.
