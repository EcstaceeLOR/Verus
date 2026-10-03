import { useCallback, useEffect, useState } from "react";

import { ScanWorkspace } from "./ScanWorkspace.js";
import { statusCopy, type ConnectionState } from "./status.js";

type View = "overview" | "scan";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [view, setView] = useState<View>("overview");
  const status = statusCopy(connection);

  const checkConnection = useCallback(async (): Promise<void> => {
    setConnection("checking");
    try {
      const response = await fetch("/api/health", {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      setConnection(response.ok ? "ready" : "unavailable");
    } catch {
      setConnection("unavailable");
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Verus navigation">
        <div className="wordmark">
          <span aria-hidden="true">V</span> Verus
        </div>
        <p className="workspace-name">Context firewall</p>
        <nav>
          <ul className="navigation-list">
            <li>
              <button
                type="button"
                aria-current={view === "overview" ? "page" : undefined}
                className="nav-button"
                onClick={() => setView("overview")}
              >
                Overview
              </button>
            </li>
            <li>
              <button
                type="button"
                aria-current={view === "scan" ? "page" : undefined}
                className="nav-button"
                onClick={() => setView("scan")}
              >
                Scan context
              </button>
            </li>
          </ul>
        </nav>
        <p className="privacy-note">Submitted text is processed in memory and is not stored.</p>
      </aside>
      <main id="content" className="content" tabIndex={-1}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{view === "overview" ? "Context firewall" : "Hosted scanner"}</p>
            <h1>
              {view === "overview"
                ? "Inspect trading context before an agent trusts it."
                : "Scan untrusted context."}
            </h1>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void checkConnection()}
            disabled={connection === "checking"}
          >
            {connection === "checking" ? "Checking…" : "Check service"}
          </button>
        </header>
        <section
          className={`connection-status connection-status--${connection}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" className="status-dot" />
          <strong>{status.label}</strong>
          <span>{status.message}</span>
        </section>
        {view === "overview" ? (
          <div className="overview-grid">
            <section className="panel panel--wide hero-panel" aria-labelledby="start-heading">
              <p className="eyebrow">Ready now</p>
              <h2 id="start-heading">Run a real deterministic inspection.</h2>
              <p>
                Paste untrusted market commentary, research, or retrieved text. Verus checks for
                instruction overrides, tool coercion, source impersonation, and credential theft.
              </p>
              <button className="primary-action" type="button" onClick={() => setView("scan")}>
                Scan context
              </button>
            </section>
            <section className="panel" aria-labelledby="results-heading">
              <p className="eyebrow">Clear output</p>
              <h2 id="results-heading">Allow, review, or block</h2>
              <p className="panel-copy">
                Every result includes reason codes, source locations, and reproducible SHA-256
                digests without echoing submitted text.
              </p>
            </section>
            <section className="panel security-note" aria-labelledby="security-heading">
              <p className="eyebrow">Security default</p>
              <h2 id="security-heading">No exchange credentials</h2>
              <p className="panel-copy">
                This scanner cannot place trades, move funds, or access your exchange account.
              </p>
            </section>
          </div>
        ) : (
          <ScanWorkspace />
        )}
      </main>
    </div>
  );
}
