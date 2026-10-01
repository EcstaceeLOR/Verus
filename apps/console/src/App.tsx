import { useState } from "react";

import { statusCopy, type ConnectionState } from "./status.js";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const status = statusCopy(connection);

  async function checkConnection(): Promise<void> {
    setConnection("checking");
    try {
      const response = await fetch("/api/health/ready", {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      setConnection(response.ok ? "ready" : "unavailable");
    } catch {
      setConnection("unavailable");
    }
  }

  return (
    <main className="shell">
      <section className="card" aria-labelledby="page-title">
        <div className="brand" aria-label="Verus">
          V
        </div>
        <p className="eyebrow">Context firewall</p>
        <h1 id="page-title">Verus</h1>
        <p className="lede">Safe, verified context before it reaches your trading agent.</p>

        <div className={`status status--${connection}`} role="status" aria-live="polite">
          <span className="status__dot" aria-hidden="true" />
          <div>
            <strong>{status.label}</strong>
            <p>{status.message}</p>
          </div>
        </div>

        <button
          className="primary-action"
          type="button"
          disabled={connection === "checking"}
          onClick={() => void checkConnection()}
        >
          {connection === "checking" ? "Checking…" : "Check connection"}
        </button>
      </section>
    </main>
  );
}
