# Local infrastructure

This Compose profile starts the two mandatory local dependencies: PostgreSQL and an S3-compatible
object store. Both bind to loopback only and use named volumes. Credentials in `.env.example` are
deliberately local-only and must not be reused in any shared or production environment.

From the repository root:

```sh
corepack pnpm infra:up
corepack pnpm infra:down
```

Docker Compose is optional for contract and unit checks but required for the integration tests
introduced with persistence. Destroying named volumes is an explicit operator action and is not part
of `infra:down`.
