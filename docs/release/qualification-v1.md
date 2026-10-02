# v1 release-candidate qualification

Run the complete release gate from a clean checkout:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
node scripts/verify-release-qualification.mjs
```

The checked [qualification matrix](qualification-v1.json) links each supported workflow and selected
security, privacy, reliability, and UX release requirement to versioned automated evidence. It is a
release inventory, not a waiver: every linked suite must pass on the release candidate, and staging
qualification must attach its sanitized run results before promotion.

The following production-like drills require an operator-recorded result: fresh install, upgrade,
expand-migration rollback, immutable image rollback, encrypted backup restore, signing-key
continuity, queue/worker restart, parser crash, storage failure, connector/model outage, and tenant
deletion. Use [staged deployments](../../deploy/README.md), [recovery](../operations/recovery.md),
and [capacity and resilience](../operations/capacity-and-resilience.md). A failed or unavailable
drill blocks promotion; do not substitute a mock response or silently omit it from the record.
