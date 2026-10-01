# ADR-0001: Application language and monorepo

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Verus needs a public API, browser console, MCP server, CLI, SDK, deterministic domain code, and
multiple workers. The small team must keep public contracts and security semantics aligned across
those interfaces without collapsing hostile work into one process.

## Decision

Use strict TypeScript on the active Node.js LTS line for first-party application and service code.
Use React and TypeScript for the browser console. Pin the exact runtime, package manager, compiler,
and dependency graph in the repository and release artifacts.

Use a package-manager workspace with task-graph caching. Keep deployable entry points under `apps/`
or `services/` and reusable code under `packages/`. Runtime schema validation remains authoritative;
TypeScript types alone never validate untrusted input.

Native tools and isolated third-party parsers may use another language behind a versioned process or
service boundary. They do not introduce a second domain model or bypass public contracts.

## Alternatives considered

- **Go for all backend services:** strong static binaries and concurrency, but duplicates types
  across the console and SDK and slows product iteration.
- **Python for all backend services:** excellent model and document ecosystem, but less direct
  sharing with browser and SDK contracts and greater runtime validation discipline is required.
- **Independent repositories:** stronger repository isolation, but increases version skew and makes
  atomic contract changes harder for the initial team.
- **One undifferentiated application:** simpler packaging, but cannot enforce network, parser,
  model, and credential boundaries.

## Consequences

The project gains one dominant language and atomic contract updates. It accepts Node runtime and
dependency supply-chain exposure, mitigated by lockfiles, provenance, pinned CI, minimal production
images, and isolated hostile workers. Workspace boundaries are architectural and must be checked
automatically.

## Evolution and rollback

Individual services can be replaced behind their existing wire contract. A runtime upgrade is staged
through CI and can roll back while stored envelopes remain within the compatibility window. Changing
the dominant language or repository model requires a superseding ADR.
