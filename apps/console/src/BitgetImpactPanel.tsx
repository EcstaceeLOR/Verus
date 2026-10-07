import { useEffect, useState } from "react";

import "./bitget-impact.css";

interface BitgetImpact {
  readonly instrument: string;
  readonly instrument_kind: string;
  readonly relationship: string;
  readonly mapping_confidence: number;
  readonly confidence_band: string;
  readonly mapping_basis: string;
  readonly freshness: string;
  readonly age_ms: number;
  readonly maximum_age_ms: number;
  readonly explanation: string;
}

interface BitgetImpactResponse {
  readonly mode: "credential_free_sample";
  readonly provider: "bitget";
  readonly event: Readonly<{
    entity_name: string;
    symbol: string;
    confidence: number;
    source: string;
    as_of: string;
  }>;
  readonly portfolio: Readonly<{
    account_mode: string;
    sample_holding: string;
    permissions: Readonly<{
      read: boolean;
      trade: boolean;
      transfer: boolean;
      withdraw: boolean;
    }>;
  }>;
  readonly impacts: readonly BitgetImpact[];
  readonly production_boundary: Readonly<{
    private_reads: readonly string[];
    public_reads: readonly string[];
    generic_request_method: boolean;
    write_permissions_required: boolean;
  }>;
}

function safeImpactResponse(value: unknown): BitgetImpactResponse | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const event =
    typeof input.event === "object" && input.event !== null && !Array.isArray(input.event)
      ? (input.event as Record<string, unknown>)
      : undefined;
  const portfolio =
    typeof input.portfolio === "object" && input.portfolio !== null && !Array.isArray(input.portfolio)
      ? (input.portfolio as Record<string, unknown>)
      : undefined;
  const boundary =
    typeof input.production_boundary === "object" &&
    input.production_boundary !== null &&
    !Array.isArray(input.production_boundary)
      ? (input.production_boundary as Record<string, unknown>)
      : undefined;
  if (
    input.mode !== "credential_free_sample" ||
    input.provider !== "bitget" ||
    event === undefined ||
    portfolio === undefined ||
    boundary === undefined ||
    !Array.isArray(input.impacts) ||
    typeof event.entity_name !== "string" ||
    typeof event.symbol !== "string" ||
    typeof event.confidence !== "number" ||
    typeof event.source !== "string" ||
    typeof event.as_of !== "string" ||
    typeof portfolio.account_mode !== "string" ||
    typeof portfolio.sample_holding !== "string" ||
    !Array.isArray(boundary.private_reads) ||
    !Array.isArray(boundary.public_reads)
  ) {
    return undefined;
  }

  const impacts = input.impacts.flatMap((candidate): BitgetImpact[] => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
    const impact = candidate as Record<string, unknown>;
    if (
      typeof impact.instrument !== "string" ||
      typeof impact.instrument_kind !== "string" ||
      typeof impact.relationship !== "string" ||
      typeof impact.mapping_confidence !== "number" ||
      typeof impact.confidence_band !== "string" ||
      typeof impact.mapping_basis !== "string" ||
      typeof impact.freshness !== "string" ||
      typeof impact.age_ms !== "number" ||
      typeof impact.maximum_age_ms !== "number" ||
      typeof impact.explanation !== "string"
    ) {
      return [];
    }
    return [impact as unknown as BitgetImpact];
  });
  if (impacts.length !== input.impacts.length) return undefined;

  return value as BitgetImpactResponse;
}

