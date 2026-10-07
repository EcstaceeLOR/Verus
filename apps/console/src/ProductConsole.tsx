import { useCallback, useEffect, useState, type FormEvent } from "react";

type Permission =
  "membership.invite" | "membership.manage" | "service_account.manage" | "workspace.read" | string;

interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly membershipStatus: string;
  readonly role: string;
}

interface MemberSummary {
  readonly membershipId: string;
  readonly role: string;
  readonly status: string;
  readonly joinedAt?: string;
}

interface InvitationSummary {
  readonly invitationId: string;
  readonly role: string;
  readonly status: string;
  readonly expiresAt: string;
}

interface ApiKeySummary {
  readonly keyId: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly status: string;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
}

interface ActiveWorkspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly role: string;
  readonly permissions: readonly Permission[];
  readonly members: readonly MemberSummary[];
  readonly invitations: readonly InvitationSummary[];
  readonly apiKeys: readonly ApiKeySummary[];
}

interface ControlPlaneState {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly activeWorkspace: ActiveWorkspace | null;
}

interface ApiKeyReveal {
  readonly apiKey: string;
  readonly keyId: string;
  readonly scopes: readonly string[];
}

interface ProductConsoleProps {
  readonly getToken: () => Promise<string | null>;
  readonly onOpenScanner: () => void;
}

const roles = ["admin", "policy_manager", "reviewer", "analyst", "auditor"] as const;

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function inviteFromLocation():
  { workspaceId: string; invitationId: string; token: string } | undefined {
  const value = new URLSearchParams(window.location.search).get("invite");
  if (value === null) return undefined;
  const [workspaceId, invitationId, token] = value.split(".");
  return workspaceId && invitationId && token ? { workspaceId, invitationId, token } : undefined;
}

