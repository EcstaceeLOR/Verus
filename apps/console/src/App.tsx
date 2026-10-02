import { useMemo, useState } from "react";

import {
  canOpen,
  nextOnboardingAction,
  onboardingSteps,
  type ConsoleView,
  type WorkspaceRole,
} from "./console-state.js";
import { ScanWorkspace } from "./ScanWorkspace.js";
import { ReviewWorkspace } from "./ReviewWorkspace.js";
import { statusCopy, type ConnectionState } from "./status.js";

const navigation: readonly { readonly id: ConsoleView; readonly label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "scans", label: "Scans" },
  { id: "evidence", label: "Evidence" },
  { id: "policies", label: "Policies" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [role, setRole] = useState<WorkspaceRole>("owner");
  const [view, setView] = useState<ConsoleView>("overview");
  const [workspaceName, setWorkspaceName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [hasMember, setHasMember] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasSample, setHasSample] = useState(false);
  const status = statusCopy(connection);
  const steps = useMemo(
    () => onboardingSteps({ hasWorkspace, hasMember, hasApiKey, hasSample }),
    [hasApiKey, hasMember, hasSample, hasWorkspace],
  );
  const nextStep = nextOnboardingAction(steps);

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

  function selectView(nextView: ConsoleView): void {
    if (canOpen(role, nextView)) setView(nextView);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="wordmark">
          <span aria-hidden="true">V</span> Verus
        </div>
        <p className="workspace-name">{hasWorkspace ? workspaceName : "Personal workspace"}</p>
        <nav>
          <ul className="navigation-list">
            {navigation.map((item) => {
              const permitted = canOpen(role, item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={view === item.id ? "page" : undefined}
                    className="nav-button"
                    disabled={!permitted}
                    onClick={() => selectView(item.id)}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <label className="role-select">
          <span>Preview role</span>
          <select
            value={role}
            onChange={(event) => {
              const nextRole = event.target.value as WorkspaceRole;
              setRole(nextRole);
              if (!canOpen(nextRole, view)) setView("overview");
            }}
          >
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="analyst">Analyst</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
      </aside>
      <main id="content" className="content" tabIndex={-1}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{view === "overview" ? "Workspace" : view}</p>
            <h1>
              {view === "overview"
                ? "A calmer way to inspect trading context."
                : navigation.find((item) => item.id === view)?.label}
            </h1>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void checkConnection()}
            disabled={connection === "checking"}
          >
            {connection === "checking" ? "Checking…" : "Check API"}
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
            <section className="panel panel--wide" aria-labelledby="start-heading">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Getting started</p>
                  <h2 id="start-heading">Set up Verus safely</h2>
                </div>
                <span className="progress-label">
                  {steps.filter((step) => step.complete).length}/4 complete
                </span>
              </div>
              <ol className="onboarding-list">
                {steps.map((step) => (
                  <li key={step.id} className={step.complete ? "is-complete" : undefined}>
                    <span className="step-marker" aria-hidden="true">
                      {step.complete ? "✓" : ""}
                    </span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {nextStep?.id === "workspace" ? (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (workspaceName.trim()) setHasWorkspace(true);
                  }}
                >
                  <label>
                    <span className="sr-only">Workspace name</span>
                    <input
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      placeholder="Workspace name"
                      required
                    />
                  </label>
                  <button className="primary-action" type="submit">
                    Create workspace
                  </button>
                </form>
              ) : nextStep?.id === "members" ? (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (memberEmail.trim()) setHasMember(true);
                  }}
                >
                  <label>
                    <span className="sr-only">Teammate email</span>
                    <input
                      type="email"
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      placeholder="teammate@company.com"
                      required
                    />
                  </label>
                  <button className="primary-action" type="submit">
                    Send invite
                  </button>
                </form>
              ) : nextStep?.id === "api-key" ? (
                <button className="primary-action" type="button" onClick={() => setHasApiKey(true)}>
                  I added a scoped key
                </button>
              ) : nextStep?.id === "sample" ? (
                <button className="primary-action" type="button" onClick={() => setHasSample(true)}>
                  Open safe sample
                </button>
              ) : (
                <p className="complete-note">
                  Your workspace is ready. Start with a scan when you are ready.
                </p>
              )}
            </section>
            <section className="panel" aria-labelledby="labels-heading">
              <p className="eyebrow">At a glance</p>
              <h2 id="labels-heading">Read the labels</h2>
              <dl className="label-guide">
                <div>
                  <dt>Product</dt>
                  <dd>What Verus is doing.</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>Where context came from.</dd>
                </div>
                <div>
                  <dt>Verdict</dt>
                  <dd>Whether it is safe for an agent.</dd>
                </div>
              </dl>
            </section>
            <section className="panel security-note" aria-labelledby="security-heading">
              <p className="eyebrow">Security default</p>
              <h2 id="security-heading">Read-only, always</h2>
              <p>
                Verus never needs write-enabled exchange credentials. Use scoped Verus API keys and
                read-only connections only.
              </p>
            </section>
          </div>
        ) : view === "scans" ? (
          <ScanWorkspace />
        ) : view === "evidence" ? (
          <ReviewWorkspace />
        ) : (
          <section className="panel empty-state" aria-labelledby="empty-heading">
            <p className="eyebrow">{view}</p>
            <h2 id="empty-heading">Nothing to show yet</h2>
            <p>Complete setup, then return here to work with verified context.</p>
            <button
              className="secondary-action"
              type="button"
              onClick={() => selectView("overview")}
            >
              Back to overview
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
