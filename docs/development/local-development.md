# Local development

## Supported tools

- Node.js 24.19.0, pinned in `.node-version` and `.nvmrc`;
- pnpm 12.8.1, invoked through Corepack and pinned in `package.json`;
- Git; and
- Docker Compose v2 when running PostgreSQL and object storage.

No globally installed pnpm, TypeScript, Turbo, linter, formatter, or test runner is required.

## Clean checkout

Install the exact lockfile graph in one command:

```sh
corepack pnpm install --frozen-lockfile
```

Then run the complete local acceptance suite:

```sh
corepack pnpm check
```

The workspace verifier intentionally rejects a different Node patch or pnpm version. Use a version
manager on macOS/Linux/Windows, or a development container that reads `.node-version`.

## Start the local applications

Start the API and console together:

```sh
corepack pnpm dev
```

Open `http://127.0.0.1:3000` and choose **Check connection**. The API listens on
`http://127.0.0.1:3001`. Both bind to loopback by default.

Start durable local dependencies when a feature requires them:

```sh
corepack pnpm infra:up
```

The Compose profile consumes `.env.example`. Copy it to an ignored local file only when you need
overrides; never put production secrets in either file.

## Common commands

| Command                      | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `corepack pnpm build`        | Build every implemented workspace in dependency order |
| `corepack pnpm test`         | Run package tests                                     |
| `corepack pnpm lint`         | Run static lint rules                                 |
| `corepack pnpm typecheck`    | Run strict TypeScript checks                          |
| `corepack pnpm format:check` | Check deterministic formatting                        |
| `corepack pnpm verify`       | Check contracts, governance, architecture, and layout |
| `corepack pnpm check`        | Run the complete merge gate                           |

Turbo caches build and test outputs under `.turbo`. `dev` is persistent and is never cached. All
production dependencies use exact versions in the lockfile; internal dependencies must use the
`workspace:` protocol.

## Ports

| Service        | Default |
| -------------- | ------- |
| Console        | 3000    |
| API            | 3001    |
| PostgreSQL     | 5432    |
| Object API     | 9000    |
| Object console | 9001    |

Port and endpoint values are documented in `.env.example`. The console's Vite development proxy maps
`/api` to the local API without changing API semantics.

## Failure and cleanup

An invalid port stops the API before it listens. Missing Docker produces an explicit command failure
and does not affect contract/unit checks. A failed workspace task makes `check` non-zero; Turbo does
not convert failed tasks into cached success.

`infra:down` stops containers but retains named volumes. Data removal must be requested explicitly
so a routine shutdown cannot erase local state.
