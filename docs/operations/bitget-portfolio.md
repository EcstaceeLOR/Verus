# Bitget portfolio impact

Verus uses Bitget only to tell a workspace which owned or watched instruments may be affected by a
verified event. The integration cannot trade. Its transport exposes `GET` for a closed list of asset
and instrument endpoints and has no order, transfer, withdrawal, key-management, or generic request
operation.

Bitget currently distinguishes Read-Only, Trade, Transfer, and Withdraw permissions. Create a
dedicated key with Read-Only enabled and the other three disabled, then bind it to the deployment's
egress IP. See Bitget's [REST API access preparation](https://www.bitget.com/docs/classic/rest-api).
Verus records an onboarding capability attestation and rejects an over-privileged declaration. The
runtime endpoint allowlist remains the independent enforcement boundary because these read calls do
not reveal every permission configured on the provider key.

## Account modes and rTokens

Choose the mode that matches the account:

- `classic` reads `/api/v2/spot/account/assets`;
- `unified` reads `/api/v3/account/assets`; and
- both modes read the public `/api/v3/market/instruments?category=SPOT` catalog.

Bitget's Unified Account is the current interface for Reality tokenized stocks. Bitget's
[Reality trading guide](https://www.bitget.com/docs/uta/reality-trading-guide) specifies that
Reality assets reuse the normal Account Assets endpoint and that instruments expose the Reality
marker. Verus maps the account asset, Bitget instrument, and underlying stock ticker without using a
trading endpoint.

The signed REST transport applies the documented timestamp + method + request-path HMAC prehash. It
requires HTTPS, bounds time and response bytes, supports cancellation, and never sends credentials
to the public instrument request. Credentials come from the secret-provider lifecycle and must not
enter source, manifests, logs, analytics, traces, support exports, or browser storage.

## Failure behavior

Portfolio loading returns `ready` or an explicit `degraded` reason. It never represents a failed
provider read as an empty portfolio. Invalid/revoked keys and permission denial are non-retryable.
Rate limits, transport outages, and Bitget's documented maintenance codes use bounded exponential
retry. The current Bitget changelog identifies `45001`, `40725`, `40808`, and `40015` as codes that
may occur during release windows; see the
[Bitget UTA changelog](https://www.bitget.com/docs/uta/changelog/2026-03).

A credential-revoked response immediately disconnects the local integration and prevents later
requests. Permission denial tells the operator to replace the key rather than expand the existing
key in place. Provider failure never changes a Verus security disposition.

## Privacy and telemetry

Portfolio data is restricted tenant context. It is encrypted at rest, excluded from public evidence,
and excluded from model prompts unless the workspace explicitly permits that narrow use. Impact
results include relationship, mapping basis, confidence, provider/event timestamps, age, and
freshness. The UI must label stale results rather than silently treating them as current. Snapshots
and verified events carry the same workspace binding; cross-workspace or cross-account-mode mapping
is rejected before any impact is produced.

Telemetry contains operation class, account mode, outcome, attempt, duration, safe error code,
provider code, and HTTP status only. It excludes holdings, quantities, instruments, watchlists,
credentials, workspace IDs, and event content.

## Revocation, rollback, and deletion

To remove an integration:

1. delete or revoke the API key in Bitget;
2. call the Verus disconnect operation to drop the in-process credential reference;
3. remove the secret-provider binding; and
4. delete retained portfolio data under the workspace retention policy.

No database migration is required to switch between classic and unified adapters. Rollback selects
the prior account-mode configuration and package version. Never roll back by enabling Trade,
Transfer, or Withdraw. During rollback or outage, hide live impact output or show the last validated
snapshot as stale; deterministic scanning remains available.
