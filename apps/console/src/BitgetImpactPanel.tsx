import "./bitget-impact.css";

const verifiedEvent = {
  entity: "Apple Inc.",
  symbol: "AAPL",
  source: "Verified event fixture",
  confidence: 0.98,
};

const impact = {
  instrument: "rAAPLUSDT",
  holding: "rAAPL",
  relationship: "holding",
  mappingBasis: "rtoken_underlying",
  mappingConfidence: 0.882,
  confidenceBand: "high",
  freshness: "current",
};

export function BitgetImpactPanel() {
  return (
    <section className="bitget-impact panel" aria-labelledby="bitget-impact-heading">
      <div className="panel-kicker"><span>3</span> BITGET PORTFOLIO IMPACT</div>
      <div className="bitget-impact__heading">
        <div>
          <p className="eyebrow">Read-only exchange context</p>
          <h2 id="bitget-impact-heading">From a verified event to the Bitget position it can affect.</h2>
          <p>
            The public demo uses a credential-free verified-event fixture. In production, the same
            portfolio-impact semantics are backed by Verus&apos;s GET-only Bitget integration and
            never require trade, transfer, or withdrawal permission.
          </p>
        </div>
        <span className="bitget-impact__badge">BITGET · READ ONLY</span>
      </div>

      <div className="bitget-impact__flow" aria-label="Verified event to Bitget exposure mapping">
        <article>
          <small>VERIFIED EVENT</small>
          <strong>{verifiedEvent.entity}</strong>
          <p>{verifiedEvent.symbol} · confidence {(verifiedEvent.confidence * 100).toFixed(0)}%</p>
          <span>{verifiedEvent.source}</span>
        </article>
        <div className="bitget-impact__arrow" aria-hidden="true">→</div>
        <article className="bitget-impact__mapping">
          <small>MAPPING BASIS</small>
          <strong>rToken underlying</strong>
          <p>AAPL → rAAPL → rAAPLUSDT</p>
          <span>Production rule: rtoken_underlying</span>
        </article>
        <div className="bitget-impact__arrow" aria-hidden="true">→</div>
        <article className="bitget-impact__position">
          <small>BITGET EXPOSURE</small>
          <strong>{impact.instrument}</strong>
          <p>Owned asset: {impact.holding}</p>
          <span>Portfolio relationship: {impact.relationship}</span>
        </article>
      </div>

      <div className="bitget-impact__facts">
        <div>
          <small>Mapping confidence</small>
          <strong>{(impact.mappingConfidence * 100).toFixed(1)}%</strong>
          <span>{impact.confidenceBand}</span>
        </div>
        <div>
          <small>Portfolio freshness</small>
          <strong>{impact.freshness}</strong>
          <span>stale data fails visibly</span>
        </div>
        <div>
          <small>Runtime permissions</small>
          <strong>GET only</strong>
          <span>no generic request method</span>
        </div>
        <div>
          <small>Write permissions</small>
          <strong>Disabled</strong>
          <span>trade · transfer · withdraw</span>
        </div>
      </div>

      <details className="bitget-impact__details">
        <summary>What the production Bitget integration actually reads</summary>
        <div>
          <code>GET /api/v2/spot/account/assets</code>
          <code>GET /api/v3/account/assets</code>
          <code>GET /api/v3/market/instruments?category=SPOT</code>
        </div>
        <p>
          Verus validates a dedicated read-only capability attestation, rejects any configuration
          that enables Trade, Transfer, or Withdraw, isolates credentials from public market
          requests, and returns an explicit degraded state instead of pretending an unavailable
          portfolio is empty.
        </p>
      </details>

      <p className="bitget-impact__note">
        This panel demonstrates a checked-in sample event and sample portfolio so judges can inspect
        the mapping without supplying exchange credentials. It does not claim the text submitted
        above has been factually verified by the lightweight hosted scanner.
      </p>
    </section>
  );
}