export function ProductConsole({ getToken, onOpenScanner }: ProductConsoleProps) {
  const [state, setState] = useState<ControlPlaneState>();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [apiKeyReveal, setApiKeyReveal] = useState<ApiKeyReveal>();
  const active = state?.activeWorkspace;

  const request = useCallback(
    async <T,>(method: "GET" | "POST", body?: Readonly<Record<string, unknown>>): Promise<T> => {
      const token = await getToken();
      if (token === null) throw new Error("Your sign-in session expired. Sign in again.");
      const response = await fetch("/api/control-plane", {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(selectedWorkspaceId === undefined
            ? {}
            : { "x-verus-workspace-id": selectedWorkspaceId }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = (await response.json()) as unknown;
      if (!response.ok) {
        const message =
          typeof value === "object" &&
          value !== null &&
          typeof (value as Record<string, unknown>).message === "string"
            ? String((value as Record<string, unknown>).message)
            : "Verus could not complete this request.";
        throw new Error(message);
      }
      return value as T;
    },
    [getToken, selectedWorkspaceId],
  );

  const load = useCallback(async (): Promise<void> => {
    setError(undefined);
    try {
      const next = await request<ControlPlaneState>("GET");
      setState(next);
      const selected = next.activeWorkspace?.id ?? next.workspaces[0]?.id;
      if (selected !== undefined && selected !== selectedWorkspaceId)
        setSelectedWorkspaceId(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verus could not load your workspace.");
    }
  }, [request, selectedWorkspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const invite = inviteFromLocation();
    if (invite === undefined) return;
    let activeRequest = true;
    window.history.replaceState({}, "", window.location.pathname);
    setBusy(true);
    void request<{ workspaceId: string }>("POST", { action: "accept_invitation", ...invite })
      .then((result) => {
        if (!activeRequest) return;
        setSelectedWorkspaceId(result.workspaceId);
        return load();
      })
      .catch((reason: unknown) => {
        if (activeRequest)
          setError(
            reason instanceof Error ? reason.message : "The invitation could not be accepted.",
          );
      })
      .finally(() => {
        if (activeRequest) setBusy(false);
      });
    return () => {
      activeRequest = false;
    };
  }, [load, request]);

  async function mutate<T>(body: Readonly<Record<string, unknown>>): Promise<T | undefined> {
    setBusy(true);
    setError(undefined);
    try {
      return await request<T>("POST", body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verus could not complete this request.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await mutate<{ workspaceId: string }>({
      action: "create_workspace",
      name: String(form.get("name") ?? ""),
    });
    if (result !== undefined) {
      setSelectedWorkspaceId(result.workspaceId);
      await load();
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await mutate<{ inviteUrl: string }>({
      action: "create_invitation",
      email: String(form.get("email") ?? ""),
      role: String(form.get("role") ?? "reviewer"),
    });
    if (result !== undefined) {
      setInviteUrl(result.inviteUrl);
      event.currentTarget.reset();
      await load();
    }
  }

  async function createApiKey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await mutate<ApiKeyReveal>({
      action: "create_api_key",
      name: String(form.get("name") ?? ""),
    });
    if (result !== undefined) {
      setApiKeyReveal(result);
      event.currentTarget.reset();
      await load();
    }
  }

  async function changeMember(
    event: FormEvent<HTMLFormElement>,
    membershipId: string,
  ): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await mutate<{ updated: boolean }>({
      action: "change_membership",
      membershipId,
      role: String(form.get("role") ?? "reviewer"),
      status: String(form.get("status") ?? "active"),
    });
    if (result !== undefined) await load();
  }

  async function revokeApiKey(keyId: string): Promise<void> {
    const result = await mutate<{ revoked: boolean }>({ action: "revoke_api_key", keyId });
    if (result !== undefined) await load();
  }

  const canInvite = active?.permissions.includes("membership.invite") ?? false;
  const canManageMembers = active?.permissions.includes("membership.manage") ?? false;
  const canManageKeys = active?.permissions.includes("service_account.manage") ?? false;
  const completedSteps = 1 + (active?.apiKeys.length ? 1 : 0);

  if (state === undefined && error === undefined) {
    return (
      <ConsoleStatus title="Opening your workspace" detail="Checking identity and permissions…" />
    );
  }
  if (state === undefined) {
    return (
      <ConsoleStatus
        title="Workspace unavailable"
        detail={error ?? "Try again shortly."}
        retry={load}
      />
    );
  }
  if (active === null || active === undefined) {
    return (
      <section className="onboarding" aria-labelledby="onboarding-title">
        <div className="onboarding-copy">
          <p className="eyebrow">
            <span /> Private workspace
          </p>
          <h1 id="onboarding-title">Set up your trust boundary.</h1>
          <p>
            A workspace keeps your policies, teammates, scans, and evidence isolated. It takes less
            than a minute.
          </p>
          <ul className="trust-list">
            <li>
              <CheckIcon /> No exchange account required
            </li>
            <li>
              <CheckIcon /> No trading or withdrawal credentials
            </li>
            <li>
              <CheckIcon /> Every administrative action is audited
            </li>
          </ul>
        </div>
        <form className="setup-card" onSubmit={(event) => void createWorkspace(event)}>
          <span className="step-badge">1 of 1</span>
          <h2>Name your workspace</h2>
          <p>Use your team or agent name. You can invite people after setup.</p>
          <label htmlFor="workspace-name">Workspace name</label>
          <input id="workspace-name" name="name" minLength={2} maxLength={80} required autoFocus />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-action" disabled={busy} type="submit">
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </section>
    );
  }

  return (
    <div className="console-page">
      <header className="console-heading">
        <div>
          <p className="eyebrow">
            <span /> Workspace console
          </p>
          <h1>{active.name}</h1>
          <p>Protect what your trading agents read before it reaches a model or tool.</p>
        </div>
        <div className="workspace-control">
          <label htmlFor="workspace-select">Workspace</label>
          <select
            id="workspace-select"
            value={active.id}
            onChange={(event) => setSelectedWorkspaceId(event.target.value)}
          >
            {state.workspaces
              .filter((workspace) => workspace.membershipStatus === "active")
              .map((workspace) => (
                <option value={workspace.id} key={workspace.id}>
                  {workspace.name}
                </option>
              ))}
          </select>
          <span className="role-pill">{humanize(active.role)}</span>
        </div>
      </header>

      {error ? (
        <div className="console-alert" role="alert">
          {error}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="status-grid" aria-label="Workspace status">
        <article className="status-card status-card--good">
          <small>PRODUCT</small>
          <strong>Firewall ready</strong>
          <p>Hosted inspection is available.</p>
        </article>
        <article className="status-card">
          <small>WORKSPACE</small>
          <strong>{humanize(active.status)}</strong>
          <p>Your tenant boundary is enforced.</p>
        </article>
        <article className="status-card">
          <small>ACCESS</small>
          <strong>{humanize(active.role)}</strong>
          <p>{active.permissions.length} backend permissions.</p>
        </article>
      </section>

      <section className="quick-start" aria-labelledby="quick-start-title">
        <div className="quick-start__heading">
          <div>
            <p className="eyebrow">Get protected</p>
            <h2 id="quick-start-title">Start with one safe flow.</h2>
          </div>
          <span>{completedSteps}/3 ready</span>
        </div>
        <ol className="setup-steps">
          <li className="setup-step--done">
            <CheckIcon />
            <div>
              <strong>Workspace secured</strong>
              <p>Identity and tenant isolation are active.</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Test the firewall</strong>
              <p>Inspect safe and hostile context with no exchange connection.</p>
              <button className="text-action" type="button" onClick={onOpenScanner}>
                Open scanner →
              </button>
            </div>
          </li>
          <li className={active.apiKeys.length ? "setup-step--done" : ""}>
            {active.apiKeys.length ? <CheckIcon /> : <span>3</span>}
            <div>
              <strong>Connect an agent</strong>
              <p>Issue a scoped Verus key. It cannot trade or withdraw.</p>
            </div>
          </li>
        </ol>
      </section>

      <div className="console-columns">
        <section className="console-panel" aria-labelledby="team-title">
          <div className="panel-title">
            <div>
              <p className="eyebrow">People</p>
              <h2 id="team-title">Team access</h2>
            </div>
            <span>{active.members.length}</span>
          </div>
          {active.members.length ? (
            <ul className="management-list">
              {active.members.map((member) => (
                <li key={member.membershipId}>
                  <div>
                    <strong>{humanize(member.role)}</strong>
                    <small>{member.membershipId.slice(0, 18)}…</small>
                    {canManageMembers && member.role !== "owner" ? (
                      <details className="member-editor">
                        <summary>Manage</summary>
                        <form onSubmit={(event) => void changeMember(event, member.membershipId)}>
                          <label>
                            <span className="sr-only">Role</span>
                            <select name="role" defaultValue={member.role}>
                              {roles.map((role) => (
                                <option key={role} value={role}>
                                  {humanize(role)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span className="sr-only">Status</span>
                            <select name="status" defaultValue={member.status}>
                              <option value="active">Active</option>
                              <option value="suspended">Suspended</option>
                              <option value="removed">Remove</option>
                            </select>
                          </label>
                          <button type="submit" disabled={busy}>
                            Save
                          </button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                  <span className={`state-tag state-tag--${member.status}`}>
                    {humanize(member.status)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-copy">Your role does not include member visibility.</p>
          )}
          {canInvite ? (
            <form className="inline-form" onSubmit={(event) => void inviteMember(event)}>
              <h3>Invite a teammate</h3>
              <label htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                placeholder="teammate@company.com"
              />
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" name="role" defaultValue="reviewer">
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {humanize(role)}
                  </option>
                ))}
              </select>
              <button className="secondary-action" disabled={busy} type="submit">
                Create invite link
              </button>
            </form>
          ) : (
            <PermissionNote text="Your role can view this workspace but cannot invite teammates." />
          )}
          {inviteUrl ? (
            <div className="one-time-secret" role="status">
              <strong>Invitation ready</strong>
              <p>Share this private link with the intended person. It expires in 7 days.</p>
              <code>{inviteUrl}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl)}>
                Copy link
              </button>
            </div>
          ) : null}
          {canManageMembers && active.invitations.length ? (
            <details className="quiet-details">
              <summary>Pending and recent invitations</summary>
              <ul>
                {active.invitations.map((invite) => (
                  <li key={invite.invitationId}>
                    {humanize(invite.role)} · {humanize(invite.status)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section className="console-panel" aria-labelledby="keys-title">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Agent access</p>
              <h2 id="keys-title">Verus API keys</h2>
            </div>
            <span>{active.apiKeys.filter((key) => key.status === "active").length}</span>
          </div>
          <div className="security-note">
            <ShieldIcon />
            <p>
              <strong>Verus keys only.</strong> Never paste Bitget, exchange, wallet, trading, or
              withdrawal credentials here.
            </p>
          </div>
          {active.apiKeys.length ? (
            <ul className="management-list">
              {active.apiKeys.map((key) => (
                <li key={key.keyId}>
                  <div>
                    <strong>{key.prefix}…</strong>
                    <small>{key.scopes.join(" · ")}</small>
                    {canManageKeys && key.status !== "revoked" ? (
                      <button
                        className="revoke-action"
                        type="button"
                        disabled={busy}
                        onClick={() => void revokeApiKey(key.keyId)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                  <span className={`state-tag state-tag--${key.status}`}>
                    {humanize(key.status)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-copy">No agent keys yet. The scanner works without one.</p>
          )}
          {canManageKeys ? (
            <form className="inline-form" onSubmit={(event) => void createApiKey(event)}>
              <h3>Create a scoped key</h3>
              <label htmlFor="key-name">Integration name</label>
              <input
                id="key-name"
                name="name"
                required
                maxLength={80}
                placeholder="Research agent"
              />
              <p className="field-caption">
                Scope: submit scans and read their findings. No trading capability.
              </p>
              <button className="secondary-action" disabled={busy} type="submit">
                Generate Verus key
              </button>
            </form>
          ) : (
            <PermissionNote text="Only workspace owners and admins can manage agent keys." />
          )}
          {apiKeyReveal ? (
            <div className="one-time-secret one-time-secret--key" role="alert">
              <strong>Copy this key now</strong>
              <p>For security, Verus will not show it again.</p>
              <code>{apiKeyReveal.apiKey}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(apiKeyReveal.apiKey)}
              >
                Copy key
              </button>
              <button
                className="dismiss-button"
                type="button"
                onClick={() => setApiKeyReveal(undefined)}
              >
                I saved it
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ConsoleStatus({
  title,
  detail,
  retry,
}: {
  readonly title: string;
  readonly detail: string;
  readonly retry?: () => Promise<void>;
}) {
  return (
    <section className="console-status" aria-live="polite">
      <span className="status-orbit" aria-hidden="true" />
      <h1>{title}</h1>
      <p>{detail}</p>
      {retry ? (
        <button className="secondary-action" type="button" onClick={() => void retry()}>
          Try again
        </button>
      ) : null}
    </section>
  );
}

function PermissionNote({ text }: { readonly text: string }) {
  return (
    <p className="permission-note">
      <LockIcon /> {text}
    </p>
  );
}

function CheckIcon() {
  return (
    <svg className="check-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10 4 4 8-9" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 1.75 17 4.3v5.05c0 4.13-2.7 7.3-7 8.78-4.3-1.48-7-4.65-7-8.78V4.3l7-2.55Z" />
      <path d="m6.5 9.7 2.2 2.2 4.8-5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4" y="8" width="12" height="9" rx="2" />
      <path d="M7 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}
