import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  canCancel,
  canRetry,
  safeHistory,
  safePreview,
  scanStageLabel,
  type ScanInputKind,
  type ScanSummary,
} from "./scan-workflow.js";

const HISTORY_KEY = "verus.console.scan-history.v1";
const maxTextBytes = 1_000_000;

function identifier(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function loadHistory(): readonly ScanSummary[] {
  try {
    return safeHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown);
  } catch {
    return [];
  }
}

function persist(scans: readonly ScanSummary[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(scans));
}
function isStage(value: unknown): value is ScanSummary["stage"] {
  return (
    typeof value === "string" &&
    [
      "accepted",
      "queued",
      "processing",
      "review",
      "allowed",
      "blocked",
      "cancelled",
      "failed",
    ].includes(value)
  );
}

export function ScanWorkspace() {
  const [kind, setKind] = useState<ScanInputKind>("url");
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<readonly ScanSummary[]>(loadHistory);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    persist(history);
  }, [history]);
  const shown = useMemo(
    () =>
      history.filter((scan) =>
        `${scan.id} ${scan.preview} ${scan.stage}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [history, query],
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    if (!value.trim())
      return setError(kind === "url" ? "Enter a URL to inspect." : "Enter text to inspect.");
    if (kind === "url") {
      try {
        new URL(value);
      } catch {
        return setError("Enter a complete http or https URL.");
      }
    }
    if (kind === "text" && new TextEncoder().encode(value).byteLength > maxTextBytes)
      return setError("Text is limited to 1 MB.");
    const workspaceId = localStorage.getItem("verus.console.workspace-id");
    if (!workspaceId) return setError("Connect a workspace before submitting a scan.");
    const idempotencyKey = identifier("console");
    try {
      const response = await fetch("/api/v1/ingestions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          schema_version: "1.0",
          request_id: identifier("request"),
          workspace_id: workspaceId,
          submitted_at: new Date().toISOString(),
          idempotency_key: idempotencyKey,
          provenance: { source_class: "user_supplied", submitted_by: "console_session" },
          input:
            kind === "url" ? { kind, url: value } : { kind, text: value, media_type: "text/plain" },
          extensions: {},
        }),
      });
      const result = (await response.json()) as {
        scan_id?: unknown;
        state?: unknown;
        title?: unknown;
      };
      if (!response.ok || typeof result.scan_id !== "string")
        throw new Error(
          typeof result.title === "string" ? result.title : "Verus could not accept this scan.",
        );
      const scan: ScanSummary = {
        id: result.scan_id,
        kind,
        preview: safePreview(kind, value),
        stage: isStage(result.state) ? result.state : "accepted",
        submittedAt: new Date().toISOString(),
        idempotencyKey,
      };
      setHistory((current) => [scan, ...current.filter((item) => item.id !== scan.id)]);
      setValue("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verus could not accept this scan.");
    }
  }

  async function cancel(scan: ScanSummary): Promise<void> {
    try {
      const response = await fetch(`/api/v1/scans/${encodeURIComponent(scan.id)}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Verus could not cancel this scan.");
      setHistory((items) =>
        items.map((item) => (item.id === scan.id ? { ...item, stage: "cancelled" } : item)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verus could not cancel this scan.");
    }
  }
  async function retry(scan: ScanSummary): Promise<void> {
    try {
      const response = await fetch(`/api/v1/scans/${encodeURIComponent(scan.id)}/retry`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "idempotency-key": scan.idempotencyKey },
      });
      if (!response.ok) throw new Error("Verus could not retry this scan.");
      setHistory((items) =>
        items.map((item) => (item.id === scan.id ? { ...item, stage: "accepted" } : item)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verus could not retry this scan.");
    }
  }

  return (
    <div className="scan-workspace">
      <section className="panel scan-submit" aria-labelledby="scan-heading">
        <p className="eyebrow">New scan</p>
        <h2 id="scan-heading">Inspect context before your agent sees it.</h2>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset>
            <legend className="sr-only">Submission type</legend>
            {(["url", "text"] as const).map((option) => (
              <label className="input-choice" key={option}>
                <input type="radio" checked={kind === option} onChange={() => setKind(option)} />
                {option === "url" ? "URL" : "Text"}
              </label>
            ))}
          </fieldset>
          <label className="scan-input">
            <span className="sr-only">{kind === "url" ? "URL" : "Text to scan"}</span>
            {kind === "url" ? (
              <input
                type="url"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="https://example.com/context"
              />
            ) : (
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                rows={5}
                placeholder="Paste text to inspect"
              />
            )}
          </label>
          {kind === "text" ? (
            <p className="field-help">Up to 1 MB. Submitted text is never shown in history.</p>
          ) : (
            <p className="field-help">Only http and https URLs are supported.</p>
          )}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-action" type="submit">
            Start scan
          </button>
        </form>
      </section>
      <section className="panel scan-history" aria-labelledby="history-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2 id="history-heading">Recent scans</h2>
          </div>
          <label className="search-field">
            <span className="sr-only">Search scans</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
            />
          </label>
        </div>
        {shown.length === 0 ? (
          <p className="empty-copy">No scans match this view.</p>
        ) : (
          <ul className="scan-list">
            {shown.map((scan) => (
              <li key={scan.id}>
                <div>
                  <strong>{scan.preview}</strong>
                  <p>
                    {new Date(scan.submittedAt).toLocaleString()} · {scan.id}
                  </p>
                </div>
                <div className="scan-actions">
                  <span className={`scan-stage scan-stage--${scan.stage}`}>
                    {scanStageLabel(scan.stage)}
                  </span>
                  {canCancel(scan.stage) ? (
                    <button type="button" className="text-action" onClick={() => void cancel(scan)}>
                      Cancel
                    </button>
                  ) : null}
                  {canRetry(scan) ? (
                    <button type="button" className="text-action" onClick={() => void retry(scan)}>
                      Retry
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
