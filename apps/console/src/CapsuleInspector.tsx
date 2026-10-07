import { useMemo, useState } from "react";

import {
  buildHostedDecisionArtifact,
  capsuleContractFixture,
} from "./capsule-inspector.js";
import type { HostedScanResult } from "./scan-workflow.js";
import "./capsule-inspector.css";

interface CapsuleInspectorProps {
  readonly result?: HostedScanResult;
}

type CapsuleTab = "live" | "fixture";

export function CapsuleInspector({ result }: CapsuleInspectorProps) {
  const [tab, setTab] = useState<CapsuleTab>("live");
  const liveArtifact = useMemo(
    () => (result === undefined ? undefined : buildHostedDecisionArtifact(result)),
    [result],
  );
  const shown = tab === "live" ? liveArtifact : capsuleContractFixture;

  return (
    <section className="capsule-inspector panel" aria-labelledby="capsule-inspector-heading">
      <div className="panel-kicker">
        <span>5</span> CONTEXT CAPSULE + PROVENANCE
      </div>

      <div className="capsule-inspector__heading">
        <div>
          <p className="eyebrow">What crosses the trust boundary</p>
          <h2 id="capsule-inspector-heading">
            Inspect the security artifact an agent can reason over.
          </h2>
          <p>
            The hosted demo returns a real scan decision but does not sign it. The production
            contract adds claims, evidence, policy identity, component versions, and an Ed25519
            signature so consumers can verify integrity and provenance independently.
          </p>
        </div>
        <div className="capsule-inspector__tabs" role="tablist" aria-label="Capsule artifact">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "live"}
            className={tab === "live" ? "is-active" : undefined}
            onClick={() => setTab("live")}
          >
            Live decision
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "fixture"}
            className={tab === "fixture" ? "is-active" : undefined}
            onClick={() => setTab("fixture")}
          >
            Capsule v1 fixture
          </button>
        </div>
      </div>

      {tab === "live" ? (
        liveArtifact ? (
          <LiveArtifact artifact={liveArtifact} />
        ) : (
          <div className="capsule-inspector__empty">
            Run a live comparison above to populate the hosted decision artifact.
          </div>
        )
      ) : (
        <FixtureArtifact />
      )}

      {shown ? (
        <details className="capsule-inspector__raw">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify(shown, null, 2)}</pre>
        </details>
      ) : null}

      <p className="capsule-inspector__note">
        A signature proves artifact integrity and Verus provenance; it does not prove that a
        real-world financial claim is objectively true.
      </p>
    </section>
  );
}

function LiveArtifact({
  artifact,
}: {
  readonly artifact: ReturnType<typeof buildHostedDecisionArtifact>;
}) {
  return (
    <div className="capsule-inspector__artifact">
      <div className="capsule-inspector__status capsule-inspector__status--unsigned">
        <span>UNSIGNED HOSTED ARTIFACT</span>
        <strong>{artifact.disposition.toUpperCase()}</strong>
        <p>Real Vercel scan output · no cryptographic signature is claimed.</p>
      </div>

      <div className="capsule-inspector__grid">
        <article>
          <small>Input integrity</small>
          <strong>{shortDigest(artifact.input_digest)}</strong>
          <p>The digest binds this decision to the exact submitted input.</p>
        </article>
        <article>
          <small>Policy / ruleset</small>
          <strong>{artifact.rule_set.version}</strong>
          <p>{shortDigest(artifact.rule_set.digest)}</p>
        </article>
        <article>
          <small>Findings</small>
          <strong>{artifact.findings.length}</strong>
          <p>
            {artifact.findings.length === 0
              ? "No configured manipulation rule matched."
              : artifact.findings.map((finding) => finding.reasonCode).join(" · ")}
          </p>
        </article>
        <article>
          <small>Provenance state</small>
          <strong>Unsigned</strong>
          <p>Use the full worker/capsule path for persisted signed Context Capsules.</p>
        </article>
      </div>
    </div>
  );
}

function FixtureArtifact() {
  return (
    <div className="capsule-inspector__artifact">
      <div className="capsule-inspector__status capsule-inspector__status--fixture">
        <span>SCHEMA-VALID CONTRACT FIXTURE</span>
        <strong>{capsuleContractFixture.disposition.toUpperCase()}</strong>
        <p>
          Mirrors the checked-in v1 capsule fixture; signature fields are illustrative fixture data,
          not a live verification result.
        </p>
      </div>

      <div className="capsule-inspector__grid">
        <article>
          <small>Verified claims</small>
          <strong>{capsuleContractFixture.claims.length}</strong>
          <p>{capsuleContractFixture.claims[0]?.statement}</p>
        </article>
        <article>
          <small>Evidence</small>
          <strong>{capsuleContractFixture.evidence[0]?.source_tier}</strong>
          <p>
            {capsuleContractFixture.evidence[0]?.identity_state} ·{" "}
            {capsuleContractFixture.evidence[0]?.freshness}
          </p>
        </article>
        <article>
          <small>Policy</small>
          <strong>v{capsuleContractFixture.policy.version}</strong>
          <p>{shortDigest(capsuleContractFixture.policy.digest)}</p>
        </article>
        <article>
          <small>Signature contract</small>
          <strong>{capsuleContractFixture.signature.algorithm}</strong>
          <p>Key: {capsuleContractFixture.signature.key_id}</p>
        </article>
      </div>
    </div>
  );
}

function shortDigest(value: string): string {
  return value.length <= 28 ? value : value.slice(0, 18) + "…" + value.slice(-8);
}
