import { useState } from "react";
import { safeFinding, type SafeFinding } from "./review-state.js";
const example = safeFinding({
  id: "finding_example",
  category: "hidden_content",
  severity: "high",
  location: "Document offset 184",
  reason: "HIDDEN_CONTENT_DETECTED",
});
const sample: readonly SafeFinding[] = example === undefined ? [] : [example];
export function ReviewWorkspace() {
  const [findings] = useState(sample);
  return (
    <section className="panel" aria-labelledby="findings-heading">
      <p className="eyebrow">Security findings</p>
      <h2 id="findings-heading">Review required context</h2>
      <p className="field-help">
        Locations are descriptive only. Source material is never rendered here.
      </p>
      <ul className="scan-list">
        {findings.map((f) => (
          <li key={f.id}>
            <div>
              <strong>{f.category}</strong>
              <p>
                {f.location} · {f.reason}
              </p>
            </div>
            <span className={`scan-stage scan-stage--${f.severity}`}>{f.severity}</span>
          </li>
        ))}
      </ul>
      <p className="complete-note">
        Resolution requires an authorized reviewer and creates an immutable audit event.
      </p>
    </section>
  );
}
