import { useEffect, useState } from "react";

import {
  hostedCapsuleRequest,
  safeSignedDemoCapsule,
  type SignedDemoCapsuleResponse,
} from "./capsule-inspector.js";
import type { HostedScanResult } from "./scan-workflow.js";
import "./capsule-inspector.css";

interface CapsuleInspectorProps {
  readonly result: HostedScanResult | undefined;
}

type InspectorTab = "readable" | "raw";

export function CapsuleInspector({ result }: CapsuleInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("readable");
  const [data, setData] = useState<SignedDemoCapsuleResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setData(undefined);
    setError(undefined);
    if (result === undefined) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/context-capsule", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(hostedCapsuleRequest(result)),
          signal: controller.signal,
        });
        const body = (await response.json()) as unknown;
        if (!response.ok) throw new Error("Verus could not create the demo Context Capsule.");
        const parsed = safeSignedDemoCapsule(body);
        if (parsed === undefined)
          throw new Error("Verus returned an invalid signed capsule response.");
        setData(parsed);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Verus could not create the demo Context Capsule.",
        );
      }
    })();

    return () => controller.abort();
  }, [result]);

  return (
    <section className="capsule-inspector panel" aria-labelledby="capsule-inspector-heading">
      <div className="panel-kicker">
        <span>5</span> CONTEXT CAPSULE + PROVENANCE
      </div>

      <div className="capsule-inspector__heading">
        <div>
          <p className="eyebrow">What an agent is allowed to consume</p>
          <h2 id="capsule-inspector-heading">
            Inspect the signed artifact created after the trust decision.
          </h2>
          <p>
            The live hosted scan itself is not cryptographically signed. This panel derives a
            separate Context Capsule from that scan&apos;s digest, disposition, findings, and
            ruleset metadata, then signs and verifies the capsule using Verus&apos;s production
            Ed25519 capsule code.
          </p>
        </div>
        <div className="capsule-inspector__tabs" role="tablist" aria-label="Capsule view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "readable"}
            className={tab === "readable" ? "is-active" : undefined}
            onClick={() => setTab("readable")}
          >
            Readable
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "raw"}
            className={tab === "raw" ? "is-active" : undefined}
            onClick={() => setTab("raw")}
          >
            Raw JSON
          </button>
        </div>
      </div>

      {result === undefined ? (
        <div className="capsule-inspector__empty">
          Run the agent comparison above to create a capsule from the current live scan.
        </div>
      ) : error ? (
        <div className="capsule-inspector__error" role="status">
          {error}
        </div>
      ) : data === undefined ? (
        <div className="capsule-inspector__empty" aria-live="polite">
          Signing and verifying a demo Context Capsule…
        </div>
      ) : tab === "raw" ? (
        <pre className="capsule-inspector__raw-json">{JSON.stringify(data, null, 2)}</pre>
      ) : (
        <ReadableCapsule data={data} />
      )}

      <div className="capsule-inspector__truth">
        <strong>Integrity is not factual truth.</strong>
        <p>
          A valid signature proves that this capsule has not changed since it was signed by the
          displayed demo key. It does not prove that a real-world financial statement is true, and
          the ephemeral demo key is not presented as a production-attested Verus identity.
        </p>
      </div>
    </section>
  );
}

function ReadableCapsule({ data }: { readonly data: SignedDemoCapsuleResponse }) {
  const capsule = data.capsule;
  const component = capsule.components[0];

  return (
    <div className="capsule-inspector__artifact">
      <div className="capsule-inspector__boundary">
        <div>
          <small>SOURCE SCAN</small>
          <strong>Unsigned hosted decision</strong>
          <p>{data.source_scan.hosted_scan_id}</p>
        </div>
        <span aria-hidden="true">→</span>
        <div className="capsule-inspector__boundary-signed">
          <small>DERIVED CONTEXT CAPSULE</small>
          <strong>{data.verification.valid ? "Signed + verified" : "Verification failed"}</strong>
          <p>{capsule.signature.algorithm} · ephemeral demo key</p>
        </div>
      </div>

      <div className="capsule-inspector__status">
        <div>
          <small>CAPSULE DISPOSITION</small>
          <strong>{capsule.disposition.toUpperCase()}</strong>
          <p>{capsule.capsule_id}</p>
        </div>
        <span className="capsule-inspector__verified">✓ SIGNATURE VALID</span>
      </div>

      <div className="capsule-inspector__grid">
        <article>
          <small>Input digest</small>
          <strong>{shortDigest(capsule.input_digest)}</strong>
          <p>Binds the capsule to the exact scanned input without retaining the source text.</p>
        </article>
        <article>
          <small>Security findings</small>
          <strong>{capsule.findings.length}</strong>
          <p>
            {capsule.findings.length === 0
              ? "No configured hosted attack rule matched."
              : capsule.findings.map((finding) => finding.reason_code).join(" · ")}
          </p>
        </article>
        <article>
          <small>Claims + evidence</small>
          <strong>
            {capsule.claims.length} claims · {capsule.evidence.length} evidence
          </strong>
          <p>The hosted detector performs context safety, not factual claim verification.</p>
        </article>
        <article>
          <small>Policy</small>
          <strong>v{capsule.policy.version}</strong>
          <p>{shortDigest(capsule.policy.digest)}</p>
        </article>
        <article>
          <small>Ruleset component</small>
          <strong>{component?.component ?? "hosted-detector"}</strong>
          <p>
            v{component?.version ?? "1.0.0"} ·{" "}
            {shortDigest(component?.digest ?? capsule.policy.digest)}
          </p>
        </article>
        <article>
          <small>Artifact digest</small>
          <strong>{shortDigest(data.verification.artifact_digest)}</strong>
          <p>Recomputed during signature verification.</p>
        </article>
        <article>
          <small>Signing key</small>
          <strong>{shortDigest(data.verification.key_id)}</strong>
          <p>Ephemeral per-request demo key · not production-attested.</p>
        </article>
        <article>
          <small>Signed at</small>
          <strong>{new Date(capsule.signature.signed_at).toLocaleString()}</strong>
          <p>Schema {capsule.schema_version}</p>
        </article>
      </div>

      {capsule.findings.length > 0 ? (
        <div className="capsule-inspector__findings">
          <h3>Security findings carried into the capsule</h3>
          <ul>
            {capsule.findings.map((finding, index) => (
              <li key={finding.detector_id + "-" + index}>
                <div>
                  <strong>{finding.reason_code}</strong>
                  <p>{finding.detector_id}</p>
                </div>
                <span>{finding.severity}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function shortDigest(value: string): string {
  return value.length <= 30 ? value : value.slice(0, 18) + "…" + value.slice(-8);
}
