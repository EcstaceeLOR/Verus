# Verus Bitget portfolio impact

This package connects verified events to Bitget instruments a workspace owns or watches. It is a
read-only context integration: it cannot place or cancel orders, transfer assets, withdraw funds, or
change API-key permissions.

`BitgetRestTransport` implements Bitget's HMAC-signed REST authentication while exposing only `GET`
for three allowlisted reads:

- classic spot account assets: `/api/v2/spot/account/assets`;
- Unified Trading Account assets: `/api/v3/account/assets`; and
- public spot/Reality instruments: `/api/v3/market/instruments?category=SPOT`.

Private credentials are not sent to the public instrument endpoint. The transport has no generic
request method, rejects unknown endpoints at runtime, requires HTTPS, enforces time and
response-byte budgets, supports cancellation, and drops its credential reference when disconnected.

## Configure

Create a dedicated Bitget API key with Read-Only permission. Leave Trade, Transfer, and Withdraw
disabled, bind the key to the production egress IP allowlist, and resolve its three credential
values from the Verus secret provider.

```ts
import { BitgetRestTransport, ReadonlyBitgetPortfolio } from "@verus/bitget";

const transport = new BitgetRestTransport({
  credentials: {
    apiKey: secrets.apiKey,
    secretKey: secrets.secretKey,
    passphrase: secrets.passphrase,
  },
  timeoutMs: 10_000,
  maximumResponseBytes: 2_000_000,
});

const portfolio = new ReadonlyBitgetPortfolio({
  transport,
  accountMode: "unified",
  capabilities: {
    read: true,
    trade: false,
    transfer: false,
    withdraw: false,
    verifiedAt: new Date().toISOString(),
    ipAllowlisted: true,
  },
  maximumAgeMs: 300_000,
  maximumRetries: 2,
  retryBaseDelayMs: 250,
});

const result = await portfolio.load({
  workspaceId: "workspace_01",
  watchlist: [{ instrument: "AAPL" }],
});
```

The capability record is an onboarding attestation because Bitget does not expose the key's complete
permission configuration through these read-only endpoints. Verus rejects any attestation that
includes Trade, Transfer, or Withdraw, then independently limits runtime access through its closed
GET-only endpoint boundary.

## Load and map

`load` returns either a validated `ready` context or an explicit `degraded` state. It never converts
an unavailable portfolio into an empty, apparently safe portfolio. Supported degraded reasons are
credential revocation, permission denial, rate limiting, cancellation, unavailable service, and
invalid provider response. Known Bitget maintenance codes use bounded exponential retry. Every
snapshot is bound to its workspace, and impact mapping rejects an event from a different workspace
or account mode.

Unified Account assets support Reality/rToken holdings. The public instrument catalog identifies
Reality instruments and derives their underlying stock ticker, so a verified `AAPL` event can map to
an owned `rAAPL` asset and the `rAAPLUSDT` instrument. Output explains:

- holding versus watchlist relationship;
- exact instrument, base asset, or rToken-underlying mapping basis;
- numeric confidence and confidence band; and
- portfolio timestamp, age, freshness, and configured freshness limit.

Quantities and symbols never enter telemetry. Portfolio context is excluded from public evidence and
model prompts by default; the model adapter receives it only through an explicit permission check.

Call `disconnect()` when a workspace removes the integration. A provider revocation response also
disconnects automatically and prevents later requests. Delete retained portfolio snapshots through
the workspace privacy lifecycle.