export function BitgetImpactPanel() {
  const [data, setData] = useState<BitgetImpactResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/bitget-impact", {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Bitget impact demo is unavailable.");
        const parsed = safeImpactResponse((await response.json()) as unknown);
        if (parsed === undefined) throw new Error("Bitget impact demo returned invalid data.");
        setData(parsed);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Bitget impact demo is unavailable.");
      }
    })();
    return () => controller.abort();
  }, []);

  const impact = data?.impacts[0];

  return (
    <section className="bitget-impact panel" aria-labelledby="bitget-impact-heading">
      <div className="panel-kicker">
        <span>3</span> BITGET PORTFOLIO IMPACT
      </div>
      <div className="bitget-impact__heading">
        <div>
          <p className="eyebrow">Read-only exchange context</p>
          <h2 id="bitget-impact-heading">
            From a verified event to the Bitget position it can affect.
          </h2>
          <p>
            The public demo uses a credential-free portfolio fixture, but the mapping result below
            is calculated by the production <code>ReadonlyBitgetPortfolio.impact()</code> path.
          </p>
        </div>
        <span className="bitget-impact__badge">BITGET · READ ONLY</span>
      </div>

      {error ? (
        <div className="bitget-impact__error" role="status">
          {error}
        </div>
      ) : data === undefined || impact === undefined ? (
        <div className="bitget-impact__loading" aria-live="polite">
          Calculating portfolio impact with the production Bitget mapper…
        </div>
      ) : (
        <>
          <div
            className="bitget-impact__flow"
            aria-label="Verified event to Bitget exposure mapping"
          >
            <article>
              <small>VERIFIED EVENT FIXTURE</small>
              <strong>{data.event.entity_name}</strong>
              <p>
                {data.event.symbol} · confidence {(data.event.confidence * 100).toFixed(0)}%
              </p>
              <span>
                {data.event.source} evidence · as of{" "}
                {new Date(data.event.as_of).toLocaleTimeString()}
              </span>
            </article>
            <div className="bitget-impact__arrow" aria-hidden="true">
              →
            </div>
            <article className="bitget-impact__mapping">
              <small>PRODUCTION MAPPING</small>
              <strong>{impact.mapping_basis.replaceAll("_", " ")}</strong>
              <p>
                {data.event.symbol} → {data.portfolio.sample_holding} → {impact.instrument}
              </p>
              <span>{impact.explanation}</span>
            </article>
            <div className="bitget-impact__arrow" aria-hidden="true">
              →
            </div>
            <article className="bitget-impact__position">
              <small>BITGET EXPOSURE</small>
              <strong>{impact.instrument}</strong>
              <p>
                {impact.relationship} · {impact.instrument_kind}
              </p>
              <span>Unified account sample</span>
            </article>
          </div>

          <div className="bitget-impact__facts">
            <div>
              <small>Mapping confidence</small>
              <strong>{(impact.mapping_confidence * 100).toFixed(1)}%</strong>
              <span>{impact.confidence_band}</span>
            </div>
            <div>
              <small>Portfolio freshness</small>
              <strong>{impact.freshness}</strong>
              <span>
                {Math.round(impact.age_ms / 1000)}s old /{" "}
                {Math.round(impact.maximum_age_ms / 1000)}s limit
              </span>
            </div>
            <div>
              <small>Runtime permissions</small>
              <strong>GET only</strong>
              <span>closed endpoint allowlist</span>
            </div>
            <div>
              <small>Write permissions</small>
              <strong>Disabled</strong>
              <span>trade · transfer · withdraw</span>
            </div>
          </div>

          <details className="bitget-impact__details">
            <summary>Inspect the production Bitget boundary</summary>
            <div>
              {[...data.production_boundary.private_reads, ...data.production_boundary.public_reads].map(
                (endpoint) => (
                  <code key={endpoint}>GET {endpoint}</code>
                ),
              )}
            </div>
            <p>
              Live deployments use a dedicated Bitget key attested as read-only. Verus rejects a
              configuration that enables Trade, Transfer, or Withdraw, and the transport exposes no
              generic request method.
            </p>
          </details>

          <p className="bitget-impact__note">
            Judge-demo truth boundary: the event and portfolio are fixtures so no exchange
            credentials are needed. The rToken relationship, confidence, and freshness displayed
            above are generated by the production Bitget impact algorithm. This lightweight hosted
            scanner does not claim the submitted text itself has been factually verified.
          </p>
        </>
      )}
    </section>
  );
}
