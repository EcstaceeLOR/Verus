import { attackScenarios, type AttackScenario } from "./attack-lab.js";
import "./attack-lab.css";

interface AttackLabProps {
  readonly onLoadScenario: (scenario: AttackScenario) => void;
}

export function AttackLab({ onLoadScenario }: AttackLabProps) {
  return (
    <section className="attack-lab panel" aria-labelledby="attack-lab-heading">
      <div className="panel-kicker">
        <span>4</span> ATTACK LAB
      </div>

      <div className="attack-lab__heading">
        <div>
          <p className="eyebrow">Adversarial financial context</p>
          <h2 id="attack-lab-heading">Test more than the obvious “ignore instructions” attack.</h2>
          <p>
            Live scenarios run through the public hosted detector above. Pipeline scenarios document
            threat classes implemented by the broader Verus architecture and are deliberately not
            presented as live hosted detections.
          </p>
        </div>
        <div className="attack-lab__legend" aria-label="Attack lab capability legend">
          <span>
            <i className="attack-lab__dot attack-lab__dot--live" /> Live hosted
          </span>
          <span>
            <i className="attack-lab__dot attack-lab__dot--pipeline" /> Full pipeline
          </span>
        </div>
      </div>

      <div className="attack-lab__grid">
        {attackScenarios.map((scenario) => (
          <article key={scenario.id} className={"attack-card attack-card--" + scenario.support}>
            <div className="attack-card__meta">
              <span>{scenario.category}</span>
              <strong>
                <i className={"attack-lab__dot attack-lab__dot--" + scenario.support} />
                {scenario.support === "live" ? "LIVE" : "PIPELINE"}
              </strong>
            </div>
            <h3>{scenario.title}</h3>
            <p>{scenario.explanation}</p>
            <div className="attack-card__expected">
              <small>EXPECTED SECURITY BEHAVIOR</small>
              <strong>
                {scenario.expected === "pipeline-review"
                  ? "Canonicalize + verify before trust"
                  : scenario.expected.toUpperCase()}
              </strong>
            </div>
            {scenario.support === "live" ? (
              <button
                className="secondary-action"
                type="button"
                onClick={() => onLoadScenario(scenario)}
              >
                Load into live demo →
              </button>
            ) : (
              <div className="attack-card__pipeline-note">
                Not executed by the lightweight hosted phrase scanner.
              </div>
            )}
          </article>
        ))}
      </div>

      <p className="attack-lab__note">
        The Attack Lab is a defensive evaluation surface. Scenarios are intentionally bounded to
        testing Verus&apos;s context-safety controls and do not grant tools, credentials, or trading
        authority.
      </p>
    </section>
  );
}
