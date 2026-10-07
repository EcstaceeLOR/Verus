import {
  benchmarkCategoryResults,
  benchmarkMetrics,
  benchmarkProvenance,
} from "./benchmark-proof.js";
import "./benchmark-proof.css";

export function BenchmarkProof() {
  return (
    <section className="benchmark-proof panel" aria-labelledby="benchmark-proof-heading">
      <div className="panel-kicker">
        <span>6</span> REPRODUCIBLE SECURITY PROOF
      </div>

      <div className="benchmark-proof__heading">
        <div>
          <p className="eyebrow">Frozen corpus · no marketing math</p>
          <h2 id="benchmark-proof-heading">Security claims backed by checked-in evaluation data.</h2>
          <p>
            These values come from Verus&apos;s frozen v1 deterministic corpus and its repository
            evaluator. Numbers that are not present as reproducible results are shown as thresholds
            or explicitly marked not measured.
          </p>
        </div>
        <span className="benchmark-proof__version">CORPUS {benchmarkProvenance.corpusVersion}</span>
      </div>

      <div className="benchmark-proof__metrics">
        {benchmarkMetrics.map((metric) => (
          <article key={metric.label} className={"benchmark-metric benchmark-metric--" + metric.kind}>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
          </article>
        ))}
      </div>

      <div className="benchmark-proof__lower">
        <div className="benchmark-proof__categories">
          <h3>Frozen category recall</h3>
          <p>
            Each represented attack category currently has one frozen sample, so these percentages
            are regression checks—not estimates of real-world detection quality.
          </p>
          <ul>
            {benchmarkCategoryResults.map((category) => (
              <li key={category.category}>
                <span>{category.category}</span>
                <strong>{category.recall}</strong>
                <small>n={category.samples}</small>
              </li>
            ))}
          </ul>
        </div>

        <div className="benchmark-proof__reproduce">
          <h3>Reproduce it</h3>
          <code>{benchmarkProvenance.reproduction}</code>
          <dl>
            <div>
              <dt>Evaluation report</dt>
              <dd>{benchmarkProvenance.reportPath}</dd>
            </div>
            <div>
              <dt>Frozen samples</dt>
              <dd>{benchmarkProvenance.samplesPath}</dd>
            </div>
            <div>
              <dt>Evaluator</dt>
              <dd>{benchmarkProvenance.evaluatorPath}</dd>
            </div>
            <div>
              <dt>Thresholds</dt>
              <dd>{benchmarkProvenance.thresholdsPath}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="benchmark-proof__limitation">
        <strong>What this does not prove</strong>
        <p>
          Four synthetic frozen samples cannot estimate real-world attack prevalence, every language
          or mutation, model-provider quality, uptime, financial accuracy, or universal prompt
          injection resistance. This dashboard is a minimum reproducible regression result, not a
          claim that Verus catches every attack.
        </p>
      </div>
    </section>
  );
}
