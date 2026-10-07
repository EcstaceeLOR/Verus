import { useEffect, useState } from "react";

import { formatBps, safeBenchmarkResponse, type BenchmarkResponse } from "./benchmark-proof.js";
import "./benchmark-proof.css";

export function BenchmarkProof() {
  const [data, setData] = useState<BenchmarkResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/benchmark", {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Benchmark proof is unavailable.");
        const parsed = safeBenchmarkResponse((await response.json()) as unknown);
        if (parsed === undefined) throw new Error("Benchmark proof returned invalid data.");
        setData(parsed);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Benchmark proof is unavailable.");
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <div className="benchmark-page">
      <header className="benchmark-page__header">
        <p className="eyebrow">
          <span /> Reproducible security evidence
        </p>
        <h1>Proof, with the denominator attached.</h1>
        <p>
          Verus publishes the exact frozen corpus, evaluator, release thresholds, and limitations
          behind these numbers. The dashboard computes the current results from checked-in corpus
          data instead of embedding marketing percentages in the UI.
        </p>
      </header>

      {error ? (
        <section className="benchmark-proof panel">
          <div className="benchmark-proof__error" role="status">
            {error}
          </div>
        </section>
      ) : data === undefined ? (
        <section className="benchmark-proof panel">
          <div className="benchmark-proof__loading" aria-live="polite">
            Evaluating the frozen deterministic corpus…
          </div>
        </section>
      ) : (
        <BenchmarkResult data={data} />
      )}
    </div>
  );
}

function BenchmarkResult({ data }: { readonly data: BenchmarkResponse }) {
  const attackResult = `${data.results.attack_hits} / ${data.denominators.attacks}`;
  const falsePositiveResult = `${data.results.false_positives} / ${data.denominators.benign}`;
  const allCategoryRecall = data.results.categories.every(
    (category) => category.recall_bps === 10_000,
  );

  return (
    <section className="benchmark-proof panel" aria-labelledby="benchmark-proof-heading">
      <div className="panel-kicker">
        <span>6</span> FROZEN CORPUS V1
      </div>

      <div className="benchmark-proof__heading">
        <div>
          <p className="eyebrow">Computed from checked-in evaluation data</p>
          <h2 id="benchmark-proof-heading">Minimum regression evidence, not universal coverage.</h2>
          <p>
            The frozen set contains {data.denominators.attacks} attack samples and{" "}
            {data.denominators.benign} benign control. Every result below is scoped to those{" "}
            {data.denominators.frozen_test} synthetic samples.
          </p>
        </div>
        <span className={"benchmark-proof__gate " + (data.gates.pass ? "is-pass" : "is-fail")}>
          {data.gates.pass ? "RELEASE GATE PASS" : "RELEASE GATE FAIL"}
        </span>
      </div>

      <div className="benchmark-proof__metrics">
        <article className="benchmark-metric benchmark-metric--result">
          <small>Frozen attack detection</small>
          <strong>{attackResult}</strong>
          <p>{formatBps(data.results.attack_block_rate_bps)} on this frozen attack denominator.</p>
        </article>
        <article className="benchmark-metric benchmark-metric--result">
          <small>Frozen benign false positives</small>
          <strong>{falsePositiveResult}</strong>
          <p>
            {formatBps(data.results.benign_false_positive_bps)} on the frozen benign denominator.
          </p>
        </article>
        <article className="benchmark-metric benchmark-metric--result">
          <small>Represented category recall</small>
          <strong>{allCategoryRecall ? "100%" : "Mixed"}</strong>
          <p>Each represented category has its own denominator below.</p>
        </article>
        <article className="benchmark-metric benchmark-metric--scope">
          <small>Frozen denominator</small>
          <strong>{data.denominators.frozen_test} samples</strong>
          <p>
            {data.denominators.attacks} adversarial + {data.denominators.benign} benign synthetic
            control.
          </p>
        </article>
        <article className="benchmark-metric benchmark-metric--gate">
          <small>Deterministic runtime</small>
          <strong>{data.results.evaluator_runtime_ms} ms</strong>
          <p>
            This request&apos;s evaluator loop; release gate ≤{" "}
            {data.gates.maximum_deterministic_runtime_ms} ms. Not end-to-end API latency.
          </p>
        </article>
        <article className="benchmark-metric benchmark-metric--scope">
          <small>Model-assisted benchmark</small>
          <strong>Not measured</strong>
          <p>{data.results.model_assisted.reason}.</p>
        </article>
      </div>

      <div className="benchmark-proof__comparison">
        <div>
          <small>NO VERUS TRUST BOUNDARY</small>
          <strong>
            {data.protected_vs_baseline.baseline_raw_attack_exposure} /{" "}
            {data.protected_vs_baseline.baseline_total_attacks} attack contexts exposed
          </strong>
          <p>Raw retrieved text crosses into inference without this detector gate.</p>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <small>FROZEN DETERMINISTIC GATE</small>
          <strong>
            {data.protected_vs_baseline.protected_flagged_before_inference} /{" "}
            {data.protected_vs_baseline.baseline_total_attacks} flagged before inference
          </strong>
          <p>
            {data.protected_vs_baseline.protected_automatic_attack_exposure} frozen attack samples
            remain automatically exposed under this regression evaluator.
          </p>
        </div>
      </div>

      <div className="benchmark-proof__lower">
        <div className="benchmark-proof__categories">
          <h3>Category recall</h3>
          <p>
            These are regression checks. With one sample in each represented category, 100% means
            one detected sample out of one—not broad empirical coverage.
          </p>
          <ul>
            {data.results.categories.map((category) => (
              <li key={category.category}>
                <span>{category.category.replaceAll("_", " ")}</span>
                <strong>{formatBps(category.recall_bps)}</strong>
                <small>
                  {category.detected}/{category.samples}
                </small>
              </li>
            ))}
          </ul>
        </div>

        <div className="benchmark-proof__reproduce">
          <h3>Reproduce it</h3>
          <code>{data.source.reproduction}</code>
          <dl>
            <div>
              <dt>Samples</dt>
              <dd>{data.source.samples}</dd>
            </div>
            <div>
              <dt>Evaluator</dt>
              <dd>{data.source.evaluator}</dd>
            </div>
            <div>
              <dt>Report</dt>
              <dd>{data.source.report}</dd>
            </div>
            <div>
              <dt>Thresholds</dt>
              <dd>{data.source.thresholds}</dd>
            </div>
          </dl>
          <div className="benchmark-proof__thresholds">
            <small>RELEASE THRESHOLDS</small>
            <span>Attack block ≥ {formatBps(data.gates.minimum_attack_block_rate_bps)}</span>
            <span>
              Benign false positive ≤ {formatBps(data.gates.maximum_benign_false_positive_bps)}
            </span>
            <span>
              Per-category recall ≥ {formatBps(data.gates.minimum_per_category_recall_bps)}
            </span>
          </div>
        </div>
      </div>

      <div className="benchmark-proof__limitations">
        <strong>Limitations are part of the result.</strong>
        <ul>
          {data.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
